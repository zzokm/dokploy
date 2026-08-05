import { describe, expect, it } from "vitest";
import {
	buildDomainEditHref,
	buildHostnameExternalUrl,
	deriveInventoryWarnings,
	deriveRoutedStatus,
	dnsRecordManagedByLabel,
	inventoryDnsBadgeFromCfStatus,
	inventoryDnsBadgeFromValidation,
	inventoryRoutedBadge,
	inventorySslBadge,
	inventorySslLabel,
	inventorySyncBadge,
	isPreviewableDnsRecordType,
	latestSyncIso,
	openProjectButtonLabel,
	sanitizeDnsValidationError,
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

describe("inventoryDnsBadgeFromValidation", () => {
	it("returns Pending while loading", () => {
		expect(
			inventoryDnsBadgeFromValidation({ isLoading: true }),
		).toBe("Pending");
	});

	it("returns Valid when resolution succeeds", () => {
		expect(
			inventoryDnsBadgeFromValidation({ isLoading: false, isValid: true }),
		).toBe("Valid");
	});

	it("returns Failed when resolution fails", () => {
		expect(
			inventoryDnsBadgeFromValidation({ isLoading: false, isValid: false }),
		).toBe("Failed");
	});
});

describe("sanitizeDnsValidationError", () => {
	it("never surfaces raw DNS errno codes", () => {
		expect(sanitizeDnsValidationError("queryA ENOTFOUND example.com")).toBe(
			"DNS records not found yet. Propagation can take a few minutes.",
		);
	});
});

describe("inventorySslBadge", () => {
	it("returns None when https is off", () => {
		expect(
			inventorySslBadge({
				certificateType: "letsencrypt",
				https: false,
			}),
		).toBe("None");
	});

	it("returns Valid for established Let's Encrypt", () => {
		expect(
			inventorySslBadge({
				certificateType: "letsencrypt",
				https: true,
				createdAt: "2020-01-01T00:00:00.000Z",
			}),
		).toBe("Valid");
	});

	it("returns Pending for recently created Let's Encrypt domains", () => {
		expect(
			inventorySslBadge({
				certificateType: "letsencrypt",
				https: true,
				createdAt: new Date().toISOString(),
			}),
		).toBe("Pending");
	});

	it("returns Valid for recently created web-server domains with live TLS", () => {
		expect(
			inventorySslBadge({
				certificateType: "letsencrypt",
				https: true,
				createdAt: new Date().toISOString(),
				tlsReachable: true,
			}),
		).toBe("Valid");
	});

	it("returns Failed when TLS probe fails after the pending window", () => {
		expect(
			inventorySslBadge({
				certificateType: "letsencrypt",
				https: true,
				createdAt: "2020-01-01T00:00:00.000Z",
				tlsReachable: false,
			}),
		).toBe("Failed");
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

describe("inventoryRoutedBadge", () => {
	it("maps not_routed to Not routed", () => {
		expect(inventoryRoutedBadge("not_routed")).toBe("Not routed");
	});
});

describe("inventorySyncBadge", () => {
	it("maps cloudflare error to Error", () => {
		expect(
			inventorySyncBadge({
				dnsProvider: "cloudflare",
				cfStatus: "error",
			}),
		).toBe("Error");
	});

	it("returns dash for non-cloudflare rows", () => {
		expect(
			inventorySyncBadge({
				dnsProvider: "none",
				cfStatus: null,
			}),
		).toBe("—");
	});
});

describe("latestSyncIso", () => {
	it("picks the newest timestamp", () => {
		expect(
			latestSyncIso([
				"2026-08-01T00:00:00.000Z",
				null,
				"2026-08-04T12:00:00.000Z",
			]),
		).toBe("2026-08-04T12:00:00.000Z");
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

describe("buildHostnameExternalUrl", () => {
	it("uses https when configured", () => {
		expect(
			buildHostnameExternalUrl({ host: "app.example.com", https: true }),
		).toBe("https://app.example.com");
	});

	it("uses http when https is off", () => {
		expect(
			buildHostnameExternalUrl({ host: "app.example.com", https: false }),
		).toBe("http://app.example.com");
	});
});

describe("openProjectButtonLabel", () => {
	it("labels web-server as Open settings", () => {
		expect(openProjectButtonLabel("web-server")).toBe("Open settings");
		expect(openProjectButtonLabel("application")).toBe("Open project");
	});
});

describe("dnsRecordManagedByLabel", () => {
	it("maps app_domain to App domain", () => {
		expect(dnsRecordManagedByLabel("app_domain")).toBe("App domain");
	});

	it("maps manual to Manual", () => {
		expect(dnsRecordManagedByLabel("manual")).toBe("Manual");
	});
});

describe("isPreviewableDnsRecordType", () => {
	it("accepts A and CNAME", () => {
		expect(isPreviewableDnsRecordType("A")).toBe(true);
		expect(isPreviewableDnsRecordType("cname")).toBe(true);
	});

	it("rejects unrelated types", () => {
		expect(isPreviewableDnsRecordType("TXT")).toBe(false);
	});
});

describe("deriveInventoryWarnings", () => {
	it("warns when compose domain needs Traefik redeploy", () => {
		const warnings = deriveInventoryWarnings({
			kind: "compose",
			createdAt: "2026-08-04T14:00:00.000Z",
			lastSuccessfulDeployAt: "2026-08-04T12:00:00.000Z",
			certificateType: "none",
			https: false,
		});
		expect(warnings.some((w) => w.kind === "redeploy_traefik")).toBe(true);
		expect(
			warnings.find((w) => w.kind === "redeploy_traefik")?.hint,
		).toContain("redeploy to apply Traefik");
	});

	it("warns when domain port matches a host publish port", () => {
		const warnings = deriveInventoryWarnings({
			kind: "application",
			createdAt: "2020-01-01T00:00:00.000Z",
			lastSuccessfulDeployAt: null,
			certificateType: "none",
			https: false,
			portLooksLikeHostPublish: true,
			port: 8080,
		});
		expect(warnings.some((w) => w.kind === "host_publish_port")).toBe(true);
		expect(warnings.find((w) => w.kind === "host_publish_port")?.label).toBe(
			"Host publish port",
		);
	});

	it("warns when Let's Encrypt cert is pending", () => {
		const warnings = deriveInventoryWarnings({
			kind: "application",
			createdAt: new Date().toISOString(),
			lastSuccessfulDeployAt: null,
			certificateType: "letsencrypt",
			https: true,
		});
		expect(warnings.some((w) => w.kind === "cert_pending")).toBe(true);
		expect(warnings.find((w) => w.kind === "cert_pending")?.label).toBe(
			"Cert pending",
		);
	});

	it("does not warn cert pending for a live HTTPS web-server domain", () => {
		const warnings = deriveInventoryWarnings({
			kind: "web-server",
			createdAt: new Date().toISOString(),
			lastSuccessfulDeployAt: null,
			certificateType: "letsencrypt",
			https: true,
			tlsReachable: true,
		});
		expect(warnings.some((w) => w.kind === "cert_pending")).toBe(false);
	});

	it("returns no warnings for a healthy established application domain", () => {
		expect(
			deriveInventoryWarnings({
				kind: "application",
				createdAt: "2020-01-01T00:00:00.000Z",
				lastSuccessfulDeployAt: "2026-08-04T12:00:00.000Z",
				certificateType: "letsencrypt",
				https: true,
				portLooksLikeHostPublish: false,
			}),
		).toEqual([]);
	});
});
