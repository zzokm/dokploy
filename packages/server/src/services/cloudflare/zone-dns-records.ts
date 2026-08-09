import { and, eq } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import {
	cloudflareDnsRecord,
	cloudflareZone,
	dnsZone,
} from "@dokploy/server/db/schema"
import { resolveDnsProviderSecret } from "@dokploy/server/services/dns/credentials"
import { cloudflareFetch } from "./client"
import {
	type CloudflareDnsRecord,
	createCloudflareDnsRecord,
	deleteCloudflareDnsRecord,
	normalizeDnsName,
	updateCloudflareDnsRecord,
} from "./dns-records"
import {
	isProxyableDnsRecordType,
	type ZoneDnsRecordInput,
	zoneDnsRecordInputSchema,
} from "./zone-dns-record-schema"

export {
	type ZoneDnsRecordInput,
	zoneDnsRecordInputSchema,
	zoneDnsRecordTypeSchema,
} from "./zone-dns-record-schema"

export type ZoneDnsRecordView = {
	cfRecordId: string
	type: string
	name: string
	content: string
	ttl: number
	proxied: boolean
	priority: number | null
	managedBy: "app_domain" | "mail_stack" | "manual" | null
	lastSyncedAt: string | null
}

type OwnedCloudflareZone = {
	cfZoneId: string
	name: string
	status: "active" | "pending" | "disabled"
	credentialId: string | null
}

const getOrgToken = async (
	organizationId: string,
	credentialId?: string | null,
) => {
	const resolved = await resolveDnsProviderSecret({
		organizationId,
		credentialId: credentialId ?? undefined,
		provider: "cloudflare",
	})
	if (!resolved) {
		throw new Error("Connect Cloudflare first")
	}
	return resolved.secret
}

/**
 * Prefer generic dns_zone mirrors (multi-account / post-0189), fall back to
 * legacy cloudflare_zone rows for orgs that have not synced yet.
 */
const assertOrgOwnsZone = async (
	organizationId: string,
	cfZoneId: string,
	credentialId?: string | null,
): Promise<OwnedCloudflareZone> => {
	const [mirrored] = await db
		.select({
			cfZoneId: dnsZone.externalId,
			name: dnsZone.name,
			status: dnsZone.status,
			credentialId: dnsZone.credentialId,
		})
		.from(dnsZone)
		.where(
			and(
				eq(dnsZone.organizationId, organizationId),
				eq(dnsZone.provider, "cloudflare"),
				eq(dnsZone.externalId, cfZoneId),
				credentialId
					? eq(dnsZone.credentialId, credentialId)
					: undefined,
			),
		)
		.limit(1)

	if (mirrored) {
		return mirrored
	}

	const [legacy] = await db
		.select({
			cfZoneId: cloudflareZone.cfZoneId,
			name: cloudflareZone.name,
			status: cloudflareZone.status,
		})
		.from(cloudflareZone)
		.where(
			and(
				eq(cloudflareZone.organizationId, organizationId),
				eq(cloudflareZone.cfZoneId, cfZoneId),
			),
		)
		.limit(1)

	if (!legacy) {
		throw new Error("Cloudflare domain not found for this organization")
	}
	return { ...legacy, credentialId: credentialId ?? null }
}

const resolveRecordName = (name: string, zoneName: string) => {
	const trimmed = name.trim().toLowerCase().replace(/\.$/, "")
	if (!trimmed || trimmed === "@") {
		return zoneName.toLowerCase()
	}
	if (trimmed === zoneName.toLowerCase() || trimmed.endsWith(`.${zoneName.toLowerCase()}`)) {
		return trimmed
	}
	return `${trimmed}.${zoneName.toLowerCase()}`
}

const listAllCloudflareDnsRecords = async (token: string, zoneId: string) => {
	const all: CloudflareDnsRecord[] = []
	let page = 1
	const perPage = 100

	for (;;) {
		const batch = await cloudflareFetch<CloudflareDnsRecord[]>({
			token,
			method: "GET",
			path: `/zones/${zoneId}/dns_records`,
			query: { page, per_page: perPage },
		})
		all.push(...batch)
		if (batch.length < perPage) break
		page += 1
		if (page > 50) break
	}

	return all
}

const upsertMirror = async (input: {
	organizationId: string
	cfZoneId: string
	record: CloudflareDnsRecord
	managedBy?: "app_domain" | "mail_stack" | "manual"
}) => {
	const now = new Date()
	const name = normalizeDnsName(input.record.name)
	const proxied = !!input.record.proxied
	const priority =
		typeof input.record.priority === "number" ? input.record.priority : null

	await db
		.insert(cloudflareDnsRecord)
		.values({
			organizationId: input.organizationId,
			cfZoneId: input.cfZoneId,
			cfRecordId: input.record.id,
			type: input.record.type,
			name,
			content: input.record.content,
			ttl: input.record.ttl || 1,
			proxied,
			priority,
			managedBy: input.managedBy ?? "manual",
			lastSyncedAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [cloudflareDnsRecord.organizationId, cloudflareDnsRecord.cfRecordId],
			set: {
				cfZoneId: input.cfZoneId,
				type: input.record.type,
				name,
				content: input.record.content,
				ttl: input.record.ttl || 1,
				proxied,
				priority,
				lastSyncedAt: now,
				updatedAt: now,
			},
		})
}

const deleteMirror = async (organizationId: string, cfRecordId: string) => {
	await db
		.delete(cloudflareDnsRecord)
		.where(
			and(
				eq(cloudflareDnsRecord.organizationId, organizationId),
				eq(cloudflareDnsRecord.cfRecordId, cfRecordId),
			),
		)
}

export const listZoneDnsRecords = async (input: {
	organizationId: string
	cfZoneId: string
	credentialId?: string | null
}): Promise<{
	cfZoneId: string
	zoneName: string
	records: ZoneDnsRecordView[]
}> => {
	const zone = await assertOrgOwnsZone(
		input.organizationId,
		input.cfZoneId,
		input.credentialId,
	)
	const token = await getOrgToken(input.organizationId, zone.credentialId)
	const remote = await listAllCloudflareDnsRecords(token, input.cfZoneId)

	const mirrors = await db
		.select({
			cfRecordId: cloudflareDnsRecord.cfRecordId,
			managedBy: cloudflareDnsRecord.managedBy,
			lastSyncedAt: cloudflareDnsRecord.lastSyncedAt,
		})
		.from(cloudflareDnsRecord)
		.where(
			and(
				eq(cloudflareDnsRecord.organizationId, input.organizationId),
				eq(cloudflareDnsRecord.cfZoneId, input.cfZoneId),
			),
		)

	const mirrorById = new Map(
		mirrors.map((m) => [
			m.cfRecordId,
			{
				managedBy: m.managedBy,
				lastSyncedAt: m.lastSyncedAt
					? m.lastSyncedAt instanceof Date
						? m.lastSyncedAt.toISOString()
						: String(m.lastSyncedAt)
					: null,
			},
		]),
	)

	const records: ZoneDnsRecordView[] = remote.map((record) => {
		const mirror = mirrorById.get(record.id)
		return {
			cfRecordId: record.id,
			type: record.type,
			name: normalizeDnsName(record.name),
			content: record.content,
			ttl: record.ttl,
			proxied: !!record.proxied,
			priority:
				typeof record.priority === "number" ? record.priority : null,
			managedBy: mirror?.managedBy ?? null,
			lastSyncedAt: mirror?.lastSyncedAt ?? null,
		}
	})

	records.sort((a, b) => {
		const typeCmp = a.type.localeCompare(b.type)
		if (typeCmp !== 0) return typeCmp
		return a.name.localeCompare(b.name)
	})

	return {
		cfZoneId: zone.cfZoneId,
		zoneName: zone.name,
		records,
	}
}

export const createZoneDnsRecord = async (input: {
	organizationId: string
	cfZoneId: string
	record: ZoneDnsRecordInput
	credentialId?: string | null
}) => {
	const zone = await assertOrgOwnsZone(
		input.organizationId,
		input.cfZoneId,
		input.credentialId,
	)
	const token = await getOrgToken(input.organizationId, zone.credentialId)
	const parsed = zoneDnsRecordInputSchema.parse(input.record)
	const name = resolveRecordName(parsed.name, zone.name)
	const proxied = isProxyableDnsRecordType(parsed.type)
		? (parsed.proxied ?? false)
		: undefined

	const created = await createCloudflareDnsRecord({
		token,
		zoneId: input.cfZoneId,
		type: parsed.type,
		name,
		content: parsed.content,
		ttl: parsed.ttl,
		proxied,
		priority: parsed.type === "MX" ? parsed.priority : undefined,
	})

	await upsertMirror({
		organizationId: input.organizationId,
		cfZoneId: input.cfZoneId,
		record: created,
		managedBy: "manual",
	})

	return created
}

export const updateZoneDnsRecord = async (input: {
	organizationId: string
	cfZoneId: string
	cfRecordId: string
	record: ZoneDnsRecordInput
	credentialId?: string | null
}) => {
	const zone = await assertOrgOwnsZone(
		input.organizationId,
		input.cfZoneId,
		input.credentialId,
	)
	const token = await getOrgToken(input.organizationId, zone.credentialId)
	const parsed = zoneDnsRecordInputSchema.parse(input.record)
	const name = resolveRecordName(parsed.name, zone.name)
	const proxied = isProxyableDnsRecordType(parsed.type)
		? (parsed.proxied ?? false)
		: undefined

	const updated = await updateCloudflareDnsRecord({
		token,
		zoneId: input.cfZoneId,
		recordId: input.cfRecordId,
		type: parsed.type,
		name,
		content: parsed.content,
		ttl: parsed.ttl,
		proxied,
		priority: parsed.type === "MX" ? parsed.priority : undefined,
	})

	const [existingMirror] = await db
		.select({ managedBy: cloudflareDnsRecord.managedBy })
		.from(cloudflareDnsRecord)
		.where(
			and(
				eq(cloudflareDnsRecord.organizationId, input.organizationId),
				eq(cloudflareDnsRecord.cfRecordId, input.cfRecordId),
			),
		)
		.limit(1)

	await upsertMirror({
		organizationId: input.organizationId,
		cfZoneId: input.cfZoneId,
		record: updated,
		managedBy: existingMirror?.managedBy ?? "manual",
	})

	return updated
}

export const deleteZoneDnsRecord = async (input: {
	organizationId: string
	cfZoneId: string
	cfRecordId: string
	credentialId?: string | null
}) => {
	const zone = await assertOrgOwnsZone(
		input.organizationId,
		input.cfZoneId,
		input.credentialId,
	)
	const token = await getOrgToken(input.organizationId, zone.credentialId)

	await deleteCloudflareDnsRecord({
		token,
		zoneId: input.cfZoneId,
		recordId: input.cfRecordId,
	})

	await deleteMirror(input.organizationId, input.cfRecordId)
	return { ok: true as const }
}
