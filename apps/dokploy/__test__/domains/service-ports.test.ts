import { describe, expect, it } from "vitest";
import {
	extractServicePortHints,
	isHostPublishPort,
	suggestContainerPort,
} from "../../../../packages/server/src/utils/docker/service-ports";
import type { DefinitionsService } from "../../../../packages/server/src/utils/docker/types";

const service = (partial: DefinitionsService): DefinitionsService => partial;

describe("extractServicePortHints", () => {
	it("splits host publish ports from container ports in short syntax", () => {
		const hints = extractServicePortHints(
			service({ ports: ["8367:3000", "127.0.0.1:9090:9000/tcp"] }),
		);

		expect(hints.containerPorts).toEqual([3000, 9000]);
		expect(hints.hostPublishedPorts).toEqual([8367, 9090]);
	});

	it("treats a bare port as a container port with no host mapping", () => {
		const hints = extractServicePortHints(service({ ports: ["3000", 8080] }));

		expect(hints.containerPorts).toEqual([3000, 8080]);
		expect(hints.hostPublishedPorts).toEqual([]);
	});

	it("reads long syntax target and published", () => {
		const hints = extractServicePortHints(
			service({ ports: [{ target: 3000, published: 8367, mode: "host" }] }),
		);

		expect(hints.containerPorts).toEqual([3000]);
		expect(hints.hostPublishedPorts).toEqual([8367]);
	});

	it("uses the first port of a published range", () => {
		const hints = extractServicePortHints(
			service({ ports: ["8000-8002:9000-9002"] }),
		);

		expect(hints.containerPorts).toEqual([9000]);
		expect(hints.hostPublishedPorts).toEqual([8000]);
	});

	it("includes expose entries as container ports", () => {
		const hints = extractServicePortHints(service({ expose: [4000, "4001"] }));

		expect(hints.containerPorts).toEqual([4000, 4001]);
		expect(hints.hostPublishedPorts).toEqual([]);
	});

	it("falls back to the PORT environment variable in list form", () => {
		const hints = extractServicePortHints(
			service({ environment: ["NODE_ENV=production", "PORT=5000"] }),
		);

		expect(hints.containerPorts).toEqual([5000]);
	});

	it("falls back to the PORT environment variable in map form", () => {
		const hints = extractServicePortHints(
			service({ environment: { PORT: "5050" } }),
		);

		expect(hints.containerPorts).toEqual([5050]);
	});

	it("prefers declared ports over the PORT env fallback", () => {
		const hints = extractServicePortHints(
			service({ ports: ["8367:3000"], environment: ["PORT=3000"] }),
		);

		expect(suggestContainerPort(hints)).toBe(3000);
		expect(hints.containerPorts).toEqual([3000]);
	});

	it("ignores invalid and out-of-range values", () => {
		const hints = extractServicePortHints(
			service({ ports: ["not-a-port", "70000:80"], expose: [0] }),
		);

		expect(hints.containerPorts).toEqual([80]);
		expect(hints.hostPublishedPorts).toEqual([]);
	});

	it("returns empty hints for an unknown service", () => {
		expect(extractServicePortHints(undefined)).toEqual({
			containerPorts: [],
			hostPublishedPorts: [],
		});
	});
});

describe("suggestContainerPort", () => {
	it("returns null when nothing is declared", () => {
		expect(suggestContainerPort(extractServicePortHints(undefined))).toBeNull();
	});
});

describe("isHostPublishPort", () => {
	const hints = extractServicePortHints(service({ ports: ["8367:3000"] }));

	it("flags the host side of a publish mapping", () => {
		expect(isHostPublishPort(hints, 8367)).toBe(true);
	});

	it("does not flag the container port", () => {
		expect(isHostPublishPort(hints, 3000)).toBe(false);
	});

	it("does not flag a port that is both published and exposed", () => {
		const symmetric = extractServicePortHints(
			service({ ports: ["3000:3000"] }),
		);
		expect(isHostPublishPort(symmetric, 3000)).toBe(false);
	});
});
