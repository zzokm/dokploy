import type { DnsProviderId } from "./types";

/** Lego / Traefik env var names per provider (DNS-01). */
export const DNS_PROVIDER_TRAEFIK_ENV: Partial<
	Record<DnsProviderId, { envKey: string; valueFrom: "secret" | "meta" }>
> = {
	cloudflare: { envKey: "CF_DNS_API_TOKEN", valueFrom: "secret" },
	digitalocean: { envKey: "DO_AUTH_TOKEN", valueFrom: "secret" },
	hetzner: { envKey: "HETZNER_API_KEY", valueFrom: "secret" },
	route53: { envKey: "AWS_SECRET_ACCESS_KEY", valueFrom: "secret" },
	// GCloud typically needs a mounted SA file — env-only path is incomplete.
};

export const mergeDnsProviderEnv = (
	env: string[],
	input: { envKey: string; value: string },
) => {
	const entry = `${input.envKey}=${input.value}`;
	const prefix = `${input.envKey}=`;
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

/** Extra AWS key id for Route53 when secret JSON is not used. */
export const mergeAwsAccessKeyIdEnv = (
	env: string[],
	accessKeyId: string,
) => mergeDnsProviderEnv(env, { envKey: "AWS_ACCESS_KEY_ID", value: accessKeyId });
