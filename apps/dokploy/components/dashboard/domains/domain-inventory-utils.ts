export type HealthBadge = "Valid" | "Failed" | "Pending";

export type InventoryDnsBadge = HealthBadge | "Manual";

export type InventorySslBadge = HealthBadge | "None" | "Custom";

export type InventoryRoutedBadge = "Routed" | "Not routed" | "Pending";

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
	dnsProvider: "none" | "cloudflare";
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
 * SSL health without live ACME inspection: configured cert type + recent create window.
 * Let's Encrypt stays Pending briefly after create, then Valid.
 */
export const inventorySslBadge = (input: {
	certificateType: "none" | "letsencrypt" | "custom";
	https: boolean;
	createdAt?: string;
}): InventorySslBadge => {
	if (input.certificateType === "none" || !input.https) {
		return "None";
	}
	if (input.certificateType === "custom") {
		return "Custom";
	}
	if (isRecentlyCreatedDomain(input.createdAt)) {
		return "Pending";
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

export const inventoryRoutedBadge = (status: "routed" | "not_routed" | "pending"): InventoryRoutedBadge => {
	if (status === "routed") return "Routed";
	if (status === "not_routed") return "Not routed";
	return "Pending";
};

export type InventorySyncBadge = "Synced" | "Pending" | "Error" | "—";

export const inventorySyncBadge = (input: {
	dnsProvider: "none" | "cloudflare";
	cfStatus: "synced" | "pending" | "error" | null;
}): InventorySyncBadge => {
	if (input.dnsProvider !== "cloudflare") {
		return "—";
	}
	if (input.cfStatus === "synced") return "Synced";
	if (input.cfStatus === "error") return "Error";
	return "Pending";
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
