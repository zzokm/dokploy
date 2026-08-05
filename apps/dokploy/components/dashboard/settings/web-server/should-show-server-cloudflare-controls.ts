/**
 * The server domain Cloudflare panel (DNS sync + proxy switch) is only offered
 * when the user keeps the managed switch on, the saved host belongs to a synced
 * zone, and the form still shows that saved host.
 */
export const shouldShowServerCloudflareControls = (input: {
	cloudflareModeEnabled: boolean;
	isCloudflareManagedHost: boolean;
	formMatchesSavedHost: boolean;
}) =>
	input.cloudflareModeEnabled &&
	input.isCloudflareManagedHost &&
	input.formMatchesSavedHost;
