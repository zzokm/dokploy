import { and, eq } from "drizzle-orm";
import { db } from "@dokploy/server/db";
import {
	cloudflareSettings,
	dnsProviderCredential,
	type DnsProviderMeta,
} from "@dokploy/server/db/schema";
import {
	canSealSecrets,
	sealString,
	unsealString,
} from "@dokploy/server/utils/crypto/seal";
import { nanoid } from "nanoid";

export type DnsProviderId =
	| "cloudflare"
	| "digitalocean"
	| "hetzner"
	| "route53"
	| "gcloud"
	| "ns1"
	| "akamai";

/** Public credential view — never includes sealed or raw secret. */
export type DnsProviderCredentialPublic = {
	id: string;
	organizationId: string;
	provider: DnsProviderId;
	label: string;
	secretLast4: string;
	meta: DnsProviderMeta;
	createdAt: Date;
	updatedAt: Date;
	/** True when row is synthesized from legacy `cloudflare_settings`. */
	legacyCloudflare?: boolean;
};

const LEGACY_CLOUDFLARE_ID_PREFIX = "legacy-cf:";

const toPublic = (
	row: typeof dnsProviderCredential.$inferSelect,
	extra?: { legacyCloudflare?: boolean },
): DnsProviderCredentialPublic => ({
	id: row.id,
	organizationId: row.organizationId,
	provider: row.provider as DnsProviderId,
	label: row.label,
	secretLast4: row.secretLast4,
	meta: (row.meta ?? {}) as DnsProviderMeta,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
	...extra,
});

const assertCanSeal = () => {
	if (!canSealSecrets()) {
		throw new Error(
			"DOKPLOY_ENCRYPTION_KEY is required to store DNS provider secrets securely",
		);
	}
};

const sealOrThrow = (plain: string) => {
	assertCanSeal();
	try {
		return sealString(plain);
	} catch {
		throw new Error(
			"DOKPLOY_ENCRYPTION_KEY is invalid. Provide a base64-encoded 32-byte key.",
		);
	}
};

const last4 = (secret: string) => secret.slice(-4);

const findVaultRowsForOrg = async (organizationId: string) => {
	return db
		.select()
		.from(dnsProviderCredential)
		.where(eq(dnsProviderCredential.organizationId, organizationId));
};

const findVaultCloudflare = async (organizationId: string) => {
	const [row] = await db
		.select()
		.from(dnsProviderCredential)
		.where(
			and(
				eq(dnsProviderCredential.organizationId, organizationId),
				eq(dnsProviderCredential.provider, "cloudflare"),
			),
		)
		.limit(1);
	return row ?? null;
};

const findLegacyCloudflareSettings = async (organizationId: string) => {
	const [row] = await db
		.select()
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, organizationId))
		.limit(1);
	return row ?? null;
};

const legacyCloudflarePublic = (
	organizationId: string,
	settings: typeof cloudflareSettings.$inferSelect,
): DnsProviderCredentialPublic => ({
	id: `${LEGACY_CLOUDFLARE_ID_PREFIX}${organizationId}`,
	organizationId,
	provider: "cloudflare",
	label: "Cloudflare",
	secretLast4: settings.apiTokenLast4,
	meta: {},
	createdAt: settings.createdAt,
	updatedAt: settings.updatedAt,
	legacyCloudflare: true,
});

/**
 * List credentials for an org (last4 only).
 * Dual-read: if vault has no cloudflare row, surface legacy `cloudflare_settings`.
 */
export const listDnsProviderCredentials = async (
	organizationId: string,
): Promise<DnsProviderCredentialPublic[]> => {
	const rows = await findVaultRowsForOrg(organizationId);
	const publicRows = rows.map((r) => toPublic(r));

	const hasCloudflare = rows.some((r) => r.provider === "cloudflare");
	if (!hasCloudflare) {
		const legacy = await findLegacyCloudflareSettings(organizationId);
		if (legacy) {
			publicRows.push(legacyCloudflarePublic(organizationId, legacy));
		}
	}

	return publicRows;
};

/**
 * Get a credential by id (last4 only). Supports legacy-cf:{orgId} virtual ids.
 */
export const getDnsProviderCredential = async (
	organizationId: string,
	credentialId: string,
): Promise<DnsProviderCredentialPublic | null> => {
	if (credentialId === `${LEGACY_CLOUDFLARE_ID_PREFIX}${organizationId}`) {
		const vaultCf = await findVaultCloudflare(organizationId);
		if (vaultCf) {
			return toPublic(vaultCf);
		}
		const legacy = await findLegacyCloudflareSettings(organizationId);
		return legacy ? legacyCloudflarePublic(organizationId, legacy) : null;
	}

	const [row] = await db
		.select()
		.from(dnsProviderCredential)
		.where(
			and(
				eq(dnsProviderCredential.id, credentialId),
				eq(dnsProviderCredential.organizationId, organizationId),
			),
		)
		.limit(1);

	return row ? toPublic(row) : null;
};

export type SetDnsProviderCredentialInput = {
	organizationId: string;
	provider: DnsProviderId;
	label: string;
	secret: string;
	meta?: DnsProviderMeta;
};

/**
 * Create a vault credential. Fails closed if sealing is unavailable.
 * Never returns the raw secret — last4 only.
 */
export const setDnsProviderCredential = async (
	input: SetDnsProviderCredentialInput,
): Promise<DnsProviderCredentialPublic> => {
	const secretEncrypted = sealOrThrow(input.secret);
	const now = new Date();
	const id = nanoid();

	const [row] = await db
		.insert(dnsProviderCredential)
		.values({
			id,
			organizationId: input.organizationId,
			provider: input.provider,
			label: input.label,
			secretEncrypted,
			secretLast4: last4(input.secret),
			meta: input.meta ?? {},
			createdAt: now,
			updatedAt: now,
		})
		.returning();

	if (!row) {
		throw new Error("Failed to persist DNS provider credential");
	}

	return toPublic(row);
};

export type RotateDnsProviderCredentialInput = {
	organizationId: string;
	credentialId: string;
	secret: string;
	label?: string;
	meta?: DnsProviderMeta;
};

/**
 * Rotate sealed secret for an existing vault row.
 * Legacy cloudflare_settings-only orgs: creates a vault row instead.
 */
export const rotateDnsProviderCredential = async (
	input: RotateDnsProviderCredentialInput,
): Promise<DnsProviderCredentialPublic> => {
	const secretEncrypted = sealOrThrow(input.secret);
	const now = new Date();

	if (
		input.credentialId ===
		`${LEGACY_CLOUDFLARE_ID_PREFIX}${input.organizationId}`
	) {
		const existing = await findVaultCloudflare(input.organizationId);
		if (existing) {
			const [updated] = await db
				.update(dnsProviderCredential)
				.set({
					secretEncrypted,
					secretLast4: last4(input.secret),
					...(input.label !== undefined ? { label: input.label } : {}),
					...(input.meta !== undefined ? { meta: input.meta } : {}),
					updatedAt: now,
				})
				.where(
					and(
						eq(dnsProviderCredential.id, existing.id),
						eq(
							dnsProviderCredential.organizationId,
							input.organizationId,
						),
					),
				)
				.returning();
			if (!updated) {
				throw new Error("Failed to rotate DNS provider credential");
			}
			return toPublic(updated);
		}

		return setDnsProviderCredential({
			organizationId: input.organizationId,
			provider: "cloudflare",
			label: input.label ?? "Cloudflare",
			secret: input.secret,
			meta: input.meta,
		});
	}

	const [updated] = await db
		.update(dnsProviderCredential)
		.set({
			secretEncrypted,
			secretLast4: last4(input.secret),
			...(input.label !== undefined ? { label: input.label } : {}),
			...(input.meta !== undefined ? { meta: input.meta } : {}),
			updatedAt: now,
		})
		.where(
			and(
				eq(dnsProviderCredential.id, input.credentialId),
				eq(dnsProviderCredential.organizationId, input.organizationId),
			),
		)
		.returning();

	if (!updated) {
		throw new Error("DNS provider credential not found");
	}

	return toPublic(updated);
};

/**
 * Delete a vault credential. Legacy virtual ids are a no-op on vault
 * (caller may separately clear `cloudflare_settings`).
 */
export const deleteDnsProviderCredential = async (
	organizationId: string,
	credentialId: string,
): Promise<{ deleted: boolean }> => {
	if (credentialId === `${LEGACY_CLOUDFLARE_ID_PREFIX}${organizationId}`) {
		const vaultCf = await findVaultCloudflare(organizationId);
		if (!vaultCf) {
			return { deleted: false };
		}
		credentialId = vaultCf.id;
	}

	const deleted = await db
		.delete(dnsProviderCredential)
		.where(
			and(
				eq(dnsProviderCredential.id, credentialId),
				eq(dnsProviderCredential.organizationId, organizationId),
			),
		)
		.returning({ id: dnsProviderCredential.id });

	return { deleted: deleted.length > 0 };
};

/**
 * Internal: unseal secret for adapters. Prefer vault; dual-read
 * `cloudflare_settings` when vault has no cloudflare credential.
 * Never expose via tRPC/MCP response shapes.
 */
export const resolveDnsProviderSecret = async (input: {
	organizationId: string;
	credentialId?: string;
	provider?: DnsProviderId;
}): Promise<{
	credentialId: string | null;
	provider: DnsProviderId;
	secret: string;
	legacyCloudflare: boolean;
} | null> => {
	const { organizationId, credentialId, provider } = input;

	if (credentialId) {
		if (credentialId === `${LEGACY_CLOUDFLARE_ID_PREFIX}${organizationId}`) {
			const vaultCf = await findVaultCloudflare(organizationId);
			if (vaultCf) {
				return {
					credentialId: vaultCf.id,
					provider: "cloudflare",
					secret: unsealString(vaultCf.secretEncrypted),
					legacyCloudflare: false,
				};
			}
			const legacy = await findLegacyCloudflareSettings(organizationId);
			if (!legacy) {
				return null;
			}
			return {
				credentialId: null,
				provider: "cloudflare",
				secret: unsealString(legacy.apiTokenEncrypted),
				legacyCloudflare: true,
			};
		}

		const [row] = await db
			.select()
			.from(dnsProviderCredential)
			.where(
				and(
					eq(dnsProviderCredential.id, credentialId),
					eq(dnsProviderCredential.organizationId, organizationId),
				),
			)
			.limit(1);

		if (!row) {
			return null;
		}

		return {
			credentialId: row.id,
			provider: row.provider as DnsProviderId,
			secret: unsealString(row.secretEncrypted),
			legacyCloudflare: false,
		};
	}

	const targetProvider = provider ?? "cloudflare";

	const [vaultRow] = await db
		.select()
		.from(dnsProviderCredential)
		.where(
			and(
				eq(dnsProviderCredential.organizationId, organizationId),
				eq(dnsProviderCredential.provider, targetProvider),
			),
		)
		.limit(1);

	if (vaultRow) {
		return {
			credentialId: vaultRow.id,
			provider: vaultRow.provider as DnsProviderId,
			secret: unsealString(vaultRow.secretEncrypted),
			legacyCloudflare: false,
		};
	}

	if (targetProvider === "cloudflare") {
		const legacy = await findLegacyCloudflareSettings(organizationId);
		if (legacy) {
			return {
				credentialId: null,
				provider: "cloudflare",
				secret: unsealString(legacy.apiTokenEncrypted),
				legacyCloudflare: true,
			};
		}
	}

	return null;
};
