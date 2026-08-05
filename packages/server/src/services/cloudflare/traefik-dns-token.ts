import { db } from "@dokploy/server/db";
import { cloudflareSettings } from "@dokploy/server/db/schema";
import { unsealString } from "@dokploy/server/utils/crypto/seal";
import { prepareEnvironmentVariables } from "@dokploy/server/utils/docker/utils";
import { eq } from "drizzle-orm";
import {
	readEnvironmentVariables,
	readPorts,
	writeTraefikSetup,
} from "../settings";
import { mergeCloudflareDnsTokenEnv } from "./traefik-dns-token-utils";

export type EnsureTraefikCloudflareDnsTokenResult = {
	applied: boolean;
	reason:
		| "applied"
		| "already_configured"
		| "no_cloudflare_settings"
		| "token_unseal_failed"
		| "traefik_unavailable";
};

/**
 * Cloudflare-proxied domains get `certresolver=letsencrypt-cloudflare`, which
 * resolves ACME over DNS-01 and therefore needs the API token in Traefik's
 * environment. Without it Traefik silently falls back to its self-signed
 * default certificate and Cloudflare answers 5xx on every request.
 */
export const ensureTraefikCloudflareDnsToken = async (input: {
	organizationId: string;
	serverId?: string;
}): Promise<EnsureTraefikCloudflareDnsTokenResult> => {
	const [settings] = await db
		.select({ apiTokenEncrypted: cloudflareSettings.apiTokenEncrypted })
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, input.organizationId))
		.limit(1);

	if (!settings) {
		return { applied: false, reason: "no_cloudflare_settings" };
	}

	let token = "";
	try {
		token = unsealString(settings.apiTokenEncrypted);
	} catch {
		return { applied: false, reason: "token_unseal_failed" };
	}

	try {
		const currentEnv = await readEnvironmentVariables(
			"dokploy-traefik",
			input.serverId,
		);
		const merged = mergeCloudflareDnsTokenEnv(
			prepareEnvironmentVariables(currentEnv),
			token,
		);
		if (!merged.changed) {
			return { applied: false, reason: "already_configured" };
		}

		const ports = await readPorts("dokploy-traefik", input.serverId);
		await writeTraefikSetup({
			env: merged.env,
			additionalPorts: ports,
			serverId: input.serverId,
		});
		return { applied: true, reason: "applied" };
	} catch {
		return { applied: false, reason: "traefik_unavailable" };
	}
};
