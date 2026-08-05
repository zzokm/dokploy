import { describe, expect, it } from "vitest";
import {
	cloudflareConnectionDetails,
	cloudflareConnectionLabel,
	deriveConnectionBadge,
} from "@/components/dashboard/application/domains/domain-connection-utils";

describe("deriveConnectionBadge", () => {
	it("stays neutral when nothing has been checked", () => {
		expect(deriveConnectionBadge({})).toBe("Not checked");
		expect(deriveConnectionBadge({ checkStatus: "pending" })).toBe(
			"Not checked",
		);
	});

	it("returns Valid for a verified connection", () => {
		expect(deriveConnectionBadge({ checkStatus: "active" })).toBe("Valid");
	});

	it("returns Valid from the domain card DNS validation when unchecked", () => {
		expect(
			deriveConnectionBadge({
				checkStatus: null,
				dnsValidation: { isLoading: false, isValid: true },
			}),
		).toBe("Valid");
	});

	it("returns Failed for DNS and reachability failures", () => {
		for (const checkStatus of [
			"dns_mismatch",
			"dns_no_answer",
			"server_unreachable",
			"error",
		]) {
			expect(deriveConnectionBadge({ checkStatus })).toBe("Failed");
		}
		expect(
			deriveConnectionBadge({
				dnsValidation: { isLoading: false, isValid: false },
			}),
		).toBe("Failed");
	});

	it("returns Checking while a check is in flight", () => {
		expect(deriveConnectionBadge({ isChecking: true })).toBe("Checking");
		expect(deriveConnectionBadge({ checkStatus: "checking" })).toBe("Checking");
		expect(
			deriveConnectionBadge({ dnsValidation: { isLoading: true } }),
		).toBe("Checking");
	});
});

describe("cloudflareConnectionLabel", () => {
	const base = {
		managed: true,
		synced: true,
		zoneName: "example.com",
		proxied: true,
		lastSyncedAt: "2026-08-05T08:00:00.000Z",
		status: "synced" as const,
	};

	it("confirms Cloudflare management when synced", () => {
		expect(cloudflareConnectionLabel(base)).toBe("DNS managed by Cloudflare");
	});

	it("flags pending and failed syncs", () => {
		expect(
			cloudflareConnectionLabel({
				...base,
				synced: false,
				status: "pending",
			}),
		).toBe("Cloudflare sync pending");
		expect(
			cloudflareConnectionLabel({ ...base, synced: false, status: "error" }),
		).toBe("Cloudflare sync failed");
	});

	it("builds a compact detail line", () => {
		expect(cloudflareConnectionDetails(base, "synced 5 minutes ago")).toEqual([
			"example.com",
			"Proxied",
			"synced 5 minutes ago",
		]);
		expect(
			cloudflareConnectionDetails(
				{ ...base, zoneName: null, proxied: false },
				null,
			),
		).toEqual(["DNS only"]);
	});
});
