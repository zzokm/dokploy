import type { DefinitionsService } from "./types";

export type ServicePortHints = {
	/**
	 * Ports the container itself listens on. This is what Traefik needs for
	 * `loadbalancer.server.port`, because Traefik reaches the container over
	 * `dokploy-network` and never through a host publish mapping.
	 */
	containerPorts: number[];
	/** Host-side published ports. Never valid as a Traefik target port. */
	hostPublishedPorts: number[];
};

const parsePortValue = (value: unknown): number | null => {
	if (typeof value === "number") {
		return Number.isInteger(value) && value > 0 && value <= 65535
			? value
			: null;
	}
	if (typeof value !== "string") {
		return null;
	}
	// Ranges such as "8000-8010" publish a span; the first port is enough to
	// tell the user which side of the mapping they are looking at.
	const first = value.trim().split("-")[0];
	if (!first || !/^\d+$/.test(first)) {
		return null;
	}
	return parsePortValue(Number.parseInt(first, 10));
};

/**
 * Short syntax is `[[HOST_IP:]HOST_PORT:]CONTAINER_PORT[/PROTOCOL]`, so the
 * container port is always the last colon-separated segment and the host port
 * (when present) is the one before it.
 */
const parseShortPortSyntax = (raw: string) => {
	const withoutProtocol = raw.split("/")[0]?.trim() ?? "";
	if (!withoutProtocol) {
		return null;
	}
	const segments = withoutProtocol.split(":");
	const containerPort = parsePortValue(segments[segments.length - 1]);
	if (containerPort === null) {
		return null;
	}
	const hostPort =
		segments.length >= 2 ? parsePortValue(segments[segments.length - 2]) : null;
	return { containerPort, hostPort };
};

const readEnvValue = (
	environment: DefinitionsService["environment"],
	key: string,
): string | null => {
	if (Array.isArray(environment)) {
		for (const entry of environment) {
			if (typeof entry !== "string") continue;
			const separator = entry.indexOf("=");
			if (separator === -1) continue;
			if (entry.slice(0, separator).trim() !== key) continue;
			return entry.slice(separator + 1).trim();
		}
		return null;
	}
	if (environment && typeof environment === "object") {
		const value = (environment as Record<string, unknown>)[key];
		return value == null ? null : String(value).trim();
	}
	return null;
};

/**
 * Derives the container/host ports declared for a compose service so the
 * domain form can default to a port that Traefik can actually reach.
 */
export const extractServicePortHints = (
	service: DefinitionsService | undefined,
): ServicePortHints => {
	const containerPorts: number[] = [];
	const hostPublishedPorts: number[] = [];

	const addContainerPort = (port: number | null) => {
		if (port !== null && !containerPorts.includes(port)) {
			containerPorts.push(port);
		}
	};
	const addHostPort = (port: number | null) => {
		if (port !== null && !hostPublishedPorts.includes(port)) {
			hostPublishedPorts.push(port);
		}
	};

	for (const entry of service?.ports ?? []) {
		if (typeof entry === "number") {
			addContainerPort(parsePortValue(entry));
			continue;
		}
		if (typeof entry === "string") {
			const parsed = parseShortPortSyntax(entry);
			addContainerPort(parsed?.containerPort ?? null);
			addHostPort(parsed?.hostPort ?? null);
			continue;
		}
		if (entry && typeof entry === "object") {
			addContainerPort(parsePortValue(entry.target));
			addHostPort(parsePortValue(entry.published));
		}
	}

	for (const entry of service?.expose ?? []) {
		addContainerPort(parsePortValue(entry));
	}

	addContainerPort(parsePortValue(readEnvValue(service?.environment, "PORT")));

	return { containerPorts, hostPublishedPorts };
};

/** Best default for a domain's container port, or null when undeterminable. */
export const suggestContainerPort = (hints: ServicePortHints) =>
	hints.containerPorts[0] ?? null;

/**
 * True when the port only appears on the host side of a publish mapping, which
 * always produces a Traefik 502 because nothing listens on it in the container.
 */
export const isHostPublishPort = (hints: ServicePortHints, port: number) =>
	hints.hostPublishedPorts.includes(port) &&
	!hints.containerPorts.includes(port);
