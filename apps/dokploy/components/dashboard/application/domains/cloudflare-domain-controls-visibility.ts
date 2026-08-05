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
	/** Render the "Cloudflare DNS settings" block at all. */
	showSection: boolean;
	/** Cloudflare is unreachable — explain instead of offering switches. */
	showReconnectHint: boolean;
	showManagedToggle: boolean;
	showProxyToggle: boolean;
};

/**
 * Which Cloudflare controls an existing domain shows. The managed switch stays
 * mounted whatever the answer is, so enabling management never looks like the
 * control mutated; the proxy switch only exists once Cloudflare owns the host.
 */
export const deriveCloudflareDomainControlsVisibility = (input: {
	isConnected: boolean;
	isCloudflareManaged: boolean;
}): CloudflareDomainControlsVisibility => ({
	showSection: input.isConnected || input.isCloudflareManaged,
	showReconnectHint: !input.isConnected,
	showManagedToggle: input.isConnected,
	showProxyToggle: input.isConnected && input.isCloudflareManaged,
});
