/**
 * Cloudflare adapter policy tests (logic-level; no live API).
 * Excluded from packages/server tsc via *.test.ts; run via vitest when wired.
 */
import { describe, expect, it } from "vitest";
import { cloudflareAlwaysProxied } from "./cloudflare";
import { DNS_PROVIDER_CAPABILITIES } from "../types";

describe("cloudflareDnsAdapter policy", () => {
	it("forces proxied true", () => {
		expect(cloudflareAlwaysProxied).toBe(true);
		expect(DNS_PROVIDER_CAPABILITIES.cloudflare.forcesProxy).toBe(true);
		expect(DNS_PROVIDER_CAPABILITIES.cloudflare.requiresDns01WhenManaged).toBe(
			true,
		);
	});
});
