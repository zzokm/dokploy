import { and, eq } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import { cloudflareDnsRecord, dnsProvider } from "@dokploy/server/db/schema"
import { resolveDnsProviderSecret } from "@dokploy/server/services/dns/credentials"
import { updateServerTraefik } from "@dokploy/server/utils/traefik/web-server"
import { getWebServerSettings } from "../web-server-settings"
import { findBestZoneMatch } from "./app-domain-automation"
import {
	listCloudflareDnsRecordsByName,
	upsertCloudflareDnsRecord,
} from "./dns-records"

const normalizeHost = (h: string) => h.trim().toLowerCase().replace(/\.$/, "")

export type CloudflareServerDomainDnsPreview = {
	host: string
	zoneName: string
	desiredIp: string | null
	desiredProxied: boolean
	currentRecordId: string | null
	currentIp: string | null
	currentProxied: boolean | null
	state: "no_host" | "no_target" | "no_zone" | "ok" | "missing" | "drift" | "error"
	wouldChange: boolean
	errorMessage?: string | null
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
	return resolved?.secret ?? null
}

const getStoredServerDomainProxied = async (
	organizationId: string,
	host: string,
): Promise<boolean | null> => {
	const fqdn = normalizeHost(host)
	const [row] = await db
		.select({ proxied: cloudflareDnsRecord.proxied })
		.from(cloudflareDnsRecord)
		.where(
			and(
				eq(cloudflareDnsRecord.organizationId, organizationId),
				eq(cloudflareDnsRecord.name, fqdn),
				eq(cloudflareDnsRecord.managedBy, "manual"),
			),
		)
		.limit(1)

	return row?.proxied ?? null
}

export const previewServerDomainDns = async (
	organizationId: string,
	proxiedDefault = true,
): Promise<CloudflareServerDomainDnsPreview | null> => {
	const settings = await getWebServerSettings()
	const host = settings?.host?.trim() ? normalizeHost(settings.host) : ""
	const desiredIp = settings?.serverIp?.trim() ? settings.serverIp.trim() : null
	const storedProxied = host
		? await getStoredServerDomainProxied(organizationId, host)
		: null
	const desiredProxied = storedProxied ?? proxiedDefault

	if (!host) {
		return {
			host: "",
			zoneName: "",
			desiredIp,
			desiredProxied,
			currentRecordId: null,
			currentIp: null,
			currentProxied: null,
			state: "no_host",
			wouldChange: false,
		}
	}

	const zone = await findBestZoneMatch(organizationId, host)
	if (!zone) {
		return {
			host,
			zoneName: "",
			desiredIp,
			desiredProxied,
			currentRecordId: null,
			currentIp: null,
			currentProxied: null,
			state: "no_zone",
			wouldChange: false,
		}
	}

	if (!desiredIp) {
		return {
			host,
			zoneName: zone.name,
			desiredIp: null,
			desiredProxied,
			currentRecordId: null,
			currentIp: null,
			currentProxied: null,
			state: "no_target",
			wouldChange: false,
		}
	}

	let pick: { id: string; content: string; proxied?: boolean } | null = null

	if (zone.credentialId) {
		const [upstream] = await db
			.select()
			.from(dnsProvider)
			.where(
				and(
					eq(dnsProvider.dnsProviderId, zone.credentialId),
					eq(dnsProvider.organizationId, organizationId),
				),
			)
			.limit(1)

		if (upstream) {
			const { listDnsProviderRecords } = await import("../dns-provider")
			try {
				const records = await listDnsProviderRecords(upstream.config, zone.cfZoneId)
				const found = records.find(
					(r) => r.name.toLowerCase() === host && r.type === "A",
				)
				if (found) {
					pick = { id: found.id, content: found.content, proxied: (found as any).proxied }
				}
			} catch (e) {
				return {
					host,
					zoneName: zone.name,
					desiredIp,
					desiredProxied,
					currentRecordId: null,
					currentIp: null,
					currentProxied: null,
					state: "error",
					wouldChange: false,
					errorMessage: e instanceof Error ? e.message : "Failed to list DNS records",
				}
			}
		}
	}

	if (!pick) {
		const token = await getOrgToken(organizationId, zone.credentialId)
		if (token) {
			try {
				const existing = await listCloudflareDnsRecordsByName({
					token,
					zoneId: zone.cfZoneId,
					name: host,
					type: "A",
				})
				const first = existing[0] ?? null
				if (first) {
					pick = { id: first.id, content: first.content, proxied: first.proxied }
				}
			} catch (e) {
				return {
					host,
					zoneName: zone.name,
					desiredIp,
					desiredProxied,
					currentRecordId: null,
					currentIp: null,
					currentProxied: null,
					state: "error",
					wouldChange: false,
					errorMessage: e instanceof Error ? e.message : "Failed to list DNS records",
				}
			}
		}
	}

	const currentIp = pick?.content?.trim() ?? null
	const currentProxied = pick?.proxied ?? null
	const currentRecordId = pick?.id ?? null

	if (!pick) {
		return {
			host,
			zoneName: zone.name,
			desiredIp,
			desiredProxied,
			currentRecordId: null,
			currentIp: null,
			currentProxied: null,
			state: "missing",
			wouldChange: true,
		}
	}

	const ipMatches =
		currentIp !== null && currentIp.toLowerCase() === desiredIp.toLowerCase()
	const proxMatches =
		currentProxied === null ? true : currentProxied === desiredProxied

	if (ipMatches && proxMatches) {
		return {
			host,
			zoneName: zone.name,
			desiredIp,
			desiredProxied,
			currentRecordId,
			currentIp,
			currentProxied,
			state: "ok",
			wouldChange: false,
		}
	}

	return {
		host,
		zoneName: zone.name,
		desiredIp,
		desiredProxied,
		currentRecordId,
		currentIp,
		currentProxied,
		state: "drift",
		wouldChange: true,
	}
}

export const applyServerDomainDns = async (input: {
	organizationId: string
	proxied?: boolean
}) => {
	const settings = await getWebServerSettings()
	const host = settings?.host?.trim() ? normalizeHost(settings.host) : ""
	if (!host) {
		throw new Error("Assign a server domain before syncing DNS")
	}

	const desiredIp = settings?.serverIp?.trim() ? settings.serverIp.trim() : null
	if (!desiredIp) {
		throw new Error(
			"No public server IP is set. Update Server IP before syncing DNS.",
		)
	}

	const zone = await findBestZoneMatch(input.organizationId, host)
	if (!zone) {
		throw new Error(
			`No synced DNS zone matches ${host}. Add a DNS provider under Settings → DNS Providers first.`,
		)
	}

	const storedProxied = await getStoredServerDomainProxied(
		input.organizationId,
		host,
	)
	const proxied = input.proxied ?? storedProxied ?? true

	let recordId: string
	let isCf = true

	if (zone.credentialId) {
		const [upstream] = await db
			.select()
			.from(dnsProvider)
			.where(
				and(
					eq(dnsProvider.dnsProviderId, zone.credentialId),
					eq(dnsProvider.organizationId, input.organizationId),
				),
			)
			.limit(1)

		if (upstream) {
			const { createDnsProviderRecord } = await import("../dns-provider")
			isCf = upstream.providerType === "cloudflare"
			const record = await createDnsProviderRecord(upstream.config, {
				zoneId: zone.cfZoneId,
				type: "A",
				name: host,
				content: desiredIp,
				ttl: 1,
				proxied: isCf ? proxied : false,
			})
			recordId = record.id
		} else {
			const token = await getOrgToken(input.organizationId, zone.credentialId)
			if (!token) {
				throw new Error("Connect a DNS provider first under Settings → DNS Providers")
			}
			const record = await upsertCloudflareDnsRecord({
				token,
				zoneId: zone.cfZoneId,
				type: "A",
				name: host,
				content: desiredIp,
				ttl: 1,
				proxied,
			})
			recordId = record.id
		}
	} else {
		const token = await getOrgToken(input.organizationId, zone.credentialId)
		if (!token) {
			throw new Error("Connect a DNS provider first under Settings → DNS Providers")
		}
		const record = await upsertCloudflareDnsRecord({
			token,
			zoneId: zone.cfZoneId,
			type: "A",
			name: host,
			content: desiredIp,
			ttl: 1,
			proxied,
		})
		recordId = record.id
	}

	const now = new Date()
	try {
		await db
			.insert(cloudflareDnsRecord)
			.values({
				organizationId: input.organizationId,
				cfZoneId: zone.cfZoneId,
				cfRecordId: recordId,
				type: "A",
				name: normalizeHost(host),
				content: desiredIp,
				ttl: 1,
				proxied: isCf ? proxied : false,
				managedBy: "manual",
				lastSyncedAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [cloudflareDnsRecord.organizationId, cloudflareDnsRecord.cfRecordId],
				set: {
					cfZoneId: zone.cfZoneId,
					type: "A",
					name: normalizeHost(host),
					content: desiredIp,
					ttl: 1,
					proxied: isCf ? proxied : false,
					managedBy: "manual",
					lastSyncedAt: now,
					updatedAt: now,
				},
			})
	} catch {}

	// Proxied hostnames on Cloudflare need DNS-01 (letsencrypt-cloudflare); DNS-only can use HTTP-01
	if (settings?.https && settings.certificateType === "letsencrypt") {
		updateServerTraefik(settings, host, {
			certResolver: (isCf && proxied) ? "letsencrypt-cloudflare" : "letsencrypt",
		})
	}

	return {
		host,
		zoneName: zone.name,
		recordId,
		ip: desiredIp,
		proxied: isCf ? proxied : false,
	}
}

export const resolveServerDomainCertResolver = async (
	organizationId: string,
	host: string | null | undefined,
): Promise<"letsencrypt" | "letsencrypt-cloudflare" | undefined> => {
	if (!host?.trim()) {
		return undefined
	}
	const proxied = await getStoredServerDomainProxied(
		organizationId,
		normalizeHost(host),
	)
	if (proxied === true) {
		return "letsencrypt-cloudflare"
	}
	if (proxied === false) {
		return "letsencrypt"
	}
	return undefined
}
