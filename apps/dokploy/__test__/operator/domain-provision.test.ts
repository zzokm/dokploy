import { describe, expect, it, vi, beforeEach } from "vitest"

const upsertDnsRecordByName = vi.fn()
const waitForHostnameResolution = vi.fn()
const createDomain = vi.fn()
const findDomainsByApplicationId = vi.fn()
const findDomainById = vi.fn()
const ensureCloudflareAppDnsForDomain = vi.fn()
const findApplicationById = vi.fn()
const manageDomain = vi.fn()
const getHostnameCertStatus = vi.fn()
const checkPublicUrlHealth = vi.fn()
const getWebServerSettings = vi.fn()
const findServerById = vi.fn()

vi.mock("../../../../packages/server/src/services/operator/dns-upsert", () => ({
	upsertDnsRecordByName: (...args: unknown[]) => upsertDnsRecordByName(...args),
}))

vi.mock("../../../../packages/server/src/services/operator/dns-resolve", () => ({
	waitForHostnameResolution: (...args: unknown[]) =>
		waitForHostnameResolution(...args),
}))

vi.mock("../../../../packages/server/src/services/operator/cert-status", () => ({
	getHostnameCertStatus: (...args: unknown[]) => getHostnameCertStatus(...args),
}))

vi.mock("../../../../packages/server/src/services/operator/url-health", () => ({
	checkPublicUrlHealth: (...args: unknown[]) => checkPublicUrlHealth(...args),
}))

vi.mock("../../../../packages/server/src/services/domain", () => ({
	createDomain: (...args: unknown[]) => createDomain(...args),
	findDomainsByApplicationId: (...args: unknown[]) =>
		findDomainsByApplicationId(...args),
	findDomainsByComposeId: vi.fn(),
	findDomainById: (...args: unknown[]) => findDomainById(...args),
}))

vi.mock(
	"../../../../packages/server/src/services/cloudflare/app-domain-automation",
	() => ({
		ensureCloudflareAppDnsForDomain: (...args: unknown[]) =>
			ensureCloudflareAppDnsForDomain(...args),
	}),
)

vi.mock(
	"../../../../packages/server/src/services/cloudflare/traefik-dns-token",
	() => ({
		ensureTraefikCloudflareDnsToken: vi.fn().mockResolvedValue({ applied: false }),
	}),
)

vi.mock("../../../../packages/server/src/services/application", () => ({
	findApplicationById: (...args: unknown[]) => findApplicationById(...args),
}))

vi.mock("../../../../packages/server/src/utils/traefik/domain", () => ({
	manageDomain: (...args: unknown[]) => manageDomain(...args),
}))

vi.mock("../../../../packages/server/src/services/web-server-settings", () => ({
	getWebServerSettings: (...args: unknown[]) => getWebServerSettings(...args),
}))

vi.mock("../../../../packages/server/src/services/server", () => ({
	findServerById: (...args: unknown[]) => findServerById(...args),
}))

vi.mock("../../../../packages/server/src/services/domain-target", () => ({
	resolveDomainTargetById: vi.fn().mockResolvedValue({
		expectedA: "23.94.107.153",
	}),
}))

vi.mock("../../../../packages/server/src/db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => [{ serverId: null }],
				}),
			}),
		}),
		update: () => ({
			set: () => ({
				where: async () => [],
			}),
		}),
	},
}))

import { provisionDomain } from "../../../../packages/server/src/services/operator/domain-provision"

describe("provisionDomain ordering", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getWebServerSettings.mockResolvedValue({ serverIp: "23.94.107.153" })
		upsertDnsRecordByName.mockResolvedValue({
			cfZoneId: "zone1",
			zoneName: "example.com",
			cfRecordId: "rec1",
			type: "A",
			name: "hydro.example.com",
			content: "23.94.107.153",
			proxied: false,
			ttl: 1,
		})
		waitForHostnameResolution.mockResolvedValue({
			ok: true,
			host: "hydro.example.com",
			addresses: ["23.94.107.153"],
			matchedExpected: true,
			expectedIp: "23.94.107.153",
		})
		findDomainsByApplicationId.mockResolvedValue([])
		createDomain.mockResolvedValue({
			domainId: "dom1",
			host: "hydro.example.com",
			applicationId: "app1",
			composeId: null,
		})
		findDomainById.mockResolvedValue({
			domainId: "dom1",
			host: "hydro.example.com",
			applicationId: "app1",
			composeId: null,
		})
		ensureCloudflareAppDnsForDomain.mockResolvedValue({ skipped: false })
		findApplicationById.mockResolvedValue({ applicationId: "app1", appName: "hydro" })
		manageDomain.mockResolvedValue(undefined)
		getHostnameCertStatus.mockResolvedValue({
			host: "hydro.example.com",
			status: "issued",
			resolver: "letsencrypt",
			notAfter: null,
			lastError: null,
		})
		checkPublicUrlHealth.mockResolvedValue({
			host: "hydro.example.com",
			url: "https://hydro.example.com/",
			dns: { ok: true, addresses: ["23.94.107.153"], errorClass: null, error: null },
			https: { ok: true, status: 200, errorClass: null, error: null },
			overall: "ok",
		})
	})

	it("upserts DNS and waits before createDomain (prevents NXDOMAIN race)", async () => {
		const order: string[] = []
		upsertDnsRecordByName.mockImplementation(async () => {
			order.push("dns")
			return {
				cfZoneId: "zone1",
				zoneName: "example.com",
				cfRecordId: "rec1",
				type: "A",
				name: "hydro.example.com",
				content: "23.94.107.153",
				proxied: false,
				ttl: 1,
			}
		})
		waitForHostnameResolution.mockImplementation(async () => {
			order.push("wait")
			return {
				ok: true,
				host: "hydro.example.com",
				addresses: ["23.94.107.153"],
				matchedExpected: true,
				expectedIp: "23.94.107.153",
			}
		})
		createDomain.mockImplementation(async () => {
			order.push("domain")
			return {
				domainId: "dom1",
				host: "hydro.example.com",
				applicationId: "app1",
				composeId: null,
			}
		})

		const result = await provisionDomain({
			organizationId: "org1",
			host: "hydro.example.com",
			domainType: "application",
			applicationId: "app1",
			proxied: false,
		})

		expect(order).toEqual(["dns", "wait", "domain"])
		expect(result.ok).toBe(true)
		// CF Auto DNS always forces proxied + DNS-01 (input.proxied ignored)
		expect(result.acmeChallenge).toBe("dns-01")
		expect(result.proxied).toBe(true)
		expect(result.steps).toContain("dns_proxy_policy:coerced_proxied_true")
		expect(result.steps.some((s) => /resolved_target_ip/.test(s))).toBe(true)
	})

	it("dryRun stops before domain create", async () => {
		const result = await provisionDomain({
			organizationId: "org1",
			host: "hydro.example.com",
			domainType: "application",
			applicationId: "app1",
			dryRun: true,
		})
		expect(createDomain).not.toHaveBeenCalled()
		expect(result.domain).toBeNull()
		expect(result.steps).toContain("dry_run_stop")
	})

	it("forces Cloudflare proxied=true + DNS-01 (ignores proxied=false)", async () => {
		await provisionDomain({
			organizationId: "org1",
			host: "jelly.example.com",
			domainType: "application",
			applicationId: "app1",
			proxied: false,
		})
		expect(upsertDnsRecordByName).toHaveBeenCalledWith(
			expect.objectContaining({ proxied: true, type: "A" }),
		)
	})
})
