import { describe, expect, it } from "vitest";
import {
	DNS_PROVIDER_CAPABILITIES,
	getDnsProviderCapabilities,
} from "./types";

describe("DNS_PROVIDER_CAPABILITIES", () => {
	it("cloudflare forces proxy and requires DNS-01 when managed", () => {
		const cf = getDnsProviderCapabilities("cloudflare");
		expect(cf.forcesProxy).toBe(true);
		expect(cf.supportsProxy).toBe(true);
		expect(cf.requiresDns01WhenManaged).toBe(true);
		expect(cf.supportsDns01).toBe(true);
		expect(cf.legoProvider).toBe("cloudflare");
		expect(cf.traefikResolverName).toBe("letsencrypt-cloudflare");
	});

	it("non-proxy providers do not force proxy", () => {
		for (const id of [
			"digitalocean",
			"hetzner",
			"route53",
			"gcloud",
			"ns1",
		] as const) {
			expect(DNS_PROVIDER_CAPABILITIES[id].forcesProxy).toBe(false);
			expect(DNS_PROVIDER_CAPABILITIES[id].requiresDns01WhenManaged).toBe(
				false,
			);
		}
	});
});
