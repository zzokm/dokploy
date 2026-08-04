export type InventoryDnsBadge = "Valid" | "Failed" | "Pending" | "Manual";

/** Map stored Cloudflare sync status to a friendly DNS column badge (inventory). */
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

/**
 * Compose domains only get Traefik labels on deploy. If the domain was created
 * after the last successful deploy (or never deployed), treat as not routed.
 * Application domains write Traefik file config on create → routed.
 */
export const deriveRoutedStatus = (input: {
	kind: "application" | "compose" | "preview" | "web-server";
	createdAt: string;
	lastSuccessfulDeployAt: string | null;
}): "routed" | "not_routed" | "pending" => {
	if (input.kind === "web-server" || input.kind === "application") {
		return "routed";
	}
	if (input.kind === "preview") {
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
