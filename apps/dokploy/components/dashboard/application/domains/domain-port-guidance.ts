export type DomainPortHints = {
	/** Ports the container listens on (compose `expose`/`ports` target, `PORT`). */
	containerPorts: number[];
	/** Host-side published ports — unreachable from Traefik on `dokploy-network`. */
	hostPublishedPorts: number[];
};

export type DomainPortGuidance = {
	kind: "host_publish" | "unlisted";
	message: string;
} | null;

const formatPortList = (ports: number[]) => ports.join(", ");

/**
 * Traefik reaches the container over `dokploy-network`, so the domain port must
 * be the container listen port. Entering the host publish side of a `ports:`
 * mapping is the most common cause of a 502 behind a working router.
 */
export const deriveDomainPortGuidance = (input: {
	port?: number | null;
	hints?: DomainPortHints | null;
}): DomainPortGuidance => {
	const { port, hints } = input;
	if (port == null || !hints) {
		return null;
	}

	const isHostPublish =
		hints.hostPublishedPorts.includes(port) &&
		!hints.containerPorts.includes(port);
	if (isHostPublish) {
		const suggestion = hints.containerPorts[0];
		return {
			kind: "host_publish",
			message: suggestion
				? `Port ${port} is the host side of a publish mapping. Traefik connects over dokploy-network, so use the container port ${suggestion} instead.`
				: `Port ${port} is the host side of a publish mapping. Traefik connects over dokploy-network, so use the port the container listens on.`,
		};
	}

	if (hints.containerPorts.length && !hints.containerPorts.includes(port)) {
		return {
			kind: "unlisted",
			message: `This service declares container port ${formatPortList(
				hints.containerPorts,
			)}. Confirm ${port} is really where the app listens inside the container.`,
		};
	}

	return null;
};

/** Port to prefill when the user has not chosen one yet. */
export const suggestDomainPort = (hints?: DomainPortHints | null) =>
	hints?.containerPorts[0] ?? null;

/**
 * Compose routing lives in the compose file's Traefik labels, which are only
 * rewritten on deploy. A domain saved after the last successful deploy has DNS
 * and a DB row but no router, which Traefik answers with a bare 404.
 */
export const isComposeRoutingStale = (input: {
	domainUpdatedAt: string | null | undefined;
	lastSuccessfulDeployAt: string | null | undefined;
}) => {
	if (!input.domainUpdatedAt) return false;
	if (!input.lastSuccessfulDeployAt) return true;
	const domainMs = new Date(input.domainUpdatedAt).getTime();
	const deployMs = new Date(input.lastSuccessfulDeployAt).getTime();
	if (Number.isNaN(domainMs) || Number.isNaN(deployMs)) return false;
	return domainMs > deployMs;
};

/** Most recent successful deployment timestamp, or null when never deployed. */
export const latestSuccessfulDeployAt = (
	deployments: Array<{
		status?: string | null;
		finishedAt?: string | null;
		createdAt?: string | null;
	}>,
) => {
	let latest: number | null = null;
	let latestIso: string | null = null;
	for (const deployment of deployments) {
		if (deployment.status !== "done") continue;
		const value = deployment.finishedAt || deployment.createdAt;
		if (!value) continue;
		const ms = new Date(value).getTime();
		if (Number.isNaN(ms)) continue;
		if (latest === null || ms > latest) {
			latest = ms;
			latestIso = new Date(ms).toISOString();
		}
	}
	return latestIso;
};
