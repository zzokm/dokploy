import { prepareEnvironmentVariables } from "@dokploy/server/utils/docker/utils";
import {
	readEnvironmentVariables,
	readPorts,
	writeTraefikSetup,
} from "../settings";
import { resolveDnsProviderSecret } from "./credentials";
import {
	mergeAwsAccessKeyIdEnv,
	mergeDnsProviderEnv,
	DNS_PROVIDER_TRAEFIK_ENV,
} from "./traefik-dns-env";
import type { DnsProviderId } from "./types";
import { DNS_PROVIDER_CAPABILITIES } from "./types";

export type EnsureTraefikDnsTokenResult = {
	applied: boolean;
	reason:
		| "applied"
		| "already_configured"
		| "no_credentials"
		| "token_unseal_failed"
		| "provider_unsupported"
		| "http01_only"
		| "traefik_unavailable";
	provider?: DnsProviderId;
};

/**
 * Inject provider DNS-01 credentials into Traefik env when the adapter
 * requires DNS-01 (or when explicitly requested for optional DNS-01 providers).
 * Cloudflare always uses CF_DNS_API_TOKEN. Non-proxy providers default HTTP-01
 * and skip injection unless forceDns01 is true.
 */
export const ensureTraefikDnsProviderToken = async (input: {
	organizationId: string;
	provider: DnsProviderId;
	credentialId?: string;
	serverId?: string;
	/** Inject even when requiresDns01WhenManaged is false (optional DNS-01). */
	forceDns01?: boolean;
}): Promise<EnsureTraefikDnsTokenResult> => {
	const caps = DNS_PROVIDER_CAPABILITIES[input.provider];
	if (!caps.supportsDns01) {
		return { applied: false, reason: "provider_unsupported", provider: input.provider };
	}
	if (!caps.requiresDns01WhenManaged && !input.forceDns01) {
		return { applied: false, reason: "http01_only", provider: input.provider };
	}

	const envSpec = DNS_PROVIDER_TRAEFIK_ENV[input.provider];
	if (!envSpec) {
		return { applied: false, reason: "provider_unsupported", provider: input.provider };
	}

	let resolved: Awaited<ReturnType<typeof resolveDnsProviderSecret>>;
	try {
		resolved = await resolveDnsProviderSecret({
			organizationId: input.organizationId,
			credentialId: input.credentialId,
			provider: input.provider,
		});
	} catch {
		return { applied: false, reason: "token_unseal_failed", provider: input.provider };
	}

	if (!resolved) {
		return { applied: false, reason: "no_credentials", provider: input.provider };
	}

	let secretValue = resolved.secret;
	let accessKeyId: string | undefined;

	if (input.provider === "route53") {
		try {
			const parsed = JSON.parse(resolved.secret) as {
				accessKeyId?: string;
				secretAccessKey?: string;
			};
			if (parsed.secretAccessKey) {
				secretValue = parsed.secretAccessKey;
				accessKeyId = parsed.accessKeyId;
			}
		} catch {
			// secret is raw secretAccessKey; accessKeyId must come from vault meta — not available here
		}
	}

	try {
		const currentEnv = await readEnvironmentVariables(
			"dokploy-traefik",
			input.serverId,
		);
		let env = prepareEnvironmentVariables(currentEnv);
		let changed = false;

		const merged = mergeDnsProviderEnv(env, {
			envKey: envSpec.envKey,
			value: secretValue,
		});
		env = merged.env;
		changed = merged.changed;

		if (accessKeyId) {
			const aws = mergeAwsAccessKeyIdEnv(env, accessKeyId);
			env = aws.env;
			changed = changed || aws.changed;
		}

		if (!changed) {
			return {
				applied: false,
				reason: "already_configured",
				provider: input.provider,
			};
		}

		const ports = await readPorts("dokploy-traefik", input.serverId);
		await writeTraefikSetup({
			env,
			additionalPorts: ports,
			serverId: input.serverId,
		});
		return { applied: true, reason: "applied", provider: input.provider };
	} catch {
		return {
			applied: false,
			reason: "traefik_unavailable",
			provider: input.provider,
		};
	}
};
