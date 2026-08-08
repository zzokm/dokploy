/**
 * Lightweight adapter contract checks (no live network).
 * Excluded from packages/server tsc via *.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
	cloudflareDnsAdapter,
	digitaloceanDnsAdapter,
	hetznerDnsAdapter,
	route53DnsAdapter,
	gcloudDnsAdapter,
} from "./index";
import { DNS_PROVIDER_CAPABILITIES } from "../types";
import { mergeDnsProviderEnv } from "../traefik-dns-env";

describe("adapter contracts", () => {
	const adapters = [
		cloudflareDnsAdapter,
		digitaloceanDnsAdapter,
		hetznerDnsAdapter,
		route53DnsAdapter,
		gcloudDnsAdapter,
	];

	it("each adapter id matches capabilities map", () => {
		for (const a of adapters) {
			expect(a.id).toBeTruthy();
			expect(a.capabilities).toEqual(DNS_PROVIDER_CAPABILITIES[a.id]);
			expect(typeof a.testCredentials).toBe("function");
			expect(typeof a.listZones).toBe("function");
			expect(typeof a.listRecords).toBe("function");
			expect(typeof a.upsertRecord).toBe("function");
			expect(typeof a.deleteRecord).toBe("function");
		}
	});

	it("cloudflare forces proxy and DNS-01", () => {
		expect(cloudflareDnsAdapter.capabilities.forcesProxy).toBe(true);
		expect(cloudflareDnsAdapter.capabilities.requiresDns01WhenManaged).toBe(
			true,
		);
	});

	it("mergeDnsProviderEnv is idempotent for same value", () => {
		const first = mergeDnsProviderEnv([], {
			envKey: "CF_DNS_API_TOKEN",
			value: "tok",
		});
		expect(first.changed).toBe(true);
		const second = mergeDnsProviderEnv(first.env, {
			envKey: "CF_DNS_API_TOKEN",
			value: "tok",
		});
		expect(second.changed).toBe(false);
	});
});
