import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import {
	cloudflareDnsRecord,
	cloudflareZone,
	dnsZone,
	domains,
} from "@dokploy/server/db/schema"
import { resolveDnsProviderSecret } from "@dokploy/server/services/dns/credentials"
import { deleteCloudflareDnsRecord, upsertAppDnsRecord } from "./dns-records"

export type MatchedDnsZone = {
	id: string
	cfZoneId: string
	name: string
	status: "active" | "pending" | "disabled"
	paused: boolean
	credentialId: string | null
}

/**
 * Prefer generic dns_zone mirrors (multi-account aware), fall back to legacy
 * cloudflare_zone. Longest zone name wins.
 */
export const findBestZoneMatch = async (
	organizationId: string,
	host: string,
): Promise<MatchedDnsZone | null> => {
	const normalizedHost = host.toLowerCase()

	const mirrored = await db
		.select({
			id: dnsZone.id,
			cfZoneId: dnsZone.externalId,
			name: dnsZone.name,
			status: dnsZone.status,
			paused: dnsZone.paused,
			credentialId: dnsZone.credentialId,
		})
		.from(dnsZone)
		.where(
			and(
				eq(dnsZone.organizationId, organizationId),
				eq(dnsZone.provider, "cloudflare"),
			),
		)
		.orderBy(desc(sql`length(${dnsZone.name})`))

	for (const z of mirrored) {
		const zoneName = z.name.toLowerCase()
		if (normalizedHost === zoneName || normalizedHost.endsWith(`.${zoneName}`)) {
			return z
		}
	}

	const legacy = await db
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

	for (const z of legacy) {
		const zoneName = z.name.toLowerCase()
		if (normalizedHost === zoneName || normalizedHost.endsWith(`.${zoneName}`)) {
			return { ...z, credentialId: null }
		}
	}

	return null
}

const resolveCloudflareTokenForOrg = async (
	organizationId: string,
	credentialId?: string | null,
) => {
	const resolved = await resolveDnsProviderSecret({
		organizationId,
		credentialId: credentialId ?? undefined,
		provider: "cloudflare",
	})
	if (!resolved) {
		return null
	}
	return {
		token: resolved.secret,
		credentialId: resolved.credentialId,
	}
}

export const ensureCloudflareAppDnsForDomain = async (input: {
	organizationId: string
	domainId: string
	proxiedDefault?: boolean
}) => {
	const [domain] = await db
		.select()
		.from(domains)
		.where(eq(domains.domainId, input.domainId))
		.limit(1)

	if (!domain) {
		return { skipped: true as const, reason: "domain_not_found" as const }
	}

	const zone = await findBestZoneMatch(input.organizationId, domain.host)
	if (!zone) {
		await db
			.update(domains)
			.set({ cfStatus: "error", dnsStatus: "error" })
			.where(eq(domains.domainId, input.domainId))
		return { skipped: true as const, reason: "no_zone_match" as const }
	}

	const cred = await resolveCloudflareTokenForOrg(
		input.organizationId,
		domain.dnsCredentialId ?? zone.credentialId,
	)
	if (!cred) {
		return { skipped: true as const, reason: "no_cloudflare_settings" as const }
	}

	const proxied = domain.cfProxied ?? input.proxiedDefault ?? true

	let res: Awaited<ReturnType<typeof upsertAppDnsRecord>>
	try {
		res = await upsertAppDnsRecord({
			token: cred.token,
			domainId: input.domainId,
			zoneId: zone.cfZoneId,
			proxied,
			recordType: "A",
			recordId: domain.cfDnsRecordId ?? domain.dnsRecordId,
		})
	} catch {
		await db
			.update(domains)
			.set({ cfStatus: "error", dnsStatus: "error" })
			.where(eq(domains.domainId, input.domainId))
		return { skipped: true as const, reason: "token_unseal_failed" as const }
	}

	const now = new Date()

	await db.transaction(async (tx) => {
		await tx
			.update(domains)
			.set({
				dnsProvider: "cloudflare",
				dnsCredentialId: cred.credentialId,
				dnsZoneId: zone.cfZoneId,
				dnsZoneName: zone.name,
				dnsRecordId: res.recordId,
				dnsStatus: "synced",
				dnsOptions: { proxied },
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
				target: [
					cloudflareDnsRecord.organizationId,
					cloudflareDnsRecord.cfRecordId,
				],
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

	return {
		skipped: false as const,
		...res,
		zoneId: zone.cfZoneId,
		zoneName: zone.name,
		credentialId: cred.credentialId,
	}
}

export const deleteCloudflareAppDnsForDomain = async (input: {
	organizationId: string
	domainId: string
}) => {
	const [domain] = await db
		.select({
			cfZoneId: domains.cfZoneId,
			cfDnsRecordId: domains.cfDnsRecordId,
			dnsZoneId: domains.dnsZoneId,
			dnsRecordId: domains.dnsRecordId,
			dnsCredentialId: domains.dnsCredentialId,
		})
		.from(domains)
		.where(eq(domains.domainId, input.domainId))
		.limit(1)

	const zoneId = domain?.cfZoneId ?? domain?.dnsZoneId
	const recordId = domain?.cfDnsRecordId ?? domain?.dnsRecordId
	if (!zoneId || !recordId) return { skipped: true as const }

	const cred = await resolveCloudflareTokenForOrg(
		input.organizationId,
		domain?.dnsCredentialId,
	)
	if (!cred) return { skipped: true as const }

	try {
		await deleteCloudflareDnsRecord({
			token: cred.token,
			zoneId,
			recordId,
		})
	} catch {
		// intentionally ignore: record might already be removed
	}

	await db
		.update(domains)
		.set({
			cfDnsRecordId: null,
			dnsRecordId: null,
			cfStatus: "pending",
			dnsStatus: "pending",
		})
		.where(eq(domains.domainId, input.domainId))

	return { skipped: false as const }
}
