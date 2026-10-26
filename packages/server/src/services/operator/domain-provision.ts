import { eq } from "drizzle-orm"
import { db } from "../../db"
import { applications, compose, domains } from "../../db/schema"
import { ensureCloudflareAppDnsForDomain } from "../cloudflare/app-domain-automation"
import { ensureTraefikCloudflareDnsToken } from "../cloudflare/traefik-dns-token"
import {
	createDomain,
	findDomainById,
	findDomainsByApplicationId,
	findDomainsByComposeId,
} from "../domain"
import { resolveDomainTargetById } from "../domain-target"
import { findApplicationById } from "../application"
import { manageDomain } from "../../utils/traefik/domain"
import { getHostnameCertStatus } from "./cert-status"
import { waitForHostnameResolution } from "./dns-resolve"
import { upsertDnsRecordByName } from "./dns-upsert"
import { OperatorError, OperatorErrorCode } from "./errors"
import { checkPublicUrlHealth } from "./url-health"

export type DomainProvisionInput = {
	organizationId: string
	host: string
	/** application | compose | server */
	domainType: "application" | "compose" | "server"
	applicationId?: string
	composeId?: string
	serviceName?: string
	port?: number
	autoPort?: boolean
	path?: string
	internalPath?: string
	stripPath?: boolean
	https?: boolean
	certificateType?: "letsencrypt" | "none" | "custom"
	customCertResolver?: string | null
	useCustomEntrypoint?: boolean
	customEntrypoint?: string | null
	middlewares?: string[]
	letsEncryptEmail?: string
	/**
	 * Cloudflare forces proxied:true. Other DNS providers default to false (DNS-only).
	 */
	proxied?: boolean
	/** Override A-record target; otherwise resolved from the service's server IP or web server IP */
	targetIp?: string
	/** Wait for public DNS before attaching the Dokploy/Traefik domain */
	waitDnsTimeoutMs?: number
	/** Skip final HTTPS probe */
	skipHealthCheck?: boolean
	/** When true, only upsert DNS + wait — do not create Dokploy domain */
	dryRun?: boolean
	/** DNS provider type (cloudflare, route53, porkbun, infomaniak, ovh, etc.) */
	provider?: string
	/** Explicit DNS provider account id from Settings → DNS Providers */
	dnsProviderId?: string
}

export type DomainProvisionResult = {
	ok: true
	host: string
	domainType: "application" | "compose" | "server"
	proxied: boolean
	acmeChallenge: "http-01" | "dns-01"
	dns: {
		cfZoneId: string
		dnsZoneId: string
		zoneName: string
		cfRecordId: string
		dnsRecordId: string
		content: string
		proxied: boolean
		provider?: string
	}
	resolution: {
		addresses: string[]
		matchedExpected: boolean
	}
	domain: {
		domainId: string
		created: boolean
	} | null
	serverSettings?: {
		host: string
		serverIp: string | null
		https: boolean
		certificateType: string
	} | null
	certificate: Awaited<ReturnType<typeof getHostnameCertStatus>> | null
	health: Awaited<ReturnType<typeof checkPublicUrlHealth>> | null
	steps: string[]
}

const resolveTargetIp = async (input: DomainProvisionInput): Promise<string> => {
	if (input.targetIp?.trim()) return input.targetIp.trim()

	const { getWebServerSettings } = await import("../web-server-settings")
	const { findServerById } = await import("../server")

	if (input.domainType === "server") {
		const settings = await getWebServerSettings()
		if (settings?.serverIp?.trim()) return settings.serverIp.trim()
		const { getPublicIpWithFallback } = await import("../../wss/utils")
		const fallbackIp = await getPublicIpWithFallback()
		if (fallbackIp?.trim()) return fallbackIp.trim()
		throw new OperatorError(
			OperatorErrorCode.validation_error,
			"Could not determine public IP for Dokploy server domain. Pass targetIp explicitly.",
		)
	}

	// Prefer resolving via a temporary look-up of the service's server
	if (input.applicationId) {
		const [app] = await db
			.select({ serverId: applications.serverId })
			.from(applications)
			.where(eq(applications.applicationId, input.applicationId))
			.limit(1)
		if (!app) {
			throw new OperatorError(
				OperatorErrorCode.not_found,
				`Application ${input.applicationId} not found`,
			)
		}
	}
	if (input.composeId) {
		const [c] = await db
			.select({ serverId: compose.serverId })
			.from(compose)
			.where(eq(compose.composeId, input.composeId))
			.limit(1)
		if (!c) {
			throw new OperatorError(
				OperatorErrorCode.not_found,
				`Compose ${input.composeId} not found`,
			)
		}
	}

	let serverId: string | null = null
	if (input.applicationId) {
		const [app] = await db
			.select({ serverId: applications.serverId })
			.from(applications)
			.where(eq(applications.applicationId, input.applicationId))
			.limit(1)
		serverId = app?.serverId ?? null
	} else if (input.composeId) {
		const [c] = await db
			.select({ serverId: compose.serverId })
			.from(compose)
			.where(eq(compose.composeId, input.composeId))
			.limit(1)
		serverId = c?.serverId ?? null
	}

	if (serverId) {
		const server = await findServerById(serverId)
		if (server.ipAddress?.trim()) return server.ipAddress.trim()
	}

	const settings = await getWebServerSettings()
	if (settings?.serverIp?.trim()) return settings.serverIp.trim()

	const { getPublicIpWithFallback } = await import("../../wss/utils")
	const fallbackIp = await getPublicIpWithFallback()
	if (fallbackIp?.trim()) return fallbackIp.trim()

	throw new OperatorError(
		OperatorErrorCode.validation_error,
		"Could not determine target IP. Pass targetIp explicitly.",
	)
}

const findExistingDomain = async (input: DomainProvisionInput) => {
	const host = input.host.trim().toLowerCase()
	if (input.applicationId) {
		const list = await findDomainsByApplicationId(input.applicationId)
		return list.find((d) => d.host.toLowerCase() === host) ?? null
	}
	if (input.composeId) {
		const list = await findDomainsByComposeId(input.composeId)
		return list.find((d) => d.host.toLowerCase() === host) ?? null
	}
	return null
}

/**
 * Ordered domain provisioning that prevents the NXDOMAIN-before-DNS race:
 * 1. Upsert Cloudflare DNS (A → target IP)
 * 2. Wait until the hostname resolves
 * 3. Attach the Dokploy domain (Traefik router + ACME) or configure server domain
 * 4. Observe certificate status
 * 5. HTTPS health check
 */
export const provisionDomain = async (
	input: DomainProvisionInput,
): Promise<DomainProvisionResult> => {
	const steps: string[] = []
	const host = input.host.trim().toLowerCase()
	if (!host) {
		throw new OperatorError(
			OperatorErrorCode.validation_error,
			"host is required",
		)
	}
	if (input.domainType === "application" && !input.applicationId) {
		throw new OperatorError(
			OperatorErrorCode.validation_error,
			"applicationId is required for application domains",
		)
	}
	if (input.domainType === "compose" && !input.composeId) {
		throw new OperatorError(
			OperatorErrorCode.validation_error,
			"composeId is required for compose domains",
		)
	}
	if (input.domainType === "compose" && !input.serviceName) {
		throw new OperatorError(
			OperatorErrorCode.validation_error,
			"serviceName is required for compose domains",
		)
	}

	const targetIp = await resolveTargetIp(input)
	steps.push(`resolved_target_ip:${targetIp}`)

	const requestedProvider = input.provider ?? "cloudflare"
	const isRequestedCf = requestedProvider === "cloudflare"
	const coercedProxied = isRequestedCf ? true : (input.proxied ?? false)

	// 1. DNS first — never create Traefik router before this succeeds
	const dnsRaw = await upsertDnsRecordByName({
		organizationId: input.organizationId,
		name: host,
		type: "A",
		content: targetIp,
		proxied: coercedProxied,
		dnsProviderId: input.dnsProviderId,
		ttl: 1,
	})

	const provider = dnsRaw.provider ?? requestedProvider
	const isCf = provider === "cloudflare"
	const proxied = isCf ? true : (dnsRaw.proxied ?? coercedProxied)
	const https = input.https ?? true
	const acmeChallenge = isCf || proxied ? "dns-01" : "http-01"

	if (isCf && input.proxied === false) {
		steps.push("dns_proxy_policy:coerced_proxied_true")
	}

	const dns = {
		...dnsRaw,
		dnsZoneId: dnsRaw.dnsZoneId ?? dnsRaw.cfZoneId,
		dnsRecordId: dnsRaw.dnsRecordId ?? dnsRaw.cfRecordId,
		proxied,
		provider,
	}
	steps.push(`dns_upserted:${dns.dnsRecordId}:${provider}`)

	// 2. Wait for resolution (skip exact IP match when proxied — Cloudflare anycast)
	const resolution = await waitForHostnameResolution({
		host,
		expectedIp: proxied ? null : targetIp,
		timeoutMs: input.waitDnsTimeoutMs ?? 180_000,
		intervalMs: 4_000,
	})
	steps.push(`dns_resolved:${resolution.addresses.join(",")}`)

	if (input.dryRun) {
		return {
			ok: true,
			host,
			domainType: input.domainType,
			proxied,
			acmeChallenge,
			dns,
			resolution: {
				addresses: resolution.addresses,
				matchedExpected: resolution.matchedExpected,
			},
			domain: null,
			certificate: null,
			health: null,
			steps: [...steps, "dry_run_stop"],
		}
	}

	// 3. Attach Dokploy domain or configure Main Dokploy server domain
	if (input.domainType === "server") {
		const { updateWebServerSettings } = await import("../web-server-settings")
		const { updateServerTraefik, updateLetsEncryptEmail } = await import(
			"../../utils/traefik/web-server"
		)
		const { cloudflareDnsRecord } = await import("../../db/schema")

		const settings = await updateWebServerSettings({
			host,
			https,
			certificateType: https ? (input.certificateType ?? "letsencrypt") : "none",
			letsEncryptEmail: input.letsEncryptEmail,
			serverIp: targetIp,
		})

		// Dual write / mirror Cloudflare DNS record row for server domain
		if (isCf && dns.cfZoneId && dns.cfRecordId) {
			const now = new Date()
			await db
				.insert(cloudflareDnsRecord)
				.values({
					organizationId: input.organizationId,
					cfZoneId: dns.cfZoneId,
					cfRecordId: dns.cfRecordId,
					type: "A",
					name: host,
					content: targetIp,
					ttl: 1,
					proxied,
					managedBy: "manual",
					lastSyncedAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [cloudflareDnsRecord.organizationId, cloudflareDnsRecord.cfRecordId],
					set: {
						cfZoneId: dns.cfZoneId,
						type: "A",
						name: host,
						content: targetIp,
						ttl: 1,
						proxied,
						managedBy: "manual",
						lastSyncedAt: now,
						updatedAt: now,
					},
				})
				.catch(() => {})
			steps.push("server_domain_cf_mirror_synced")
		}

		const rawCertResolver =
			input.customCertResolver ??
			(isCf || proxied
				? "letsencrypt-cloudflare"
				: https
					? "letsencrypt"
					: undefined)
		const certResolver =
			rawCertResolver === "letsencrypt-cloudflare" || rawCertResolver === "letsencrypt"
				? rawCertResolver
				: undefined

		updateServerTraefik(settings ?? null, host, certResolver ? { certResolver } : undefined)
		steps.push("server_traefik_updated")

		if (input.letsEncryptEmail) {
			try {
				updateLetsEncryptEmail(input.letsEncryptEmail)
				steps.push("server_letsencrypt_email_updated")
			} catch {
				steps.push("warn_letsencrypt_email_update_failed")
			}
		}

		if (acmeChallenge === "dns-01" && isCf) {
			void ensureTraefikCloudflareDnsToken({
				organizationId: input.organizationId,
				credentialId: dns.credentialId ?? undefined,
			}).catch(() => {})
			steps.push("traefik_dns01_token_ensured")
		}

		// Certificate observation
		let certificate: Awaited<ReturnType<typeof getHostnameCertStatus>> | null = null
		if (https) {
			const deadline = Date.now() + 90_000
			while (Date.now() < deadline) {
				certificate = await getHostnameCertStatus(host)
				if (certificate.status === "issued" || certificate.status === "failed") break
				await new Promise((r) => setTimeout(r, 5_000))
			}
			steps.push(`cert_status:${certificate?.status ?? "unknown"}`)
		}

		// Health check
		let health: Awaited<ReturnType<typeof checkPublicUrlHealth>> | null = null
		if (!input.skipHealthCheck && https) {
			health = await checkPublicUrlHealth({
				host,
				path: input.path ?? "/",
				expectedIp: proxied ? null : targetIp,
				timeoutMs: 15_000,
			})
			steps.push(`health:${health.overall}`)
		}

		return {
			ok: true,
			host,
			domainType: "server",
			proxied,
			acmeChallenge,
			dns,
			resolution: {
				addresses: resolution.addresses,
				matchedExpected: resolution.matchedExpected,
			},
			domain: {
				domainId: "server",
				created: true,
			},
			serverSettings: {
				host,
				serverIp: targetIp,
				https,
				certificateType: https ? (input.certificateType ?? "letsencrypt") : "none",
			},
			certificate,
			health,
			steps,
		}
	}

	// 3b. Application / Compose domain attaching
	const existing = await findExistingDomain(input)
	let created = false
	let domainId: string

	const supportedDomainDnsProviders = [
		"akamai",
		"cloudflare",
		"digitalocean",
		"gcloud",
		"hetzner",
		"none",
		"ns1",
		"route53",
	] as const
	type DomainDnsProviderType = (typeof supportedDomainDnsProviders)[number]
	const domainDnsProvider: DomainDnsProviderType =
		provider && (supportedDomainDnsProviders as readonly string[]).includes(provider)
			? (provider as DomainDnsProviderType)
			: "none"

	if (!existing) {
		const createdDomain = await createDomain({
			host,
			path: input.path ?? "/",
			internalPath: input.internalPath ?? "/",
			stripPath: input.stripPath ?? false,
			port: input.port ?? 3000,
			autoPort: input.autoPort ?? false,
			https,
			certificateType: https ? (input.certificateType ?? "letsencrypt") : "none",
			customCertResolver:
				input.customCertResolver ??
				(acmeChallenge === "dns-01" && isCf ? "letsencrypt-cloudflare" : null),
			customEntrypoint: input.customEntrypoint ?? null,
			middlewares: input.middlewares ?? [],
			domainType: input.domainType,
			applicationId: input.applicationId,
			composeId: input.composeId,
			serviceName: input.serviceName,
			dnsProvider: domainDnsProvider,
			cfProxied: proxied,
			dnsCredentialId: dns.credentialId ?? undefined,
			dnsZoneId: dns.dnsZoneId,
			dnsZoneName: dns.zoneName,
			dnsRecordId: dns.dnsRecordId,
			dnsStatus: "pending",
			dnsOptions: { proxied },
		})
		created = true
		domainId = createdDomain.domainId
		steps.push(`domain_created:${domainId}`)
	} else {
		domainId = existing.domainId
		steps.push(`domain_exists:${domainId}`)
		await db
			.update(domains)
			.set({
				https,
				certificateType: https ? (input.certificateType ?? "letsencrypt") : "none",
				customCertResolver:
					input.customCertResolver ??
					(acmeChallenge === "dns-01" ? "letsencrypt-cloudflare" : null),
				dnsProvider: domainDnsProvider,
				cfProxied: proxied,
				dnsCredentialId: dns.credentialId ?? undefined,
				dnsZoneId: dns.dnsZoneId,
				dnsZoneName: dns.zoneName,
				dnsRecordId: dns.dnsRecordId,
				dnsStatus: "pending",
				dnsOptions: { proxied },
				port: input.port ?? existing.port,
				autoPort: input.autoPort ?? existing.autoPort,
				path: input.path ?? existing.path,
				internalPath: input.internalPath ?? existing.internalPath,
				stripPath: input.stripPath ?? existing.stripPath,
				customEntrypoint: input.customEntrypoint ?? existing.customEntrypoint,
				middlewares: input.middlewares ?? existing.middlewares,
				serviceName: input.serviceName ?? existing.serviceName,
			})
			.where(eq(domains.domainId, domainId))
	}

	const domainRow = await findDomainById(domainId)

	// Sync CF mirror + Traefik labels (idempotent) — always proxied for CF
	await ensureCloudflareAppDnsForDomain({
		organizationId: input.organizationId,
		domainId: domainRow.domainId,
		proxiedDefault: true,
	})
	steps.push("cloudflare_domain_synced")

	if (domainRow.applicationId) {
		const application = await findApplicationById(domainRow.applicationId)
		const refreshed = await findDomainById(domainRow.domainId)
		await manageDomain(application, refreshed)
		steps.push("traefik_domain_applied")
	}

	if (acmeChallenge === "dns-01") {
		void ensureTraefikCloudflareDnsToken({
			organizationId: input.organizationId,
			credentialId: dns.credentialId ?? undefined,
		}).catch(() => {})
		steps.push("traefik_dns01_token_ensured")
	}

	// 4. Certificate observation (non-blocking wait — ACME may still be pending)
	let certificate: Awaited<ReturnType<typeof getHostnameCertStatus>> | null =
		null
	if (https) {
		const deadline = Date.now() + 90_000
		while (Date.now() < deadline) {
			certificate = await getHostnameCertStatus(host)
			if (certificate.status === "issued" || certificate.status === "failed") break
			await new Promise((r) => setTimeout(r, 5_000))
		}
		steps.push(`cert_status:${certificate?.status ?? "unknown"}`)
	}

	// 5. Health check
	let health: Awaited<ReturnType<typeof checkPublicUrlHealth>> | null = null
	if (!input.skipHealthCheck && https) {
		health = await checkPublicUrlHealth({
			host,
			path: input.path ?? "/",
			expectedIp: proxied ? null : targetIp,
			timeoutMs: 15_000,
		})
		steps.push(`health:${health.overall}`)
	}

	// Verify target still matches after domain create (sanity)
	try {
		const target = await resolveDomainTargetById(domainRow.domainId)
		if (target.expectedA && target.expectedA !== targetIp) {
			steps.push(
				`warn_target_ip_drift:provisioned=${targetIp},domain_target=${target.expectedA}`,
			)
		}
	} catch {
		// ignore
	}

	return {
		ok: true,
		host,
		domainType: input.domainType,
		proxied,
		acmeChallenge,
		dns,
		resolution: {
			addresses: resolution.addresses,
			matchedExpected: resolution.matchedExpected,
		},
		domain: {
			domainId: domainRow.domainId,
			created,
		},
		certificate,
		health,
		steps,
	}
}
