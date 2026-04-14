import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import {
	cloudflareDnsRecord,
	cloudflareSettings,
	cloudflareZone,
	domains,
} from "@dokploy/server/db/schema"
import { unsealString } from "@dokploy/server/utils/crypto/seal"
import { deleteCloudflareDnsRecord, upsertAppDnsRecord } from "./dns-records"

export const findBestZoneMatch = async (organizationId: string, host: string) => {
	const zones = await db
		.select({
			id: cloudflareZone.id,
			cfZoneId: cloudflareZone.cfZoneId,
			name: cloudflareZone.name,
			status: cloudflareZone.status,
			paused: cloudflareZone.paused,
		})
		.from(cloudflareZone)
		.where(eq(cloudflareZone.organizationId, organizationId))
		.orderBy(desc(sql`length(${cloudflareZone.name})`))

	const normalizedHost = host.toLowerCase()

	for (const z of zones) {
		const zoneName = z.name.toLowerCase()
		if (normalizedHost === zoneName) return z
		if (normalizedHost.endsWith(`.${zoneName}`)) return z
	}

	return null
}

export const ensureCloudflareAppDnsForDomain = async (input: {
	organizationId: string
	domainId: string
	proxiedDefault?: boolean
}) => {
	const [settings] = await db
		.select({
			apiTokenEncrypted: cloudflareSettings.apiTokenEncrypted,
		})
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, input.organizationId))
		.limit(1)

	if (!settings) {
		return { skipped: true as const, reason: "no_cloudflare_settings" as const }
	}

	const [domain] = await db
		.select()
		.from(domains)
		.where(eq(domains.domainId, input.domainId))
		.limit(1)

	if (!domain) {
		return { skipped: true as const, reason: "domain_not_found" as const }
	}

	let token = ""
	try {
		token = unsealString(settings.apiTokenEncrypted)
	} catch {
		await db
			.update(domains)
			.set({ cfStatus: "error" })
			.where(eq(domains.domainId, input.domainId))
		return { skipped: true as const, reason: "token_unseal_failed" as const }
	}

	const zone = await findBestZoneMatch(input.organizationId, domain.host)
	if (!zone) {
		await db
			.update(domains)
			.set({ cfStatus: "error" })
			.where(eq(domains.domainId, input.domainId))
		return { skipped: true as const, reason: "no_zone_match" as const }
	}

	const proxied =
		domain.cfProxied ??
		domain.cloudflareProxied ??
		input.proxiedDefault ??
		true

	const res = await upsertAppDnsRecord({
		token,
		domainId: input.domainId,
		zoneId: zone.cfZoneId,
		proxied,
		recordType: "A",
	})

	const now = new Date()

	await db.transaction(async (tx) => {
		await tx
			.update(domains)
			.set({
				cfZoneId: zone.cfZoneId,
				cfZoneName: zone.name,
				cfDnsRecordId: res.recordId,
				cfProxied: proxied,
				cfStatus: "synced",
				https: true,
				certificateType: "letsencrypt",
				customCertResolver: proxied ? "letsencrypt-cloudflare" : null,
			})
			.where(eq(domains.domainId, input.domainId))

		await tx
			.insert(cloudflareDnsRecord)
			.values({
				organizationId: input.organizationId,
				cfZoneId: zone.cfZoneId,
				cfRecordId: res.recordId,
				type: res.recordType,
				name: res.recordName,
				content: res.recordContent,
				ttl: 1,
				proxied,
				managedBy: "app_domain",
				lastSyncedAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [cloudflareDnsRecord.organizationId, cloudflareDnsRecord.cfRecordId],
				set: {
					cfZoneId: zone.cfZoneId,
					type: res.recordType,
					name: res.recordName,
					content: res.recordContent,
					ttl: 1,
					proxied,
					managedBy: "app_domain",
					lastSyncedAt: now,
					updatedAt: now,
				},
			})
	})

	return { skipped: false as const, ...res, zoneId: zone.cfZoneId, zoneName: zone.name }
}

export const deleteCloudflareAppDnsForDomain = async (input: {
	organizationId: string
	domainId: string
}) => {
	const [settings] = await db
		.select({
			apiTokenEncrypted: cloudflareSettings.apiTokenEncrypted,
		})
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, input.organizationId))
		.limit(1)

	if (!settings) return { skipped: true as const }

	let token = ""
	try {
		token = unsealString(settings.apiTokenEncrypted)
	} catch {
		return { skipped: true as const }
	}

	const [domain] = await db
		.select({
			cfZoneId: domains.cfZoneId,
			cfDnsRecordId: domains.cfDnsRecordId,
		})
		.from(domains)
		.where(eq(domains.domainId, input.domainId))
		.limit(1)

	if (!domain?.cfZoneId || !domain.cfDnsRecordId) return { skipped: true as const }

	try {
		await deleteCloudflareDnsRecord({
			token,
			zoneId: domain.cfZoneId,
			recordId: domain.cfDnsRecordId,
		})
	} catch {
		// intentionally ignore: record might already be removed
	}

	await db
		.update(domains)
		.set({
			cfDnsRecordId: null,
			cfStatus: "pending",
		})
		.where(eq(domains.domainId, input.domainId))

	return { skipped: false as const }
}

