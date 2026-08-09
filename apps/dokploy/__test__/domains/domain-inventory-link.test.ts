import { describe, expect, it } from "vitest";
import {
	extractComposeMatchHints,
	inventoryHostnameLabels,
	matchDnsHostnameToService,
	scoreInventoryHostnameMatch,
	type InventoryServiceCandidate,
} from "../../../../packages/server/src/services/domain-inventory-link";

const composeCandidate = (
	partial: Partial<InventoryServiceCandidate> &
		Pick<
			InventoryServiceCandidate,
			"composeId" | "projectId" | "environmentId" | "displayName" | "appName"
		>,
): InventoryServiceCandidate => ({
	kind: "compose",
	applicationId: null,
	composeServiceNames: [],
	hostnameHints: [],
	hostPublishingServices: [],
	...partial,
});

describe("inventoryHostnameLabels", () => {
	it("returns progressive prefixes", () => {
		expect(inventoryHostnameLabels("devdb.hiy.me")).toEqual([
			"devdb",
			"devdb.hiy",
			"devdb.hiy.me",
		]);
	});
});

describe("extractComposeMatchHints", () => {
	it("reads service names, hostname hints, and host publish services", () => {
		const hints = extractComposeMatchHints(`
services:
  postgres:
    container_name: devdb
    ports:
      - "5432:5432"
    labels:
      - "traefik.http.routers.db.rule=Host(\`db.hiy.me\`)"
  web:
    ports:
      - "3000"
`);
		expect(hints.serviceNames).toEqual(["postgres", "web"]);
		expect(hints.hostnameHints).toContain("devdb");
		expect(hints.hostnameHints).toContain("db.hiy.me");
		expect(hints.hostPublishingServices).toEqual(["postgres"]);
	});

	it("returns empty on invalid YAML", () => {
		expect(extractComposeMatchHints("::::")).toEqual({
			serviceNames: [],
			hostnameHints: [],
			hostPublishingServices: [],
		});
	});
});

describe("matchDnsHostnameToService", () => {
	it("matches leftmost label to compose service name", () => {
		const match = matchDnsHostnameToService("postgres.hiy.me", [
			composeCandidate({
				composeId: "c1",
				projectId: "p1",
				environmentId: "e1",
				displayName: "Stack",
				appName: "compose-stack",
				composeServiceNames: ["postgres", "redis"],
			}),
		]);
		expect(match?.composeId).toBe("c1");
		expect(match?.matchedComposeService).toBe("postgres");
		expect(match?.confidence).toBe("high");
	});

	it("matches hostname hint from container_name", () => {
		const match = matchDnsHostnameToService("devdb.hiy.me", [
			composeCandidate({
				composeId: "c1",
				projectId: "p1",
				environmentId: "e1",
				displayName: "Compress",
				appName: "compose-compress-cross-platform-firewall-y8wlow",
				composeServiceNames: ["postgres"],
				hostnameHints: ["devdb"],
				hostPublishingServices: ["postgres"],
			}),
		]);
		expect(match?.composeId).toBe("c1");
		expect(match?.matchedComposeService).toBe("postgres");
	});

	it("falls back to the unique host-published compose service", () => {
		const match = matchDnsHostnameToService("devdb.hiy.me", [
			composeCandidate({
				composeId: "c1",
				projectId: "p1",
				environmentId: "e1",
				displayName: "Compress",
				appName: "compose-compress-cross-platform-firewall-y8wlow",
				composeServiceNames: ["postgres"],
				hostPublishingServices: ["postgres"],
			}),
			composeCandidate({
				composeId: "c2",
				projectId: "p1",
				environmentId: "e1",
				displayName: "Web",
				appName: "compose-web",
				composeServiceNames: ["app"],
			}),
		]);
		expect(match?.composeId).toBe("c1");
		expect(match?.matchedComposeService).toBe("postgres");
		expect(match?.confidence).toBe("low");
	});

	it("returns null when multiple stacks publish host ports", () => {
		const match = matchDnsHostnameToService("devdb.hiy.me", [
			composeCandidate({
				composeId: "c1",
				projectId: "p1",
				environmentId: "e1",
				displayName: "A",
				appName: "a",
				hostPublishingServices: ["postgres"],
			}),
			composeCandidate({
				composeId: "c2",
				projectId: "p1",
				environmentId: "e1",
				displayName: "B",
				appName: "b",
				hostPublishingServices: ["mysql"],
			}),
		]);
		expect(match).toBeNull();
	});

	it("returns null on ambiguous equal scores", () => {
		const match = matchDnsHostnameToService("api.hiy.me", [
			composeCandidate({
				composeId: "c1",
				projectId: "p1",
				environmentId: "e1",
				displayName: "One",
				appName: "one",
				composeServiceNames: ["api"],
			}),
			composeCandidate({
				composeId: "c2",
				projectId: "p1",
				environmentId: "e1",
				displayName: "Two",
				appName: "two",
				composeServiceNames: ["api"],
			}),
		]);
		expect(match).toBeNull();
	});
});

describe("scoreInventoryHostnameMatch", () => {
	it("scores exact Host() label hints highest", () => {
		const scored = scoreInventoryHostnameMatch("app.hiy.me", {
			kind: "application",
			applicationId: "a1",
			composeId: null,
			projectId: "p1",
			environmentId: "e1",
			displayName: "App",
			appName: "app-xyz",
			composeServiceNames: [],
			hostnameHints: ["app.hiy.me"],
			hostPublishingServices: [],
		});
		expect(scored?.score).toBeGreaterThanOrEqual(100);
	});
});
