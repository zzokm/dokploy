import { describe, expect, it } from "vitest";
import {
	CLOUDFLARE_DNS_TOKEN_ENV,
	mergeCloudflareDnsTokenEnv,
} from "../../../../packages/server/src/services/cloudflare/traefik-dns-token-utils";

describe("mergeCloudflareDnsTokenEnv", () => {
	it("appends the token when Traefik has no env at all", () => {
		const result = mergeCloudflareDnsTokenEnv([], "tok-1");

		expect(result.changed).toBe(true);
		expect(result.env).toEqual([`${CLOUDFLARE_DNS_TOKEN_ENV}=tok-1`]);
	});

	it("keeps unrelated env entries", () => {
		const result = mergeCloudflareDnsTokenEnv(["TZ=UTC"], "tok-1");

		expect(result.changed).toBe(true);
		expect(result.env).toEqual(["TZ=UTC", `${CLOUDFLARE_DNS_TOKEN_ENV}=tok-1`]);
	});

	it("reports no change when the token already matches", () => {
		const env = ["TZ=UTC", `${CLOUDFLARE_DNS_TOKEN_ENV}=tok-1`];
		const result = mergeCloudflareDnsTokenEnv(env, "tok-1");

		expect(result.changed).toBe(false);
		expect(result.env).toBe(env);
	});

	it("replaces a stale token in place", () => {
		const result = mergeCloudflareDnsTokenEnv(
			[`${CLOUDFLARE_DNS_TOKEN_ENV}=old`, "TZ=UTC"],
			"tok-2",
		);

		expect(result.changed).toBe(true);
		expect(result.env).toEqual([`${CLOUDFLARE_DNS_TOKEN_ENV}=tok-2`, "TZ=UTC"]);
	});
});
