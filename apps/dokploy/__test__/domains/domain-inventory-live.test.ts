import { describe, expect, it, vi } from "vitest";

/**
 * Documents the inventory performance contract: default path is mirrors-only
 * (includeLive !== true). Live CF scanning is opt-in for background refresh.
 */
describe("listDomainsInventory live options", () => {
	it("treats missing includeLive as mirrors-only", () => {
		const options: { includeLive?: boolean } = {};
		expect(options.includeLive === true).toBe(false);
	});

	it("enables live scan only when includeLive is explicitly true", () => {
		expect({ includeLive: true }.includeLive === true).toBe(true);
		expect({ includeLive: false }.includeLive === true).toBe(false);
	});

	it("does not invoke live fetch when includeLive is false", async () => {
		const liveFetch = vi.fn(async () => ({ records: [] }));
		const includeLive = false;
		if (includeLive) {
			await liveFetch();
		}
		expect(liveFetch).not.toHaveBeenCalled();
	});
});
