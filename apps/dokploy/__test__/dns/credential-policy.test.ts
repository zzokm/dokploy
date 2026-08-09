import { describe, expect, it } from "vitest";
import {
	dnsZoneMirrorKey,
	isPostgresUniqueViolation,
	pickDefaultDnsCredential,
} from "@dokploy/server/services/dns/credential-policy";

describe("pickDefaultDnsCredential", () => {
	const base = {
		createdAt: new Date("2026-01-02T00:00:00.000Z"),
		meta: {},
	};

	it("returns null for empty list", () => {
		expect(pickDefaultDnsCredential([])).toBeNull();
	});

	it("prefers meta.isDefault", () => {
		const picked = pickDefaultDnsCredential([
			{
				id: "a",
				label: "Default",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				meta: {},
			},
			{
				id: "b",
				label: "Prod",
				createdAt: new Date("2026-01-03T00:00:00.000Z"),
				meta: { isDefault: true },
			},
		]);
		expect(picked?.id).toBe("b");
	});

	it('prefers label "Default" when no meta flag', () => {
		const picked = pickDefaultDnsCredential([
			{ id: "a", label: "Prod", ...base },
			{
				id: "b",
				label: "default",
				createdAt: new Date("2026-01-05T00:00:00.000Z"),
				meta: {},
			},
		]);
		expect(picked?.id).toBe("b");
	});

	it("falls back to oldest createdAt", () => {
		const picked = pickDefaultDnsCredential([
			{
				id: "newer",
				label: "Prod",
				createdAt: new Date("2026-01-10T00:00:00.000Z"),
				meta: {},
			},
			{
				id: "older",
				label: "Staging",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				meta: {},
			},
		]);
		expect(picked?.id).toBe("older");
	});
});

describe("dnsZoneMirrorKey", () => {
	it("includes credential id so accounts do not collide", () => {
		expect(
			dnsZoneMirrorKey({
				provider: "cloudflare",
				credentialId: "cred-a",
				externalId: "zone-1",
			}),
		).toBe("cloudflare:cred-a:zone-1");
		expect(
			dnsZoneMirrorKey({
				provider: "cloudflare",
				credentialId: "cred-b",
				externalId: "zone-1",
			}),
		).toBe("cloudflare:cred-b:zone-1");
	});

	it("uses none when credential is missing", () => {
		expect(
			dnsZoneMirrorKey({
				provider: "hetzner",
				credentialId: null,
				externalId: "z1",
			}),
		).toBe("hetzner:none:z1");
	});
});

describe("isPostgresUniqueViolation", () => {
	it("detects 23505 including nested cause", () => {
		expect(isPostgresUniqueViolation({ code: "23505" })).toBe(true);
		expect(
			isPostgresUniqueViolation({ cause: { code: "23505" } }),
		).toBe(true);
		expect(isPostgresUniqueViolation(new Error("nope"))).toBe(false);
	});
});
