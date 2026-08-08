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
	/** application | compose */
	domainType: "application" | "compose"
	applicationId?: string
	composeId?: string
	serviceName?: string
	port?: number
	path?: string
	https?: boolean
	/**
	 * Cloudflare orange-cloud. Default **false** (DNS-only) so Traefik can use
	 * HTTP-01 (`letsencrypt`). Set true only when DNS-01 (`letsencrypt-cloudflare`)
	 * is configured via the Cloudflare token in Traefik.
	 */
	proxied?: boolean
	/** Override A-record target; otherwise resolved from the service's server IP */
	targetIp?: string
	/** Wait for public DNS before attaching the Dokploy/Traefik domain */
	waitDnsTimeoutMs?: number
	/** Skip final HTTPS probe */
	skipHealthCheck?: boolean
	/** When true, only upsert DNS + wait — do not create Dokploy domain */
	dryRun?: boolean
}

export type DomainProvisionResult = {
	ok: true
	host: string
	proxied: boolean
	acmeChallenge: "http-01" | "dns-01"
	dns: {
		cfZoneId: string
		zoneName: string
		cfRecordId: string
		content: string
		proxied: boolean
	}
	resolution: {
		addresses: string[]
		matchedExpected: boolean
	}
	domain: {
		domainId: string
		created: boolean
	} | null
	certificate: Awaited<ReturnType<typeof getHostnameCertStatus>> | null
	health: Awaited<ReturnType<typeof checkPublicUrlHealth>> | null
	steps: string[]
}

const resolveTargetIp = async (input: DomainProvisionInput): Promise<string> => {
	if (input.targetIp?.trim()) return input.targetIp.trim()

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

	// Create a stub probe via existing target resolution after we have a domain,
	// or fall back to web-server settings through upsert path.
	// For pre-domain IP we use resolveDomainTarget-compatible logic:
	const { getWebServerSettings } = await import("../web-server-settings")
	const { findServerById } = await import("../server")

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
 * 3. Attach the Dokploy domain (Traefik router + ACME)
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

	const proxied = input.proxied ?? false
	const https = input.https ?? true
	const acmeChallenge = proxied ? "dns-01" : "http-01"

	const targetIp = await resolveTargetIp(input)
	steps.push(`resolved_target_ip:${targetIp}`)

	// 1. DNS first — never create Traefik router before this succeeds
	const dns = await upsertDnsRecordByName({
		organizationId: input.organizationId,
		name: host,
		type: "A",
		content: targetIp,
		proxied,
		ttl: 1,
	})
	steps.push(`dns_upserted:${dns.cfRecordId}`)

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

	// 3. Attach Dokploy domain only after DNS is live
	let domainRow = await findExistingDomain(input)
	let created = false

	if (!domainRow) {
		domainRow = await createDomain({
			host,
			path: input.path ?? "/",
			port: input.port ?? 3000,
			https,
			certificateType: https ? "letsencrypt" : "none",
			customCertResolver: proxied ? "letsencrypt-cloudflare" : null,
			domainType: input.domainType,
			applicationId: input.applicationId,
			composeId: input.composeId,
			serviceName: input.serviceName,
			dnsProvider: "cloudflare",
			cfProxied: proxied,
		})
		created = true
		steps.push(`domain_created:${domainRow.domainId}`)
	} else {
		steps.push(`domain_exists:${domainRow.domainId}`)
		await db
			.update(domains)
			.set({
				https,
				certificateType: https ? "letsencrypt" : "none",
				customCertResolver: proxied ? "letsencrypt-cloudflare" : null,
				dnsProvider: "cloudflare",
				cfProxied: proxied,
				port: input.port ?? domainRow.port,
				path: input.path ?? domainRow.path,
				serviceName: input.serviceName ?? domainRow.serviceName,
			})
			.where(eq(domains.domainId, domainRow.domainId))
		domainRow = await findDomainById(domainRow.domainId)
	}

	// Sync CF mirror + Traefik labels (idempotent)
	await ensureCloudflareAppDnsForDomain({
		organizationId: input.organizationId,
		domainId: domainRow.domainId,
		proxiedDefault: proxied,
	})
	steps.push("cloudflare_domain_synced")

	if (domainRow.applicationId) {
		const application = await findApplicationById(domainRow.applicationId)
		const refreshed = await findDomainById(domainRow.domainId)
		await manageDomain(application, refreshed)
		steps.push("traefik_domain_applied")
	}

	if (proxied) {
		void ensureTraefikCloudflareDnsToken({
			organizationId: input.organizationId,
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
			if (certificate.status === "issued") break
			if (certificate.status === "failed") break
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
