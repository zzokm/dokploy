import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@dokploy/server/db";
import {
	cloudflareSettings,
	dnsProviderCredential,
	dnsRecord,
	dnsZone,
} from "@dokploy/server/db/schema";
import { syncCloudflareZonesForOrg } from "@dokploy/server/services/cloudflare/sync-zones";
import { nanoid } from "nanoid";
import {
	migrateLegacyCloudflareToVault,
	resolveDnsProviderSecret,
} from "./credentials";
import {
	ensureDnsAdaptersRegistered,
	getRegisteredAdapter,
} from "./orchestration";
import type { DnsProviderId } from "./types";

const mapZoneStatus = (
	status?: string,
): "active" | "pending" | "disabled" => {
	if (status === "active") return "active";
	if (status === "pending") return "pending";
	if (status === "disabled") return "disabled";
	return "active";
};

/**
 * Sync zones (and optionally records) for one vault credential via its adapter
 * into generic `dns_zone` / `dns_record` mirrors.
 */
export const syncDnsZonesForCredential = async (input: {
	organizationId: string;
	credentialId: string;
	syncRecords?: boolean;
}) => {
	ensureDnsAdaptersRegistered();

	const resolved = await resolveDnsProviderSecret({
		organizationId: input.organizationId,
		credentialId: input.credentialId,
	});
	if (!resolved) {
		throw new Error("DNS provider credential not found");
	}

	const adapter = getRegisteredAdapter(resolved.provider);
	if (!adapter) {
		throw new Error(`Adapter not registered for ${resolved.provider}`);
	}

	const creds = { secret: resolved.secret };
	const zones = await adapter.listZones(creds);
	const now = new Date();
	const credentialId = resolved.credentialId;

	await db.transaction(async (tx) => {
		for (const z of zones) {
			await tx
				.insert(dnsZone)
				.values({
					id: nanoid(),
					organizationId: input.organizationId,
					credentialId: credentialId ?? undefined,
					provider: resolved.provider,
					externalId: z.id,
					name: z.name,
					status: mapZoneStatus(z.status),
					paused: !!z.paused,
					meta: z.meta ?? {},
					lastSyncedAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [
						dnsZone.organizationId,
						dnsZone.provider,
						dnsZone.credentialId,
						dnsZone.externalId,
					],
					set: {
						name: z.name,
						status: mapZoneStatus(z.status),
						paused: !!z.paused,
						meta: z.meta ?? {},
						lastSyncedAt: now,
						updatedAt: now,
					},
				});
		}

		const externalIds = zones.map((z) => z.id);
		const existingQuery = tx
			.select({
				id: dnsZone.id,
				externalId: dnsZone.externalId,
			})
			.from(dnsZone)
			.where(
				and(
					eq(dnsZone.organizationId, input.organizationId),
					eq(dnsZone.provider, resolved.provider),
					credentialId
						? eq(dnsZone.credentialId, credentialId)
						: isNull(dnsZone.credentialId),
				),
			);

		const existing = await existingQuery;
		const missing = existing.filter((e) => !externalIds.includes(e.externalId));
		if (missing.length > 0) {
			await tx
				.update(dnsZone)
				.set({ status: "disabled", updatedAt: now })
				.where(
					and(
						eq(dnsZone.organizationId, input.organizationId),
						eq(dnsZone.provider, resolved.provider),
						credentialId
							? eq(dnsZone.credentialId, credentialId)
							: isNull(dnsZone.credentialId),
						inArray(
							dnsZone.externalId,
							missing.map((m) => m.externalId),
						),
					),
				);
		}
	});

	let recordsSynced = 0;
	if (input.syncRecords) {
		for (const z of zones) {
			const records = await adapter.listRecords(creds, z.id);
			const nowR = new Date();
			for (const r of records) {
				await db
					.insert(dnsRecord)
					.values({
						id: nanoid(),
						organizationId: input.organizationId,
						credentialId: credentialId ?? undefined,
						provider: resolved.provider,
						zoneExternalId: z.id,
						externalId: r.id,
						type: String(r.type),
						name: r.name,
						content: r.content,
						ttl: r.ttl ?? 1,
						options: r.options ?? {},
						managedBy: "manual",
						lastSyncedAt: nowR,
						updatedAt: nowR,
					})
					.onConflictDoUpdate({
						target: [
							dnsRecord.organizationId,
							dnsRecord.provider,
							dnsRecord.credentialId,
							dnsRecord.externalId,
						],
						set: {
							zoneExternalId: z.id,
							type: String(r.type),
							name: r.name,
							content: r.content,
							ttl: r.ttl ?? 1,
							options: r.options ?? {},
							lastSyncedAt: nowR,
							updatedAt: nowR,
						},
					});
				recordsSynced += 1;
			}
		}
	}

	return {
		provider: resolved.provider,
		zonesSynced: zones.length,
		recordsSynced,
	};
};

/**
 * Sync all vault credentials for an org (skips legacy-only CF virtual rows
 * without a real vault id — those still use cloudflare sync).
 */
export const syncAllDnsZonesForOrg = async (
	organizationId: string,
	opts?: { syncRecords?: boolean },
) => {
	await migrateLegacyCloudflareToVault(organizationId);

	const syncRecords = opts?.syncRecords ?? false;
	const rows = await db
		.select({
			id: dnsProviderCredential.id,
			provider: dnsProviderCredential.provider,
		})
		.from(dnsProviderCredential)
		.where(eq(dnsProviderCredential.organizationId, organizationId));

	const results: Array<{
		credentialId: string;
		provider: DnsProviderId;
		zonesSynced: number;
		recordsSynced: number;
	}> = [];

	for (const row of rows) {
		const result = await syncDnsZonesForCredential({
			organizationId,
			credentialId: row.id,
			syncRecords,
		});
		results.push({
			credentialId: row.id,
			provider: row.provider as DnsProviderId,
			zonesSynced: result.zonesSynced,
			recordsSynced: result.recordsSynced,
		});
	}

	return {
		credentials: results.length,
		zonesSynced: results.reduce((n, r) => n + r.zonesSynced, 0),
		recordsSynced: results.reduce((n, r) => n + r.recordsSynced, 0),
		results,
	};
};

/**
 * Org-scoped cron entrypoint: sync every vault credential's zones + records,
 * and refresh legacy Cloudflare zone mirrors. Idempotent; never logs secrets.
 */
export const syncAllDnsZonesAndRecords = async () => {
	const vaultOrgs = await db
		.select({
			organizationId: dnsProviderCredential.organizationId,
		})
		.from(dnsProviderCredential);
	const cfOrgs = await db
		.select({
			organizationId: cloudflareSettings.organizationId,
		})
		.from(cloudflareSettings);

	const orgIds = [
		...new Set([
			...vaultOrgs.map((r) => r.organizationId),
			...cfOrgs.map((r) => r.organizationId),
		]),
	];

	let orgs = 0;
	let zonesSynced = 0;
	let recordsSynced = 0;
	let errors = 0;

	for (const organizationId of orgIds) {
		try {
			const vaultResult = await syncAllDnsZonesForOrg(organizationId, {
				syncRecords: true,
			});
			zonesSynced += vaultResult.zonesSynced;
			recordsSynced += vaultResult.recordsSynced;

			const cfResult = await syncCloudflareZonesForOrg(organizationId);
			zonesSynced += cfResult.synced;

			orgs += 1;
		} catch (error) {
			errors += 1;
			console.error(
				`[DNS] Auto sync failed for org ${organizationId}:`,
				error instanceof Error ? error.message : "unknown error",
			);
		}
	}

	return { orgs, zonesSynced, recordsSynced, errors };
};

export const listMirroredDnsZones = async (organizationId: string) => {
	return db
		.select()
		.from(dnsZone)
		.where(eq(dnsZone.organizationId, organizationId))
		.orderBy(asc(dnsZone.name));
};

export const listMirroredDnsRecords = async (input: {
	organizationId: string;
	provider: DnsProviderId;
	zoneExternalId: string;
	credentialId?: string | null;
}) => {
	return db
		.select()
		.from(dnsRecord)
		.where(
			and(
				eq(dnsRecord.organizationId, input.organizationId),
				eq(dnsRecord.provider, input.provider),
				eq(dnsRecord.zoneExternalId, input.zoneExternalId),
				input.credentialId
					? eq(dnsRecord.credentialId, input.credentialId)
					: undefined,
			),
		);
};
