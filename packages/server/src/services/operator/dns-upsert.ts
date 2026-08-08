import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import {
	cloudflareDnsRecord,
	cloudflareSettings,
	cloudflareZone,
} from "../../db/schema"
import { unsealString } from "../../utils/crypto/seal"
import {
	deleteCloudflareDnsRecord,
	type CloudflareDnsRecordType,
	upsertCloudflareDnsRecord,
} from "../cloudflare/dns-records"
import { findBestZoneMatch } from "../cloudflare/app-domain-automation"
import {
	isProxyableDnsRecordType,
	type ZoneDnsRecordInput,
} from "../cloudflare/zone-dns-record-schema"
import { OperatorError, OperatorErrorCode } from "./errors"

const getOrgToken = async (organizationId: string) => {
	const [settings] = await db
		.select({
			apiTokenEncrypted: cloudflareSettings.apiTokenEncrypted,
			apiTokenLast4: cloudflareSettings.apiTokenLast4,
			updatedAt: cloudflareSettings.updatedAt,
		})
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, organizationId))
		.limit(1)

	if (!settings) {
		throw new OperatorError(
			OperatorErrorCode.cloudflare_unconfigured,
			"Cloudflare is not connected for this organization. Connect it under Domains first.",
		)
	}

	try {
		return {
			token: unsealString(settings.apiTokenEncrypted),
			apiTokenLast4: settings.apiTokenLast4,
			updatedAt: settings.updatedAt,
		}
	} catch {
		throw new OperatorError(
			OperatorErrorCode.cloudflare_unconfigured,
			"Cloudflare token could not be decrypted. Check DOKPLOY_ENCRYPTION_KEY and restart Dokploy.",
		)
	}
}

export const getCloudflareCredentialStatus = async (organizationId: string) => {
	const [settings] = await db
		.select({
			apiTokenLast4: cloudflareSettings.apiTokenLast4,
			updatedAt: cloudflareSettings.updatedAt,
		})
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, organizationId))
		.limit(1)

	if (!settings) {
		return {
			configured: false as const,
			healthy: false as const,
			apiTokenLast4: null,
			updatedAt: null,
		}
	}

	try {
		await getOrgToken(organizationId)
		return {
			configured: true as const,
			healthy: true as const,
			apiTokenLast4: settings.apiTokenLast4,
			updatedAt: settings.updatedAt?.toISOString?.() ?? null,
		}
	} catch {
		return {
			configured: true as const,
			healthy: false as const,
			apiTokenLast4: settings.apiTokenLast4,
			updatedAt: settings.updatedAt?.toISOString?.() ?? null,
		}
	}
}

export const listOperatorZones = async (organizationId: string) => {
	await getOrgToken(organizationId)
	return await db
		.select({
			id: cloudflareZone.id,
			cfZoneId: cloudflareZone.cfZoneId,
			name: cloudflareZone.name,
			status: cloudflareZone.status,
			paused: cloudflareZone.paused,
			lastSyncedAt: cloudflareZone.lastSyncedAt,
		})
		.from(cloudflareZone)
		.where(eq(cloudflareZone.organizationId, organizationId))
		.orderBy(cloudflareZone.name)
}

export type UpsertDnsByNameInput = {
	organizationId: string
	/** Cloudflare zone id, or omit to auto-match from hostname */
	cfZoneId?: string
	name: string
	type: ZoneDnsRecordInput["type"]
	content: string
	/** Default false (DNS-only) — safer for Traefik HTTP-01 ACME */
	proxied?: boolean
	ttl?: ZoneDnsRecordInput["ttl"]
	priority?: number
}

/**
 * Idempotent DNS upsert by zone + name + type.
 * Defaults to DNS-only (proxied=false) for Traefik / Let's Encrypt HTTP-01.
 */
export const upsertDnsRecordByName = async (input: UpsertDnsByNameInput) => {
	const { token } = await getOrgToken(input.organizationId)
	const name = input.name.trim().toLowerCase()
	const type = input.type
	const proxied =
		input.proxied ??
		(isProxyableDnsRecordType(type) ? false : undefined)

	let zone =
		input.cfZoneId != null
			? (
					await db
						.select({
							cfZoneId: cloudflareZone.cfZoneId,
							name: cloudflareZone.name,
						})
						.from(cloudflareZone)
						.where(
							and(
								eq(cloudflareZone.organizationId, input.organizationId),
								eq(cloudflareZone.cfZoneId, input.cfZoneId),
							),
						)
						.limit(1)
				)[0]
			: null

	if (!zone) {
		const matched = await findBestZoneMatch(input.organizationId, name)
		if (!matched) {
			throw new OperatorError(
				OperatorErrorCode.zone_not_found,
				`No Cloudflare zone matches hostname ${name}. Sync zones or pass cfZoneId.`,
				{ name },
			)
		}
		zone = { cfZoneId: matched.cfZoneId, name: matched.name }
	}

	const record = await upsertCloudflareDnsRecord({
		token,
		zoneId: zone.cfZoneId,
		type: type as CloudflareDnsRecordType,
		name,
		content: input.content.trim(),
		ttl: input.ttl ?? 1,
		proxied,
		priority: input.priority,
	})

	const now = new Date()
	await db
		.insert(cloudflareDnsRecord)
		.values({
			organizationId: input.organizationId,
			cfZoneId: zone.cfZoneId,
			cfRecordId: record.id,
			type: record.type,
			name: record.name,
			content: record.content,
			ttl: record.ttl,
			proxied: record.proxied ?? false,
			priority: (record as { priority?: number }).priority ?? null,
			managedBy: "manual",
			lastSyncedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				cloudflareDnsRecord.organizationId,
				cloudflareDnsRecord.cfRecordId,
			],
			set: {
				type: record.type,
				name: record.name,
				content: record.content,
				ttl: record.ttl,
				proxied: record.proxied ?? false,
				priority: (record as { priority?: number }).priority ?? null,
				lastSyncedAt: now,
			},
		})

	return {
		cfZoneId: zone.cfZoneId,
		zoneName: zone.name,
		cfRecordId: record.id,
		type: record.type,
		name: record.name,
		content: record.content,
		proxied: record.proxied ?? false,
		ttl: record.ttl,
	}
}

export const deleteDnsRecordById = async (input: {
	organizationId: string
	cfZoneId: string
	cfRecordId: string
}) => {
	const { token } = await getOrgToken(input.organizationId)
	await deleteCloudflareDnsRecord({
		token,
		zoneId: input.cfZoneId,
		recordId: input.cfRecordId,
	})
	await db
		.delete(cloudflareDnsRecord)
		.where(
			and(
				eq(cloudflareDnsRecord.organizationId, input.organizationId),
				eq(cloudflareDnsRecord.cfRecordId, input.cfRecordId),
			),
		)
	return { deleted: true as const, cfRecordId: input.cfRecordId }
}
