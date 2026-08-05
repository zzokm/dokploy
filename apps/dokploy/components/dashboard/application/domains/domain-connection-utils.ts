import type { HealthBadge } from "@/components/dashboard/domains/domain-inventory-utils";

export type ConnectionBadge = HealthBadge | "Checking" | "Not checked";

const FAILED_CHECK_STATUSES = new Set([
	"dns_mismatch",
	"dns_no_answer",
	"server_unreachable",
	"error",
]);

/**
 * Connection badge for a single domain. Prefers the stored connection check,
 * falls back to the DNS validation already run on the domain card, and stays
 * neutral when nothing has been checked — an unchecked domain is not "Pending".
 */
export const deriveConnectionBadge = (input: {
	checkStatus?: string | null;
	isChecking?: boolean;
	dnsValidation?: { isLoading: boolean; isValid?: boolean };
}): ConnectionBadge => {
	if (
		input.isChecking ||
		input.dnsValidation?.isLoading ||
		input.checkStatus === "checking"
	) {
		return "Checking";
	}
	if (input.checkStatus === "active") {
		return "Valid";
	}
	if (input.checkStatus && FAILED_CHECK_STATUSES.has(input.checkStatus)) {
		return "Failed";
	}
	if (input.dnsValidation?.isValid === true) {
		return "Valid";
	}
	if (input.dnsValidation?.isValid === false) {
		return "Failed";
	}
	return "Not checked";
};

export const connectionBadgeClass = (badge: ConnectionBadge) => {
	switch (badge) {
		case "Valid":
			return "bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400";
		case "Failed":
			return "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400";
		case "Checking":
		case "Pending":
			return "bg-yellow-500/10 text-yellow-800 border-yellow-500/20 dark:text-yellow-300";
		default:
			return "border-transparent bg-muted text-muted-foreground";
	}
};

export type CloudflareConnectionState = {
	managed: boolean;
	synced: boolean;
	zoneName: string | null;
	proxied: boolean | null;
	lastSyncedAt: string | null;
	status: "synced" | "pending" | "error" | null;
};

export const cloudflareConnectionLabel = (state: CloudflareConnectionState) => {
	if (state.status === "error") {
		return "Cloudflare sync failed";
	}
	if (!state.synced) {
		return "Cloudflare sync pending";
	}
	return "DNS managed by Cloudflare";
};

export const cloudflareConnectionDetails = (
	state: CloudflareConnectionState,
	syncedLabel: string | null,
) =>
	[
		state.zoneName,
		state.proxied === null ? null : state.proxied ? "Proxied" : "DNS only",
		syncedLabel,
	].filter((part): part is string => !!part);
