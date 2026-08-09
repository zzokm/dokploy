import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import {
	cloudflareDnsRecord,
	cloudflareZone,
	dnsZone,
} from "../../db/schema"
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
import { resolveDnsProviderSecret } from "../dns/credentials"
import { OperatorError, OperatorErrorCode } from "./errors"

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
		throw new OperatorError(
			OperatorErrorCode.cloudflare_unconfigured,
			"Cloudflare is not connected for this organization. Connect it under Domains first.",
		)
	}

	return {
		token: resolved.secret,
		credentialId: resolved.credentialId,
		apiTokenLast4: resolved.secret.slice(-4),
		updatedAt: null as Date | null,
	}
}

export const getCloudflareCredentialStatus = async (organizationId: string) => {
	try {
		const cred = await getOrgToken(organizationId)
		return {
			configured: true as const,
			healthy: true as const,
			apiTokenLast4: cred.apiTokenLast4,
			updatedAt: null,
		}
	} catch {
		return {
			configured: false as const,
			healthy: false as const,
			apiTokenLast4: null,
			updatedAt: null,
		}
	}
}

export const listOperatorZones = async (organizationId: string) => {
	await getOrgToken(organizationId)

	const mirrored = await db
		.select({
			id: dnsZone.id,
			cfZoneId: dnsZone.externalId,
			name: dnsZone.name,
			status: dnsZone.status,
			paused: dnsZone.paused,
			lastSyncedAt: dnsZone.lastSyncedAt,
			credentialId: dnsZone.credentialId,
		})
		.from(dnsZone)
		.where(
			and(
				eq(dnsZone.organizationId, organizationId),
				eq(dnsZone.provider, "cloudflare"),
			),
		)
		.orderBy(dnsZone.name)

	if (mirrored.length > 0) {
		return mirrored
	}

	const legacy = await db
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

	return legacy.map((z) => ({ ...z, credentialId: null as string | null }))
}

export type UpsertDnsByNameInput = {
	organizationId: string
	/** Cloudflare zone id, or omit to auto-match from hostname */
	cfZoneId?: string
	credentialId?: string
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
 * Uses the credential tied to the matched zone when available.
 */
export const upsertDnsRecordByName = async (input: UpsertDnsByNameInput) => {
	const name = input.name.trim().toLowerCase()
	const type = input.type
	const proxied =
		input.proxied ??
		(isProxyableDnsRecordType(type) ? false : undefined)

	let zone: {
		cfZoneId: string
		name: string
		credentialId: string | null
	} | null =
		input.cfZoneId != null
			? (
					await db
						.select({
							cfZoneId: dnsZone.externalId,
							name: dnsZone.name,
							credentialId: dnsZone.credentialId,
						})
						.from(dnsZone)
						.where(
							and(
								eq(dnsZone.organizationId, input.organizationId),
								eq(dnsZone.provider, "cloudflare"),
								eq(dnsZone.externalId, input.cfZoneId),
								input.credentialId
									? eq(dnsZone.credentialId, input.credentialId)
									: undefined,
							),
						)
						.limit(1)
				)[0] ?? null
			: null

	if (!zone && input.cfZoneId != null) {
		const legacy = (
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
		if (legacy) {
			zone = { ...legacy, credentialId: null }
		}
	}

	if (!zone) {
		const matched = await findBestZoneMatch(input.organizationId, name)
		if (!matched) {
			throw new OperatorError(
				OperatorErrorCode.zone_not_found,
				`No Cloudflare zone matches hostname ${name}. Sync zones or pass cfZoneId.`,
				{ name },
			)
		}
		zone = {
			cfZoneId: matched.cfZoneId,
			name: matched.name,
			credentialId: matched.credentialId,
		}
	}

	const { token, credentialId } = await getOrgToken(
		input.organizationId,
		input.credentialId ?? zone.credentialId,
	)

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
		credentialId,
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
	credentialId?: string
}) => {
	const { token } = await getOrgToken(
		input.organizationId,
		input.credentialId,
	)
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
