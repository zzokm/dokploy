import { describe, expect, it } from "vitest";
import { shouldShowServerCloudflareControls } from "@/components/dashboard/settings/web-server/should-show-server-cloudflare-controls";

describe("shouldShowServerCloudflareControls", () => {
	const managedAndSaved = {
		cloudflareModeEnabled: true,
		isCloudflareManagedHost: true,
		formMatchesSavedHost: true,
	};

	it("shows the proxy panel for a saved Cloudflare managed host", () => {
		expect(shouldShowServerCloudflareControls(managedAndSaved)).toBe(true);
	});

	it("hides the proxy panel when the managed switch is turned off", () => {
		expect(
			shouldShowServerCloudflareControls({
				...managedAndSaved,
				cloudflareModeEnabled: false,
			}),
		).toBe(false);
	});

	it("hides the proxy panel when the host is not Cloudflare managed", () => {
		expect(
			shouldShowServerCloudflareControls({
				...managedAndSaved,
				isCloudflareManagedHost: false,
			}),
		).toBe(false);
	});

	it("hides the proxy panel while the form host differs from the saved host", () => {
		expect(
			shouldShowServerCloudflareControls({
				...managedAndSaved,
				formMatchesSavedHost: false,
			}),
		).toBe(false);
	});
});
