import { describe, expect, it } from "vitest";
import {
	buildDomainEditHref,
	deriveRoutedStatus,
	inventoryDnsBadgeFromCfStatus,
	inventorySslLabel,
} from "@/components/dashboard/domains/domain-inventory-utils";

describe("inventoryDnsBadgeFromCfStatus", () => {
	it("maps cloudflare synced to Valid", () => {
		expect(
			inventoryDnsBadgeFromCfStatus({
				dnsProvider: "cloudflare",
				cfStatus: "synced",
			}),
		).toBe("Valid");
	});

	it("maps cloudflare error to Failed", () => {
		expect(
			inventoryDnsBadgeFromCfStatus({
				dnsProvider: "cloudflare",
				cfStatus: "error",
			}),
		).toBe("Failed");
	});

	it("maps non-cloudflare to Manual", () => {
		expect(
			inventoryDnsBadgeFromCfStatus({
				dnsProvider: "none",
				cfStatus: null,
			}),
		).toBe("Manual");
	});
});

describe("inventorySslLabel", () => {
	it("returns None when https is off", () => {
		expect(
			inventorySslLabel({ certificateType: "letsencrypt", https: false }),
		).toBe("None");
	});

	it("returns Let's Encrypt when enabled", () => {
		expect(
			inventorySslLabel({ certificateType: "letsencrypt", https: true }),
		).toBe("Let's Encrypt");
	});
});

describe("deriveRoutedStatus", () => {
	it("marks application domains as routed", () => {
		expect(
			deriveRoutedStatus({
				kind: "application",
				createdAt: "2026-08-04T12:00:00.000Z",
				lastSuccessfulDeployAt: null,
			}),
		).toBe("routed");
	});

	it("marks compose domains created after last deploy as not_routed", () => {
		expect(
			deriveRoutedStatus({
				kind: "compose",
				createdAt: "2026-08-04T14:00:00.000Z",
				lastSuccessfulDeployAt: "2026-08-04T12:00:00.000Z",
			}),
		).toBe("not_routed");
	});

	it("marks compose domains created before last deploy as routed", () => {
		expect(
			deriveRoutedStatus({
				kind: "compose",
				createdAt: "2026-08-04T10:00:00.000Z",
				lastSuccessfulDeployAt: "2026-08-04T12:00:00.000Z",
			}),
		).toBe("routed");
	});

	it("marks never-deployed compose as not_routed", () => {
		expect(
			deriveRoutedStatus({
				kind: "compose",
				createdAt: "2026-08-04T10:00:00.000Z",
				lastSuccessfulDeployAt: null,
			}),
		).toBe("not_routed");
	});
});

describe("buildDomainEditHref", () => {
	it("links web-server rows to server settings", () => {
		expect(
			buildDomainEditHref({
				kind: "web-server",
				projectId: null,
				environmentId: null,
				applicationId: null,
				composeId: null,
				domainId: "web-server",
			}),
		).toBe("/dashboard/settings/server");
	});

	it("links application domains with domainId query", () => {
		expect(
			buildDomainEditHref({
				kind: "application",
				projectId: "p1",
				environmentId: "e1",
				applicationId: "a1",
				composeId: null,
				domainId: "d1",
			}),
		).toBe(
			"/dashboard/project/p1/environment/e1/services/application/a1?tab=domains&domainId=d1",
		);
	});
});
