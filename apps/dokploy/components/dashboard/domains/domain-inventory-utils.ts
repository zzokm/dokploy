export type HealthBadge = "Valid" | "Failed" | "Pending";

export type InventoryDnsBadge = HealthBadge | "Manual";

export type InventorySslBadge = HealthBadge | "None" | "Custom";

const DNS_ERRNO_PATTERN =
	/\b(ENOTFOUND|ENODATA|EAI_AGAIN|ESERVFAIL|ETIMEOUT|ETIMEDOUT|ENOTIMP|EREFUSED)\b/i;

const RECENT_DOMAIN_WINDOW_MS = 10 * 60 * 1000;

export const sanitizeDnsValidationError = (error?: string) => {
	if (!error) {
		return "DNS validation failed";
	}
	if (DNS_ERRNO_PATTERN.test(error) || /^query[A-Z]?\s/i.test(error)) {
		return "DNS records not found yet. Propagation can take a few minutes.";
	}
	return error;
};

export const isRecentlyCreatedDomain = (createdAt?: string) => {
	if (!createdAt) return false;
	const createdAtMs = new Date(createdAt).getTime();
	if (Number.isNaN(createdAtMs)) return false;
	return Date.now() - createdAtMs < RECENT_DOMAIN_WINDOW_MS;
};

/** Fallback DNS badge from Cloudflare sync fields before live validation finishes. */
export const inventoryDnsBadgeFromCfStatus = (input: {
	dnsProvider:
		| "none"
		| "cloudflare"
		| "digitalocean"
		| "hetzner"
		| "route53"
		| "gcloud"
		| "ns1"
		| "akamai";
	cfStatus: "synced" | "pending" | "error" | null;
}): InventoryDnsBadge => {
	if (input.dnsProvider !== "cloudflare") {
		return "Manual";
	}
	if (input.cfStatus === "synced") {
		return "Valid";
	}
	if (input.cfStatus === "error") {
		return "Failed";
	}
	return "Pending";
};

export const inventoryDnsBadgeFromValidation = (input: {
	isLoading: boolean;
	isValid?: boolean;
}): HealthBadge => {
	if (input.isLoading || input.isValid === undefined) {
		return "Pending";
	}
	return input.isValid ? "Valid" : "Failed";
};

/**
 * SSL health: configured cert type + optional live TLS probe + recent-create window.
 * Live TLS (`tlsReachable === true`) wins over the recent-create Pending heuristic.
 */
export const inventorySslBadge = (input: {
	certificateType: "none" | "letsencrypt" | "custom";
	https: boolean;
	createdAt?: string;
	/** When true, certificate is confirmed via TLS handshake. */
	tlsReachable?: boolean | null;
}): InventorySslBadge => {
	if (input.certificateType === "none" || !input.https) {
		return "None";
	}
	if (input.certificateType === "custom") {
		return "Custom";
	}
	if (input.tlsReachable === true) {
		return "Valid";
	}
	if (isRecentlyCreatedDomain(input.createdAt)) {
		return "Pending";
	}
	// Established Let's Encrypt without a probe — assume Valid (app domains).
	if (input.tlsReachable === false) {
		return "Failed";
	}
	return "Valid";
};

export const inventorySslLabel = (input: {
	certificateType: "none" | "letsencrypt" | "custom";
	https: boolean;
}) => {
	if (input.certificateType === "none" || !input.https) {
		return "None";
	}
	if (input.certificateType === "custom") {
		return "Custom";
	}
	return "Let's Encrypt";
};

export const latestSyncIso = (timestamps: Array<string | null | undefined>) => {
	let latest: number | null = null;
	for (const value of timestamps) {
		if (!value) continue;
		const ms = new Date(value).getTime();
		if (Number.isNaN(ms)) continue;
		if (latest === null || ms > latest) latest = ms;
	}
	return latest === null ? null : new Date(latest).toISOString();
};

/**
 * Compose domains only get Traefik labels on deploy (GPA: domain in DB without
 * labels until redeploy). Application domains write Traefik file config on create.
 */
export const deriveRoutedStatus = (input: {
	kind: "application" | "compose" | "preview" | "web-server";
	createdAt: string;
	lastSuccessfulDeployAt: string | null;
}): "routed" | "not_routed" | "pending" => {
	if (
		input.kind === "web-server" ||
		input.kind === "application" ||
		input.kind === "preview"
	) {
		return "routed";
	}
	if (!input.lastSuccessfulDeployAt) {
		return "not_routed";
	}
	const createdMs = new Date(input.createdAt).getTime();
	const deployMs = new Date(input.lastSuccessfulDeployAt).getTime();
	if (Number.isNaN(createdMs) || Number.isNaN(deployMs)) {
		return "pending";
	}
	return createdMs > deployMs ? "not_routed" : "routed";
};

export const buildDomainEditHref = (input: {
	kind: "application" | "compose" | "preview" | "web-server";
	projectId: string | null;
	environmentId: string | null;
	applicationId: string | null;
	composeId: string | null;
	domainId: string;
}): string | null => {
	if (input.kind === "web-server") {
		return "/dashboard/settings/server";
	}
	if (!input.projectId || !input.environmentId) {
		return null;
	}
	if (input.kind === "compose" && input.composeId) {
		return `/dashboard/project/${input.projectId}/environment/${input.environmentId}/services/compose/${input.composeId}?tab=domains&domainId=${encodeURIComponent(input.domainId)}`;
	}
	if (input.applicationId) {
		return `/dashboard/project/${input.projectId}/environment/${input.environmentId}/services/application/${input.applicationId}?tab=domains&domainId=${encodeURIComponent(input.domainId)}`;
	}
	return null;
};

/** Public URL for a provisioned hostname (opens in a new tab). */
export const buildHostnameExternalUrl = (input: {
	host: string;
	https: boolean;
}): string => {
	const host = input.host.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
	const scheme = input.https ? "https" : "http";
	return `${scheme}://${host}`;
};

export const openProjectButtonLabel = (
	kind: "application" | "compose" | "preview" | "web-server",
) => {
	if (kind === "web-server") return "Open settings";
	return "Open project";
};

export const dnsRecordManagedByLabel = (managedBy: string) => {
	if (managedBy === "app_domain") return "App domain";
	if (managedBy === "manual") return "Manual";
	if (managedBy === "mail_stack") return "Legacy";
	return managedBy;
};

export const isPreviewableDnsRecordType = (type: string) => {
	const normalized = type.trim().toUpperCase();
	return normalized === "A" || normalized === "AAAA" || normalized === "CNAME";
};

/**
 * Cloudflare only proxies A, AAAA, and CNAME records. Everything else has no
 * proxy setting at all, which is different from an unproxied A record.
 */
export type DnsProxyState = "proxied" | "dns_only" | "not_proxyable";

const PROXYABLE_DNS_RECORD_TYPES = new Set(["A", "AAAA", "CNAME"]);

export const isProxyableDnsRecordType = (type: string) =>
	PROXYABLE_DNS_RECORD_TYPES.has(type.trim().toUpperCase());

export const deriveDnsProxyState = (input: {
	type: string;
	proxied?: boolean | null;
}): DnsProxyState => {
	if (!isProxyableDnsRecordType(input.type)) {
		return "not_proxyable";
	}
	return input.proxied ? "proxied" : "dns_only";
};

export const dnsProxyStateLabel = (state: DnsProxyState) => {
	if (state === "proxied") return "Proxied";
	if (state === "dns_only") return "DNS only";
	return "N/A";
};

export const dnsProxyStateHint = (state: DnsProxyState) => {
	if (state === "proxied") {
		return "Traffic for this record goes through the Cloudflare proxy.";
	}
	if (state === "dns_only") {
		return "Cloudflare answers this record without proxying traffic.";
	}
	return "Proxying only applies to A, AAAA, and CNAME records.";
};

/** Cloudflare TTL: 1 means Auto, otherwise a value of at least 60 seconds. */
export const parseDnsTtl = (value: string): number => {
	const n = Number(value);
	if (n === 1) return 1;
	if (Number.isFinite(n) && n >= 60) return Math.floor(n);
	return 1;
};

export type InventoryWarningKind =
	| "redeploy_traefik"
	| "host_publish_port"
	| "cert_pending";

export type InventoryWarning = {
	kind: InventoryWarningKind;
	label: string;
	hint: string;
};

/**
 * Actionable inventory warnings that reduce support pain. Aligns with existing
 * routed / SSL badge heuristics and host-publish port detection from inventory.
 */
export const deriveInventoryWarnings = (input: {
	kind: "application" | "compose" | "preview" | "web-server";
	createdAt: string;
	lastSuccessfulDeployAt: string | null;
	certificateType: "none" | "letsencrypt" | "custom";
	https: boolean;
	portLooksLikeHostPublish?: boolean;
	port?: number | null;
	tlsReachable?: boolean | null;
}): InventoryWarning[] => {
	const warnings: InventoryWarning[] = [];

	const routed = deriveRoutedStatus({
		kind: input.kind,
		createdAt: input.createdAt,
		lastSuccessfulDeployAt: input.lastSuccessfulDeployAt,
	});
	if (routed === "not_routed") {
		warnings.push({
			kind: "redeploy_traefik",
			label: "Redeploy required",
			hint: "Domain added after last deploy — redeploy to apply Traefik",
		});
	}

	if (input.portLooksLikeHostPublish) {
		const portHint =
			input.port != null
				? `Port ${input.port} matches a host publish mapping — use the container listen port instead.`
				: "Port looks like a host publish port — use the container listen port instead.";
		warnings.push({
			kind: "host_publish_port",
			label: "Host publish port",
			hint: portHint,
		});
	}

	const ssl = inventorySslBadge({
		certificateType: input.certificateType,
		https: input.https,
		createdAt: input.createdAt,
		tlsReachable: input.tlsReachable,
	});
	if (ssl === "Pending") {
		warnings.push({
			kind: "cert_pending",
			label: "Cert pending",
			hint: "Let's Encrypt certificate is still being issued. This usually finishes within a few minutes.",
		});
	}

	return warnings;
};
