import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@dokploy/server/db";
import {
	dnsProviderCredential,
	dnsRecord,
	dnsZone,
} from "@dokploy/server/db/schema";
import { nanoid } from "nanoid";
import { resolveDnsProviderSecret } from "./credentials";
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
						dnsZone.externalId,
					],
					set: {
						credentialId: credentialId ?? null,
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
		const existing = await tx
			.select({
				id: dnsZone.id,
				externalId: dnsZone.externalId,
			})
			.from(dnsZone)
			.where(
				and(
					eq(dnsZone.organizationId, input.organizationId),
					eq(dnsZone.provider, resolved.provider),
				),
			);

		const missing = existing.filter((e) => !externalIds.includes(e.externalId));
		if (missing.length > 0) {
			await tx
				.update(dnsZone)
				.set({ status: "disabled", updatedAt: now })
				.where(
					and(
						eq(dnsZone.organizationId, input.organizationId),
						eq(dnsZone.provider, resolved.provider),
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
export const syncAllDnsZonesForOrg = async (organizationId: string) => {
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
			syncRecords: false,
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
		results,
	};
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
}) => {
	return db
		.select()
		.from(dnsRecord)
		.where(
			and(
				eq(dnsRecord.organizationId, input.organizationId),
				eq(dnsRecord.provider, input.provider),
				eq(dnsRecord.zoneExternalId, input.zoneExternalId),
			),
		);
};
