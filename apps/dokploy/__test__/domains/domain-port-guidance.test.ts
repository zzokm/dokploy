import { describe, expect, it } from "vitest";
import {
	deriveDomainPortGuidance,
	isComposeRoutingStale,
	latestSuccessfulDeployAt,
	suggestDomainPort,
} from "@/components/dashboard/application/domains/domain-port-guidance";

describe("deriveDomainPortGuidance", () => {
	const hints = { containerPorts: [3000], hostPublishedPorts: [8367] };

	it("warns and suggests the container port for a host publish port", () => {
		const guidance = deriveDomainPortGuidance({ port: 8367, hints });

		expect(guidance?.kind).toBe("host_publish");
		expect(guidance?.message).toContain("8367");
		expect(guidance?.message).toContain("3000");
	});

	it("stays quiet for the container port", () => {
		expect(deriveDomainPortGuidance({ port: 3000, hints })).toBeNull();
	});

	it("asks for confirmation on an undeclared port", () => {
		const guidance = deriveDomainPortGuidance({ port: 4000, hints });

		expect(guidance?.kind).toBe("unlisted");
		expect(guidance?.message).toContain("3000");
	});

	it("stays quiet without hints", () => {
		expect(deriveDomainPortGuidance({ port: 8367, hints: null })).toBeNull();
	});

	it("stays quiet without a port", () => {
		expect(deriveDomainPortGuidance({ port: null, hints })).toBeNull();
	});

	it("warns without a suggestion when no container port is known", () => {
		const guidance = deriveDomainPortGuidance({
			port: 8367,
			hints: { containerPorts: [], hostPublishedPorts: [8367] },
		});

		expect(guidance?.kind).toBe("host_publish");
		expect(guidance?.message).toContain("the port the container listens on");
	});
});

describe("suggestDomainPort", () => {
	it("returns the first container port", () => {
		expect(
			suggestDomainPort({
				containerPorts: [3000, 9000],
				hostPublishedPorts: [],
			}),
		).toBe(3000);
	});

	it("returns null when unknown", () => {
		expect(suggestDomainPort(null)).toBeNull();
		expect(
			suggestDomainPort({ containerPorts: [], hostPublishedPorts: [8367] }),
		).toBeNull();
	});
});

describe("isComposeRoutingStale", () => {
	it("is stale when the compose has never deployed", () => {
		expect(
			isComposeRoutingStale({
				domainUpdatedAt: "2026-08-01T00:00:00.000Z",
				lastSuccessfulDeployAt: null,
			}),
		).toBe(true);
	});

	it("is stale when the domain is newer than the last deploy", () => {
		expect(
			isComposeRoutingStale({
				domainUpdatedAt: "2026-08-02T00:00:00.000Z",
				lastSuccessfulDeployAt: "2026-08-01T00:00:00.000Z",
			}),
		).toBe(true);
	});

	it("is not stale when the deploy came after the domain", () => {
		expect(
			isComposeRoutingStale({
				domainUpdatedAt: "2026-08-01T00:00:00.000Z",
				lastSuccessfulDeployAt: "2026-08-02T00:00:00.000Z",
			}),
		).toBe(false);
	});

	it("is not stale without a domain timestamp", () => {
		expect(
			isComposeRoutingStale({
				domainUpdatedAt: null,
				lastSuccessfulDeployAt: null,
			}),
		).toBe(false);
	});

	it("is not stale for unparseable timestamps", () => {
		expect(
			isComposeRoutingStale({
				domainUpdatedAt: "not-a-date",
				lastSuccessfulDeployAt: "2026-08-01T00:00:00.000Z",
			}),
		).toBe(false);
	});
});

describe("latestSuccessfulDeployAt", () => {
	it("picks the newest done deployment and prefers finishedAt", () => {
		expect(
			latestSuccessfulDeployAt([
				{
					status: "done",
					createdAt: "2026-08-01T00:00:00.000Z",
					finishedAt: "2026-08-01T00:05:00.000Z",
				},
				{
					status: "done",
					createdAt: "2026-08-03T00:00:00.000Z",
					finishedAt: "2026-08-03T00:05:00.000Z",
				},
				{
					status: "error",
					createdAt: "2026-08-04T00:00:00.000Z",
					finishedAt: "2026-08-04T00:05:00.000Z",
				},
			]),
		).toBe("2026-08-03T00:05:00.000Z");
	});

	it("falls back to createdAt when finishedAt is missing", () => {
		expect(
			latestSuccessfulDeployAt([
				{
					status: "done",
					createdAt: "2026-08-01T00:00:00.000Z",
					finishedAt: null,
				},
			]),
		).toBe("2026-08-01T00:00:00.000Z");
	});

	it("returns null when nothing succeeded", () => {
		expect(
			latestSuccessfulDeployAt([
				{ status: "running", createdAt: "2026-08-01T00:00:00.000Z" },
			]),
		).toBeNull();
	});
});
