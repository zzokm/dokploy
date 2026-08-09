/**
 * Best-effort linking of unbound DNS hostnames (inventory kind dns-hostname)
 * to application / compose services for deep-links and Attach domain.
 */

import { parse } from "yaml";
import { normalizeInventoryHost } from "./domain-inventory-inclusion";

export type InventoryServiceCandidate = {
	kind: "application" | "compose";
	applicationId: string | null;
	composeId: string | null;
	projectId: string;
	environmentId: string;
	displayName: string;
	appName: string;
	/** Compose YAML service keys / serviceNetworks names. */
	composeServiceNames: string[];
	/**
	 * Hostname-like tokens from labels, container_name, hostname, or env values
	 * that equal or contain FQDNs / labels.
	 */
	hostnameHints: string[];
	/** Compose services that declare a host publish mapping. */
	hostPublishingServices: string[];
};

export type InventoryServiceMatch = {
	kind: "application" | "compose";
	applicationId: string | null;
	composeId: string | null;
	projectId: string;
	environmentId: string;
	/** Human-readable linked service label for the inventory row. */
	serviceName: string;
	/** Compose service key to prefill on Attach domain (compose only). */
	matchedComposeService: string | null;
	confidence: "high" | "medium" | "low";
	score: number;
};

const MIN_SCORE = 50;

const normalizeToken = (value: string) =>
	value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "");

/** Leftmost DNS label and progressive prefixes of the FQDN. */
export const inventoryHostnameLabels = (host: string): string[] => {
	const normalized = normalizeInventoryHost(host);
	if (!normalized) return [];
	const parts = normalized.split(".").filter(Boolean);
	const labels: string[] = [];
	for (let i = 1; i <= parts.length; i++) {
		labels.push(parts.slice(0, i).join("."));
	}
	return labels;
};

const HOST_IN_LABEL_RE =
	/Host(?:SNI)?\s*\(\s*`([^`]+)`\s*\)|Host(?:SNI)?\s*\(\s*'([^']+)'\s*\)|Host(?:SNI)?\s*\(\s*"([^"]+)"\s*\)/gi;

const looksLikeHostname = (value: string) => {
	const v = value.trim().toLowerCase().replace(/\.$/, "");
	if (!v || v.length > 253) return false;
	if (!v.includes(".")) return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(v);
	return /^(?=.{1,253}$)(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v);
};

const pushUnique = (list: string[], value: string | null | undefined) => {
	if (!value) return;
	const normalized = normalizeInventoryHost(value);
	if (!normalized) return;
	if (!list.includes(normalized)) list.push(normalized);
};

const collectEnvHostHints = (
	environment: unknown,
	hints: string[],
) => {
	if (Array.isArray(environment)) {
		for (const entry of environment) {
			if (typeof entry !== "string") continue;
			const eq = entry.indexOf("=");
			if (eq === -1) continue;
			const value = entry.slice(eq + 1).trim();
			if (looksLikeHostname(value)) pushUnique(hints, value);
		}
		return;
	}
	if (environment && typeof environment === "object") {
		for (const value of Object.values(environment as Record<string, unknown>)) {
			if (typeof value === "string" && looksLikeHostname(value)) {
				pushUnique(hints, value);
			}
		}
	}
};

const collectLabelHostHints = (labels: unknown, hints: string[]) => {
	const entries: string[] = [];
	if (Array.isArray(labels)) {
		for (const entry of labels) {
			if (typeof entry === "string") entries.push(entry);
		}
	} else if (labels && typeof labels === "object") {
		for (const [key, value] of Object.entries(
			labels as Record<string, unknown>,
		)) {
			entries.push(`${key}=${value == null ? "" : String(value)}`);
			if (typeof value === "string") entries.push(value);
		}
	}
	for (const entry of entries) {
		HOST_IN_LABEL_RE.lastIndex = 0;
		let match: RegExpExecArray | null = HOST_IN_LABEL_RE.exec(entry);
		while (match) {
			pushUnique(hints, match[1] || match[2] || match[3]);
			match = HOST_IN_LABEL_RE.exec(entry);
		}
		if (looksLikeHostname(entry)) pushUnique(hints, entry);
	}
};

const serviceHasHostPublish = (ports: unknown): boolean => {
	if (!Array.isArray(ports)) return false;
	for (const entry of ports) {
		if (typeof entry === "string") {
			const segments = entry.split("/")[0]?.split(":") ?? [];
			if (segments.length >= 2) return true;
			continue;
		}
		if (
			entry &&
			typeof entry === "object" &&
			"published" in entry &&
			(entry as { published?: unknown }).published != null
		) {
			return true;
		}
	}
	return false;
};

/**
 * Pull match tokens from a compose YAML string without throwing on bad YAML.
 */
export const extractComposeMatchHints = (
	composeFile: string,
): {
	serviceNames: string[];
	hostnameHints: string[];
	hostPublishingServices: string[];
} => {
	const serviceNames: string[] = [];
	const hostnameHints: string[] = [];
	const hostPublishingServices: string[] = [];
	if (!composeFile.trim()) {
		return { serviceNames, hostnameHints, hostPublishingServices };
	}

	try {
		const parsed = parse(composeFile, { maxAliasCount: 10000 }) as {
			services?: Record<string, unknown>;
		} | null;
		const services = parsed?.services;
		if (!services || typeof services !== "object") {
			return { serviceNames, hostnameHints, hostPublishingServices };
		}

		for (const [name, raw] of Object.entries(services)) {
			serviceNames.push(name);
			if (!raw || typeof raw !== "object") continue;
			const svc = raw as Record<string, unknown>;
			if (typeof svc.container_name === "string") {
				pushUnique(hostnameHints, svc.container_name);
			}
			if (typeof svc.hostname === "string") {
				pushUnique(hostnameHints, svc.hostname);
			}
			collectLabelHostHints(svc.labels, hostnameHints);
			collectEnvHostHints(svc.environment, hostnameHints);
			if (serviceHasHostPublish(svc.ports)) {
				hostPublishingServices.push(name);
			}
		}
	} catch {
		// Invalid compose YAML — skip deep hints; callers still have appName.
	}

	return { serviceNames, hostnameHints, hostPublishingServices };
};

type Scored = {
	match: InventoryServiceMatch;
	score: number;
};

const scoreTokenEquality = (a: string, b: string) =>
	normalizeToken(a) === normalizeToken(b);

const scoreTokenLoose = (a: string, b: string) => {
	const left = normalizeToken(a);
	const right = normalizeToken(b);
	if (!left || !right) return false;
	if (left.length < 3 || right.length < 3) return false;
	return left.includes(right) || right.includes(left);
};

/**
 * Score a single candidate against a DNS hostname. Higher is better.
 */
export const scoreInventoryHostnameMatch = (
	host: string,
	candidate: InventoryServiceCandidate,
): Scored | null => {
	const normalizedHost = normalizeInventoryHost(host);
	if (!normalizedHost) return null;

	const labels = inventoryHostnameLabels(normalizedHost);
	const left = labels[0] ?? "";
	let score = 0;
	let matchedComposeService: string | null = null;

	for (const hint of candidate.hostnameHints) {
		if (normalizeInventoryHost(hint) === normalizedHost) {
			score = Math.max(score, 100);
		} else if (left && scoreTokenEquality(hint, left)) {
			score = Math.max(score, 92);
		}
	}

	for (const serviceName of candidate.composeServiceNames) {
		if (left && scoreTokenEquality(serviceName, left)) {
			score = Math.max(score, 90);
			matchedComposeService = serviceName;
		} else if (left && scoreTokenLoose(serviceName, left)) {
			score = Math.max(score, 55);
			matchedComposeService ??= serviceName;
		}
	}

	if (left && scoreTokenEquality(candidate.appName, left)) {
		score = Math.max(score, 85);
	} else if (left && scoreTokenLoose(candidate.appName, left)) {
		score = Math.max(score, 45);
	}

	if (left && scoreTokenEquality(candidate.displayName, left)) {
		score = Math.max(score, 80);
	} else if (left && scoreTokenLoose(candidate.displayName, left)) {
		score = Math.max(score, 48);
	}

	// Prefer host-publishing compose services when the leftmost label only
	// loosely matched the stack (common for DB endpoints like devdb → postgres).
	if (
		candidate.kind === "compose" &&
		candidate.hostPublishingServices.length > 0
	) {
		if (
			matchedComposeService &&
			candidate.hostPublishingServices.includes(matchedComposeService)
		) {
			score += 8;
		} else if (!matchedComposeService && score >= 40 && score < MIN_SCORE) {
			// Single host-published service in the stack + weak name signal.
			if (candidate.hostPublishingServices.length === 1) {
				matchedComposeService = candidate.hostPublishingServices[0] ?? null;
				score = Math.max(score, MIN_SCORE);
			}
		} else if (
			!matchedComposeService &&
			score >= MIN_SCORE &&
			candidate.hostPublishingServices.length === 1
		) {
			matchedComposeService = candidate.hostPublishingServices[0] ?? null;
			score += 5;
		}
	}

	if (score < MIN_SCORE) return null;

	const confidence: InventoryServiceMatch["confidence"] =
		score >= 85 ? "high" : score >= 65 ? "medium" : "low";

	const serviceLabel =
		candidate.kind === "compose" && matchedComposeService
			? `${candidate.displayName} · ${matchedComposeService}`
			: candidate.displayName;

	return {
		score,
		match: {
			kind: candidate.kind,
			applicationId: candidate.applicationId,
			composeId: candidate.composeId,
			projectId: candidate.projectId,
			environmentId: candidate.environmentId,
			serviceName: serviceLabel,
			matchedComposeService:
				candidate.kind === "compose" ? matchedComposeService : null,
			confidence,
			score,
		},
	};
};

/**
 * Pick the best unique match. Ambiguous top scores return null.
 */
export const matchDnsHostnameToService = (
	host: string,
	candidates: InventoryServiceCandidate[],
): InventoryServiceMatch | null => {
	const scored: Scored[] = [];
	for (const candidate of candidates) {
		const result = scoreInventoryHostnameMatch(host, candidate);
		if (result) scored.push(result);
	}
	if (scored.length) {
		scored.sort((a, b) => b.score - a.score);
		const best = scored[0];
		const second = scored[1];
		if (!best) return null;
		if (second && second.score === best.score) {
			const bestKey = `${best.match.kind}:${best.match.composeId ?? best.match.applicationId}`;
			const secondKey = `${second.match.kind}:${second.match.composeId ?? second.match.applicationId}`;
			if (bestKey !== secondKey) return null;
		}
		return best.match;
	}

	// Fallback for host-published DB endpoints (e.g. devdb.example.com → the
	// only compose service that publishes a host port) when names do not align.
	const left = inventoryHostnameLabels(host)[0] ?? "";
	const genericLabels = new Set([
		"www",
		"api",
		"app",
		"mail",
		"ftp",
		"cdn",
		"dev",
		"staging",
		"prod",
	]);
	if (!left || genericLabels.has(left)) return null;

	const hostPublishStacks = candidates.filter(
		(c) => c.kind === "compose" && c.hostPublishingServices.length > 0,
	);
	if (hostPublishStacks.length !== 1) return null;
	const only = hostPublishStacks[0];
	if (!only || only.hostPublishingServices.length !== 1) return null;
	const matchedComposeService = only.hostPublishingServices[0] ?? null;
	if (!matchedComposeService) return null;

	return {
		kind: "compose",
		applicationId: null,
		composeId: only.composeId,
		projectId: only.projectId,
		environmentId: only.environmentId,
		serviceName: `${only.displayName} · ${matchedComposeService}`,
		matchedComposeService,
		confidence: "low",
		score: MIN_SCORE,
	};
};
