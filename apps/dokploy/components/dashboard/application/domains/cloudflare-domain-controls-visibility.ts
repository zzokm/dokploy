/**
 * Managed state shown to the user: the in-flight switch position while a
 * mutation runs, otherwise whatever the domain row says. Once the overlay is
 * cleared the server is the only source of truth, so a failed mutation cannot
 * leave the switch stuck on a value the database never accepted.
 */
export const resolveCloudflareManagedState = (input: {
	pendingManaged: boolean | null;
	dnsProvider: string | null | undefined;
}) => input.pendingManaged ?? input.dnsProvider === "cloudflare";

export type CloudflareDomainControlsVisibility = {
	/** Render the Auto DNS settings block at all. */
	showSection: boolean;
	/** Provider unreachable — explain instead of offering switches. */
	showReconnectHint: boolean;
	showManagedToggle: boolean;
	/** @deprecated Always false — CF proxy is adapter policy, not a UI control. */
	showProxyToggle: boolean;
	/** Show Sync DNS when managed. */
	showSyncAction: boolean;
};

/**
 * Auto DNS controls for an existing domain. Proxy toggle is never shown —
 * Cloudflare adapter always forces proxied:true.
 */
export const deriveCloudflareDomainControlsVisibility = (input: {
	isConnected: boolean;
	isCloudflareManaged: boolean;
}): CloudflareDomainControlsVisibility => ({
	showSection: input.isConnected || input.isCloudflareManaged,
	showReconnectHint: !input.isConnected,
	showManagedToggle: input.isConnected,
	showProxyToggle: false,
	showSyncAction: input.isConnected && input.isCloudflareManaged,
});
