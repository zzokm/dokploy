import { describe, expect, it } from "vitest"
import { deriveConnectionCloudflareState } from "../../../../packages/server/src/services/domain-connection-utils"

const base = {
	dnsProvider: "none" as const,
	cfZoneName: null,
	cfProxied: null,
	cfStatus: null,
	mirroredRecords: [],
}

describe("deriveConnectionCloudflareState", () => {
	it("reports unmanaged domains", () => {
		expect(deriveConnectionCloudflareState(base)).toEqual({
			managed: false,
			synced: false,
			zoneName: null,
			proxied: null,
			lastSyncedAt: null,
			status: null,
		})
	})

	it("treats a mirrored record as managed and synced even without the provider flag", () => {
		const state = deriveConnectionCloudflareState({
			...base,
			mirroredRecords: [
				{
					type: "A",
					proxied: true,
					lastSyncedAt: "2026-08-05T08:00:00.000Z",
				},
			],
		})

		expect(state.managed).toBe(true)
		expect(state.synced).toBe(true)
		expect(state.proxied).toBe(true)
		expect(state.lastSyncedAt).toBe("2026-08-05T08:00:00.000Z")
	})

	it("ignores non-address records", () => {
		const state = deriveConnectionCloudflareState({
			...base,
			mirroredRecords: [{ type: "TXT", proxied: false, lastSyncedAt: null }],
		})

		expect(state.managed).toBe(false)
	})

	it("keeps a cloudflare domain managed while its first sync is pending", () => {
		const state = deriveConnectionCloudflareState({
			...base,
			dnsProvider: "cloudflare",
			cfProxied: true,
			cfStatus: "pending",
			cfZoneName: "example.com",
		})

		expect(state.managed).toBe(true)
		expect(state.synced).toBe(false)
		expect(state.status).toBe("pending")
		expect(state.zoneName).toBe("example.com")
	})

	it("trusts the mirror over a stale pending cf_status", () => {
		const state = deriveConnectionCloudflareState({
			...base,
			dnsProvider: "cloudflare",
			cfStatus: "pending",
			mirroredRecords: [
				{
					type: "CNAME",
					proxied: false,
					lastSyncedAt: "2026-08-05T09:00:00.000Z",
				},
			],
		})

		expect(state.synced).toBe(true)
		expect(state.proxied).toBe(false)
	})

	it("does not mark an errored sync as synced", () => {
		const state = deriveConnectionCloudflareState({
			...base,
			dnsProvider: "cloudflare",
			cfStatus: "error",
			mirroredRecords: [
				{ type: "A", proxied: true, lastSyncedAt: "2026-08-05T09:00:00.000Z" },
			],
		})

		expect(state.managed).toBe(true)
		expect(state.synced).toBe(false)
		expect(state.status).toBe("error")
	})

	it("picks the most recent mirrored sync timestamp", () => {
		const state = deriveConnectionCloudflareState({
			...base,
			mirroredRecords: [
				{ type: "A", proxied: false, lastSyncedAt: "2026-08-01T00:00:00.000Z" },
				{ type: "AAAA", proxied: true, lastSyncedAt: "2026-08-04T00:00:00.000Z" },
			],
		})

		expect(state.lastSyncedAt).toBe("2026-08-04T00:00:00.000Z")
	})
})
