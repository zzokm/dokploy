import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DNS_DOMAINS_CACHE_VERSION,
	dnsDomainsCacheKey,
	readDnsDomainsCache,
	serializeHubZones,
	writeDnsDomainsCache,
	zonesFingerprint,
} from "@/components/dashboard/domains/dns-domains-cache";

const ORG = "org_test_1";

const sampleZone = {
	key: "cloudflare:none:zone1",
	provider: "cloudflare",
	zoneExternalId: "zone1",
	cfZoneId: "zone1",
	name: "example.com",
	status: "active" as const,
	paused: false,
	lastSyncedAt: "2026-01-01T00:00:00.000Z",
	credentialId: null,
	credentialLabel: null,
};

function installMemoryLocalStorage() {
	const store = new Map<string, string>();
	const localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, String(value));
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
	};
	vi.stubGlobal("window", { localStorage });
	return { store, localStorage };
}

describe("dns-domains-cache", () => {
	let memory: ReturnType<typeof installMemoryLocalStorage>;

	beforeEach(() => {
		memory = installMemoryLocalStorage();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("writes and reads an org-scoped payload", () => {
		const written = writeDnsDomainsCache(ORG, {
			hasProvider: true,
			zones: [sampleZone],
			inventory: [{ domainId: "d1", host: "app.example.com" }],
		});
		expect(written?.v).toBe(DNS_DOMAINS_CACHE_VERSION);
		expect(written?.orgId).toBe(ORG);
		expect(written?.zones).toEqual([sampleZone]);

		const read = readDnsDomainsCache(ORG);
		expect(read).toEqual(written);
		expect(memory.store.has(dnsDomainsCacheKey(ORG))).toBe(true);
	});

	it("does not leak across organizations", () => {
		writeDnsDomainsCache(ORG, { hasProvider: true, zones: [sampleZone] });
		expect(readDnsDomainsCache("org_other")).toBeNull();
	});

	it("rejects corrupt or wrong-version cache", () => {
		memory.localStorage.setItem(
			dnsDomainsCacheKey(ORG),
			JSON.stringify({ v: 999, orgId: ORG, zones: [] }),
		);
		expect(readDnsDomainsCache(ORG)).toBeNull();
		expect(memory.store.has(dnsDomainsCacheKey(ORG))).toBe(false);

		memory.localStorage.setItem(dnsDomainsCacheKey(ORG), "{not-json");
		expect(readDnsDomainsCache(ORG)).toBeNull();
	});

	it("skips write when snapshot is unchanged", () => {
		writeDnsDomainsCache(ORG, {
			hasProvider: true,
			zones: [sampleZone],
			inventory: null,
		});
		const setItem = vi.spyOn(memory.localStorage, "setItem");
		const again = writeDnsDomainsCache(ORG, {
			hasProvider: true,
			zones: [sampleZone],
			inventory: null,
		});
		expect(again).toBeNull();
		expect(setItem).not.toHaveBeenCalled();
	});

	it("serializeHubZones normalizes dates and fingerprint is stable", () => {
		const serialized = serializeHubZones([
			{
				...sampleZone,
				lastSyncedAt: new Date("2026-01-01T00:00:00.000Z"),
			},
		]);
		expect(serialized[0]?.lastSyncedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(zonesFingerprint(serialized)).toBe(zonesFingerprint([sampleZone]));
	});
});
