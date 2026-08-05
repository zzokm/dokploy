import { describe, expect, it } from "vitest";
import {
	deriveCloudflareDomainControlsVisibility,
	resolveCloudflareManagedState,
} from "@/components/dashboard/application/domains/cloudflare-domain-controls-visibility";

describe("resolveCloudflareManagedState", () => {
	it("reads the saved provider when nothing is in flight", () => {
		expect(
			resolveCloudflareManagedState({
				pendingManaged: null,
				dnsProvider: "cloudflare",
			}),
		).toBe(true);
		expect(
			resolveCloudflareManagedState({
				pendingManaged: null,
				dnsProvider: "none",
			}),
		).toBe(false);
		expect(
			resolveCloudflareManagedState({
				pendingManaged: null,
				dnsProvider: undefined,
			}),
		).toBe(false);
	});

	it("shows the in-flight position while a mutation runs", () => {
		expect(
			resolveCloudflareManagedState({
				pendingManaged: true,
				dnsProvider: "none",
			}),
		).toBe(true);
		expect(
			resolveCloudflareManagedState({
				pendingManaged: false,
				dnsProvider: "cloudflare",
			}),
		).toBe(false);
	});

	it("falls back to the saved provider once the overlay is cleared", () => {
		// A failed disable leaves the row on "cloudflare"; clearing the overlay
		// must put the switch back on instead of stranding it off.
		expect(
			resolveCloudflareManagedState({
				pendingManaged: null,
				dnsProvider: "cloudflare",
			}),
		).toBe(true);
	});
});

describe("deriveCloudflareDomainControlsVisibility", () => {
	it("keeps the managed switch mounted after management is enabled", () => {
		const off = deriveCloudflareDomainControlsVisibility({
			isConnected: true,
			isCloudflareManaged: false,
		});
		const on = deriveCloudflareDomainControlsVisibility({
			isConnected: true,
			isCloudflareManaged: true,
		});

		expect(off.showManagedToggle).toBe(true);
		expect(on.showManagedToggle).toBe(true);
	});

	it("only offers the proxy switch on a Cloudflare managed domain", () => {
		expect(
			deriveCloudflareDomainControlsVisibility({
				isConnected: true,
				isCloudflareManaged: false,
			}).showProxyToggle,
		).toBe(false);
		expect(
			deriveCloudflareDomainControlsVisibility({
				isConnected: true,
				isCloudflareManaged: true,
			}).showProxyToggle,
		).toBe(true);
	});

	it("never shows a proxy switch without a Cloudflare connection", () => {
		const disconnected = deriveCloudflareDomainControlsVisibility({
			isConnected: false,
			isCloudflareManaged: true,
		});

		expect(disconnected.showSection).toBe(true);
		expect(disconnected.showReconnectHint).toBe(true);
		expect(disconnected.showManagedToggle).toBe(false);
		expect(disconnected.showProxyToggle).toBe(false);
	});

	it("hides the whole section when Cloudflare is unused and unreachable", () => {
		expect(
			deriveCloudflareDomainControlsVisibility({
				isConnected: false,
				isCloudflareManaged: false,
			}).showSection,
		).toBe(false);
	});
});
