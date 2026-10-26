import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import {
	cloudflareDnsRecord,
	cloudflareZone,
	dnsProvider,
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
			OperatorErrorCode.dns_provider_unconfigured,
			"No DNS provider is connected for this organization. Connect one under Settings → DNS Providers first.",
		)
	}

	return {
		token: resolved.secret,
		credentialId: resolved.credentialId,
		apiTokenLast4: resolved.secret.slice(-4),
		updatedAt: null as Date | null,
	}
}

export const getDnsProviderCredentialStatus = async (organizationId: string) => {
	try {
		const upstream = await db
			.select()
			.from(dnsProvider)
			.where(eq(dnsProvider.organizationId, organizationId))
			.limit(1)

		if (upstream[0]) {
			const config = upstream[0].config as Record<string, unknown>
			const secret =
				(config.apiToken as string) ||
				(config.secretAccessKey as string) ||
				(config.secretApiKey as string) ||
				(config.applicationSecret as string) ||
				""
			return {
				configured: true as const,
				healthy: true as const,
				provider: upstream[0].providerType,
				providerName: upstream[0].name,
				dnsProviderId: upstream[0].dnsProviderId,
				apiTokenLast4: secret ? secret.slice(-4) : "****",
				updatedAt: upstream[0].createdAt ? new Date(upstream[0].createdAt) : null,
			}
		}

		const cred = await getOrgToken(organizationId)
		return {
			configured: true as const,
			healthy: true as const,
			provider: "cloudflare" as const,
			providerName: "Cloudflare",
			dnsProviderId: cred.credentialId,
			apiTokenLast4: cred.apiTokenLast4,
			updatedAt: null,
		}
	} catch {
		return {
			configured: false as const,
			healthy: false as const,
			provider: null,
			providerName: null,
			dnsProviderId: null,
			apiTokenLast4: null,
			updatedAt: null,
		}
	}
}

/** Backward-compatible alias */
export const getCloudflareCredentialStatus = getDnsProviderCredentialStatus

export const listOperatorZones = async (organizationId: string) => {
	const result: Array<{
		id: string
		dnsZoneId: string
		cfZoneId: string
		name: string
		status: "active" | "pending" | "disabled"
		paused: boolean
		lastSyncedAt: Date | string | null
		credentialId: string | null
		provider?: string
	}> = []

	// 1. Check upstream dnsProvider table
	try {
		const { findDnsProvidersByOrganizationId, listDnsProviderZones } = await import(
			"../dns-provider"
		)
		const upstream = await findDnsProvidersByOrganizationId(organizationId)
		for (const p of upstream) {
			try {
				const zones = await listDnsProviderZones(p.config)
				for (const z of zones) {
					result.push({
						id: z.id,
						dnsZoneId: z.id,
						cfZoneId: z.id,
						name: z.name,
						status: "active",
						paused: false,
						lastSyncedAt: new Date(),
						credentialId: p.dnsProviderId,
						provider: p.providerType,
					})
				}
			} catch {
				// Continue to next provider
			}
		}
	} catch {
		// Ignore
	}

	if (result.length > 0) {
		return result
	}

	// 2. Fall back to mirrored dnsZone table
	const mirrored = await db
		.select({
			id: dnsZone.id,
			cfZoneId: dnsZone.externalId,
			name: dnsZone.name,
			status: dnsZone.status,
			paused: dnsZone.paused,
			lastSyncedAt: dnsZone.lastSyncedAt,
			credentialId: dnsZone.credentialId,
			provider: dnsZone.provider,
		})
		.from(dnsZone)
		.where(eq(dnsZone.organizationId, organizationId))
		.orderBy(dnsZone.name)

	if (mirrored.length > 0) {
		return mirrored.map((z) => ({
			...z,
			dnsZoneId: z.cfZoneId,
		}))
	}

	// 3. Fall back to legacy cloudflareZone table
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

	return legacy.map((z) => ({
		...z,
		dnsZoneId: z.cfZoneId,
		credentialId: null,
		provider: "cloudflare",
	}))
}

export type UpsertDnsByNameInput = {
	organizationId: string
	/** Generic zone id (also accepts legacy cfZoneId) */
	dnsZoneId?: string
	cfZoneId?: string
	credentialId?: string
	dnsProviderId?: string
	name: string
	type: ZoneDnsRecordInput["type"]
	content: string
	/** Default false for non-Cloudflare, or coerced to true for Cloudflare */
	proxied?: boolean
	ttl?: ZoneDnsRecordInput["ttl"]
	priority?: number
}

/**
 * Idempotent DNS record upsert across any supported DNS provider.
 * Automatically resolves the parent zone from the hostname if omitted.
 */
export const upsertDnsRecordByName = async (input: UpsertDnsByNameInput) => {
	const name = input.name.trim().toLowerCase()
	const type = input.type
	const targetZoneId = input.dnsZoneId ?? input.cfZoneId

	let zone: {
		cfZoneId: string
		dnsZoneId: string
		name: string
		credentialId: string | null
		provider?: string
	} | null = null

	if (targetZoneId != null) {
		const [z] = await db
			.select({
				cfZoneId: dnsZone.externalId,
				name: dnsZone.name,
				credentialId: dnsZone.credentialId,
				provider: dnsZone.provider,
			})
			.from(dnsZone)
			.where(
				and(
					eq(dnsZone.organizationId, input.organizationId),
					eq(dnsZone.externalId, targetZoneId),
					input.credentialId ? eq(dnsZone.credentialId, input.credentialId) : undefined,
				),
			)
			.limit(1)

		if (z) {
			zone = { ...z, dnsZoneId: z.cfZoneId }
		}
	}

	if (!zone && targetZoneId != null) {
		const [legacy] = await db
			.select({
				cfZoneId: cloudflareZone.cfZoneId,
				name: cloudflareZone.name,
			})
			.from(cloudflareZone)
			.where(
				and(
					eq(cloudflareZone.organizationId, input.organizationId),
					eq(cloudflareZone.cfZoneId, targetZoneId),
				),
			)
			.limit(1)

		if (legacy) {
			zone = { ...legacy, dnsZoneId: legacy.cfZoneId, credentialId: null, provider: "cloudflare" }
		}
	}

	if (!zone) {
		const matched = await findBestZoneMatch(input.organizationId, name)
		if (!matched) {
			throw new OperatorError(
				OperatorErrorCode.zone_not_found,
				`No DNS provider zone matches hostname ${name}. Add a DNS provider under Settings → DNS Providers or pass dnsZoneId.`,
				{ name },
			)
		}
		zone = {
			cfZoneId: matched.cfZoneId,
			dnsZoneId: matched.cfZoneId,
			name: matched.name,
			credentialId: matched.credentialId,
		}
	}

	const effectiveCredId = input.dnsProviderId ?? input.credentialId ?? zone.credentialId

	// Check if this matches a provider in the upstream dnsProvider table
	if (effectiveCredId) {
		const [upstreamProvider] = await db
			.select()
			.from(dnsProvider)
			.where(
				and(
					eq(dnsProvider.dnsProviderId, effectiveCredId),
					eq(dnsProvider.organizationId, input.organizationId),
				),
			)
			.limit(1)

		if (upstreamProvider) {
			const { createDnsProviderRecord } = await import("../dns-provider")
			const providerType = upstreamProvider.providerType
			const isCf = providerType === "cloudflare"
			const proxied = isCf ? (input.proxied ?? true) : false

			const record = await createDnsProviderRecord(upstreamProvider.config, {
				zoneId: zone.dnsZoneId,
				type: type as any,
				name,
				content: input.content.trim(),
				ttl: input.ttl ?? 1,
				proxied,
			})

			// Best-effort dual-write to mirror table
			try {
				const now = new Date()
				await db
					.insert(cloudflareDnsRecord)
					.values({
						organizationId: input.organizationId,
						cfZoneId: zone.dnsZoneId,
						cfRecordId: record.id,
						type: type as any,
						name,
						content: input.content.trim(),
						ttl: input.ttl ?? 1,
						proxied,
						priority: input.priority ?? null,
						managedBy: "manual",
						lastSyncedAt: now,
					})
					.onConflictDoUpdate({
						target: [
							cloudflareDnsRecord.organizationId,
							cloudflareDnsRecord.cfRecordId,
						],
						set: {
							type: type as any,
							name,
							content: input.content.trim(),
							ttl: input.ttl ?? 1,
							proxied,
							priority: input.priority ?? null,
							lastSyncedAt: now,
						},
					})
			} catch {
				// Mirror dual-write failure does not block primary DNS operation
			}

			return {
				dnsZoneId: zone.dnsZoneId,
				cfZoneId: zone.dnsZoneId,
				zoneName: zone.name,
				dnsRecordId: record.id,
				cfRecordId: record.id,
				credentialId: upstreamProvider.dnsProviderId,
				type: type as any,
				name,
				content: input.content.trim(),
				proxied,
				ttl: input.ttl ?? 1,
				provider: providerType,
			}
		}
	}

	// Fallback to vault adapter / cloudflare adapter
	const { token, credentialId } = await getOrgToken(
		input.organizationId,
		effectiveCredId,
	)

	const proxied =
		input.proxied ??
		(isProxyableDnsRecordType(type) ? false : undefined)

	const record = await upsertCloudflareDnsRecord({
		token,
		zoneId: zone.dnsZoneId,
		type: type as CloudflareDnsRecordType,
		name,
		content: input.content.trim(),
		ttl: input.ttl ?? 1,
		proxied,
		priority: input.priority,
	})

	const now = new Date()
	try {
		await db
			.insert(cloudflareDnsRecord)
			.values({
				organizationId: input.organizationId,
				cfZoneId: zone.dnsZoneId,
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
	} catch {
		// Ignore
	}

	return {
		dnsZoneId: zone.dnsZoneId,
		cfZoneId: zone.dnsZoneId,
		zoneName: zone.name,
		dnsRecordId: record.id,
		cfRecordId: record.id,
		credentialId,
		type: record.type,
		name: record.name,
		content: record.content,
		proxied: record.proxied ?? false,
		ttl: record.ttl,
		provider: "cloudflare",
	}
}

export const deleteDnsRecordById = async (input: {
	organizationId: string
	dnsZoneId?: string
	cfZoneId?: string
	dnsRecordId?: string
	cfRecordId?: string
	credentialId?: string
	dnsProviderId?: string
}) => {
	const zoneId = input.dnsZoneId ?? input.cfZoneId
	const recordId = input.dnsRecordId ?? input.cfRecordId
	if (!zoneId || !recordId) {
		throw new OperatorError(
			OperatorErrorCode.validation_error,
			"zoneId and recordId are required",
		)
	}

	const effectiveCredId = input.dnsProviderId ?? input.credentialId
	if (effectiveCredId) {
		const [upstreamProvider] = await db
			.select()
			.from(dnsProvider)
			.where(
				and(
					eq(dnsProvider.dnsProviderId, effectiveCredId),
					eq(dnsProvider.organizationId, input.organizationId),
				),
			)
			.limit(1)

		if (upstreamProvider) {
			const { deleteDnsProviderRecord } = await import("../dns-provider")
			await deleteDnsProviderRecord(upstreamProvider.config, zoneId, recordId)

			await db
				.delete(cloudflareDnsRecord)
				.where(
					and(
						eq(cloudflareDnsRecord.organizationId, input.organizationId),
						eq(cloudflareDnsRecord.cfRecordId, recordId),
					),
				)
				.catch(() => {})

			return { deleted: true as const, dnsRecordId: recordId, cfRecordId: recordId }
		}
	}

	const { token } = await getOrgToken(
		input.organizationId,
		effectiveCredId,
	)
	await deleteCloudflareDnsRecord({
		token,
		zoneId,
		recordId,
	})
	await db
		.delete(cloudflareDnsRecord)
		.where(
			and(
				eq(cloudflareDnsRecord.organizationId, input.organizationId),
				eq(cloudflareDnsRecord.cfRecordId, recordId),
			),
		)
		.catch(() => {})

	return { deleted: true as const, dnsRecordId: recordId, cfRecordId: recordId }
}
