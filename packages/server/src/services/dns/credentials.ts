import { and, asc, eq } from "drizzle-orm";
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
import {
	isPostgresUniqueViolation,
	pickDefaultDnsCredential,
} from "./credential-policy";
import type { DnsProviderId } from "./types";

export type { DnsProviderId };
export {
	dnsZoneMirrorKey,
	isPostgresUniqueViolation,
	pickDefaultDnsCredential,
} from "./credential-policy";

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

const DUPLICATE_LABEL_MESSAGE =
	"A credential with this label already exists for this provider. Choose a different label.";

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
		.where(eq(dnsProviderCredential.organizationId, organizationId))
		.orderBy(asc(dnsProviderCredential.createdAt));
};

const findVaultRowsForProvider = async (
	organizationId: string,
	provider: DnsProviderId,
) => {
	return db
		.select()
		.from(dnsProviderCredential)
		.where(
			and(
				eq(dnsProviderCredential.organizationId, organizationId),
				eq(dnsProviderCredential.provider, provider),
			),
		)
		.orderBy(asc(dnsProviderCredential.createdAt));
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
	label: "Default",
	secretLast4: settings.apiTokenLast4,
	meta: { isDefault: true },
	createdAt: settings.createdAt,
	updatedAt: settings.updatedAt,
	legacyCloudflare: true,
});

/**
 * If legacy cloudflare_settings exists and no vault Cloudflare row yet,
 * copy the sealed token into the vault (label Default). Idempotent.
 */
export const migrateLegacyCloudflareToVault = async (
	organizationId: string,
): Promise<DnsProviderCredentialPublic | null> => {
	const existing = await findVaultRowsForProvider(organizationId, "cloudflare");
	if (existing.length > 0) {
		return toPublic(existing[0]!);
	}

	const legacy = await findLegacyCloudflareSettings(organizationId);
	if (!legacy) {
		return null;
	}

	const now = new Date();
	const id = `dns-cf-${organizationId}`;

	try {
		const [row] = await db
			.insert(dnsProviderCredential)
			.values({
				id,
				organizationId,
				provider: "cloudflare",
				label: "Default",
				secretEncrypted: legacy.apiTokenEncrypted,
				secretLast4: legacy.apiTokenLast4,
				meta: { isDefault: true, migratedFrom: "cloudflare_settings" },
				createdAt: legacy.createdAt ?? now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning();

		if (row) {
			return toPublic(row);
		}
	} catch (error) {
		if (!isPostgresUniqueViolation(error)) {
			throw error;
		}
	}

	const [again] = await findVaultRowsForProvider(organizationId, "cloudflare");
	return again ? toPublic(again) : null;
};

/**
 * List credentials for an org (last4 only).
 * Dual-read: migrates/surfaces legacy `cloudflare_settings` when needed.
 */
export const listDnsProviderCredentials = async (
	organizationId: string,
): Promise<DnsProviderCredentialPublic[]> => {
	await migrateLegacyCloudflareToVault(organizationId);

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
		const migrated = await migrateLegacyCloudflareToVault(organizationId);
		if (migrated) {
			return migrated;
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
 * Create a vault credential (always inserts a new account row).
 * Fails closed if sealing is unavailable. Duplicate labels get a clear error.
 * Never returns the raw secret — last4 only.
 */
export const setDnsProviderCredential = async (
	input: SetDnsProviderCredentialInput,
): Promise<DnsProviderCredentialPublic> => {
	const secretEncrypted = sealOrThrow(input.secret);
	const now = new Date();
	const id = nanoid();
	const label = input.label.trim();
	if (!label) {
		throw new Error("Label is required");
	}

	if (input.provider === "cloudflare") {
		await migrateLegacyCloudflareToVault(input.organizationId);
	}

	try {
		const [row] = await db
			.insert(dnsProviderCredential)
			.values({
				id,
				organizationId: input.organizationId,
				provider: input.provider,
				label,
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

		// Keep legacy CF row in sync with the Default vault account for dual-read paths
		if (input.provider === "cloudflare" && label.toLowerCase() === "default") {
			await db
				.insert(cloudflareSettings)
				.values({
					organizationId: input.organizationId,
					apiTokenEncrypted: secretEncrypted,
					apiTokenLast4: last4(input.secret),
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: cloudflareSettings.organizationId,
					set: {
						apiTokenEncrypted: secretEncrypted,
						apiTokenLast4: last4(input.secret),
						updatedAt: now,
					},
				});
		}

		return toPublic(row);
	} catch (error) {
		if (isPostgresUniqueViolation(error)) {
			throw new Error(DUPLICATE_LABEL_MESSAGE);
		}
		throw error;
	}
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
		const migrated = await migrateLegacyCloudflareToVault(
			input.organizationId,
		);
		if (migrated) {
			return rotateDnsProviderCredential({
				...input,
				credentialId: migrated.id,
			});
		}

		return setDnsProviderCredential({
			organizationId: input.organizationId,
			provider: "cloudflare",
			label: input.label ?? "Default",
			secret: input.secret,
			meta: input.meta ?? { isDefault: true },
		});
	}

	try {
		const [updated] = await db
			.update(dnsProviderCredential)
			.set({
				secretEncrypted,
				secretLast4: last4(input.secret),
				...(input.label !== undefined ? { label: input.label.trim() } : {}),
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

		if (updated.provider === "cloudflare") {
			const cfRows = await findVaultRowsForProvider(
				input.organizationId,
				"cloudflare",
			);
			const defaultRow = pickDefaultDnsCredential(
				cfRows.map((r) => ({
					id: r.id,
					label: r.label,
					createdAt: r.createdAt,
					meta: (r.meta ?? {}) as DnsProviderMeta,
				})),
			);
			if (defaultRow?.id === updated.id) {
				await db
					.insert(cloudflareSettings)
					.values({
						organizationId: input.organizationId,
						apiTokenEncrypted: secretEncrypted,
						apiTokenLast4: last4(input.secret),
						createdAt: now,
						updatedAt: now,
					})
					.onConflictDoUpdate({
						target: cloudflareSettings.organizationId,
						set: {
							apiTokenEncrypted: secretEncrypted,
							apiTokenLast4: last4(input.secret),
							updatedAt: now,
						},
					});
			}
		}

		return toPublic(updated);
	} catch (error) {
		if (isPostgresUniqueViolation(error)) {
			throw new Error(DUPLICATE_LABEL_MESSAGE);
		}
		throw error;
	}
};

/**
 * Delete a vault credential. Legacy virtual ids resolve to the Default vault
 * row when present; caller may separately clear `cloudflare_settings`.
 */
export const deleteDnsProviderCredential = async (
	organizationId: string,
	credentialId: string,
): Promise<{ deleted: boolean }> => {
	if (credentialId === `${LEGACY_CLOUDFLARE_ID_PREFIX}${organizationId}`) {
		const migrated = await migrateLegacyCloudflareToVault(organizationId);
		if (!migrated) {
			return { deleted: false };
		}
		credentialId = migrated.id;
	}

	const deleted = await db
		.delete(dnsProviderCredential)
		.where(
			and(
				eq(dnsProviderCredential.id, credentialId),
				eq(dnsProviderCredential.organizationId, organizationId),
			),
		)
		.returning({
			id: dnsProviderCredential.id,
			provider: dnsProviderCredential.provider,
		});

	if (
		deleted.length > 0 &&
		deleted[0]?.provider === "cloudflare"
	) {
		const remaining = await findVaultRowsForProvider(
			organizationId,
			"cloudflare",
		);
		if (remaining.length === 0) {
			await db
				.delete(cloudflareSettings)
				.where(eq(cloudflareSettings.organizationId, organizationId));
		}
	}

	return { deleted: deleted.length > 0 };
};

/**
 * Internal: unseal secret for adapters. Prefer vault; dual-read
 * `cloudflare_settings` when vault has no cloudflare credential.
 * When credentialId is omitted, uses Traefik multi-token default policy.
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
			const migrated = await migrateLegacyCloudflareToVault(organizationId);
			if (migrated) {
				const [row] = await db
					.select()
					.from(dnsProviderCredential)
					.where(eq(dnsProviderCredential.id, migrated.id))
					.limit(1);
				if (row) {
					return {
						credentialId: row.id,
						provider: "cloudflare",
						secret: unsealString(row.secretEncrypted),
						legacyCloudflare: false,
					};
				}
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
	const vaultRows = await findVaultRowsForProvider(
		organizationId,
		targetProvider,
	);

	if (vaultRows.length > 0) {
		const picked = pickDefaultDnsCredential(
			vaultRows.map((r) => ({
				id: r.id,
				label: r.label,
				createdAt: r.createdAt,
				meta: (r.meta ?? {}) as DnsProviderMeta,
				row: r,
			})),
		);
		const row = picked?.row ?? vaultRows[0]!;
		return {
			credentialId: row.id,
			provider: row.provider as DnsProviderId,
			secret: unsealString(row.secretEncrypted),
			legacyCloudflare: false,
		};
	}

	if (targetProvider === "cloudflare") {
		const migrated = await migrateLegacyCloudflareToVault(organizationId);
		if (migrated) {
			return resolveDnsProviderSecret({
				organizationId,
				credentialId: migrated.id,
				provider: "cloudflare",
			});
		}
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
