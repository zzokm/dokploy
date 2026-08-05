export const CLOUDFLARE_DNS_TOKEN_ENV = "CF_DNS_API_TOKEN";

/**
 * Returns the Traefik env with the Cloudflare DNS-01 token set, plus whether it
 * actually had to change — recreating Traefik briefly drops all traffic, so we
 * only do it when the token is missing or stale.
 */
export const mergeCloudflareDnsTokenEnv = (env: string[], token: string) => {
	const entry = `${CLOUDFLARE_DNS_TOKEN_ENV}=${token}`;
	const prefix = `${CLOUDFLARE_DNS_TOKEN_ENV}=`;
	const existingIndex = env.findIndex((value) => value.startsWith(prefix));

	if (existingIndex === -1) {
		return { env: [...env, entry], changed: true };
	}
	if (env[existingIndex] === entry) {
		return { env, changed: false };
	}
	const next = [...env];
	next[existingIndex] = entry;
	return { env: next, changed: true };
};
