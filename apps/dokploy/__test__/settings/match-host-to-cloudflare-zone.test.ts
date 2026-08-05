import { describe, expect, it } from "vitest";
import { matchHostToCloudflareZone } from "@/components/dashboard/settings/web-server/match-host-to-cloudflare-zone";

describe("matchHostToCloudflareZone", () => {
	const zones = [
		{ cfZoneId: "z1", name: "example.com" },
		{ cfZoneId: "z2", name: "app.example.com" },
	];

	it("prefers the longest matching zone", () => {
		expect(matchHostToCloudflareZone("api.app.example.com", zones)).toEqual({
			cfZoneId: "z2",
			zoneName: "app.example.com",
			label: "api",
		});
	});

	it("uses @ for the apex", () => {
		expect(matchHostToCloudflareZone("example.com", zones)).toEqual({
			cfZoneId: "z1",
			zoneName: "example.com",
			label: "@",
		});
	});

	it("returns null when no zone matches", () => {
		expect(matchHostToCloudflareZone("other.com", zones)).toBeNull();
	});
});
