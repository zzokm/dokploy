import {
	listDnsProviderCredentials,
	setDnsProviderCredential,
	deleteDnsProviderCredential,
	rotateDnsProviderCredential,
	resolveDnsProviderSecret,
	type DnsProviderId,
} from "@dokploy/server/services/dns";
import {
	ensureDnsAdaptersRegistered,
	getRegisteredAdapter,
	resolveAcmeForProvider,
} from "@dokploy/server/services/dns/orchestration";
import {
	listMirroredDnsRecords,
	listMirroredDnsZones,
	syncAllDnsZonesForOrg,
	syncDnsZonesForCredential,
} from "@dokploy/server/services/dns/sync-zones";
import { DNS_PROVIDER_CAPABILITIES } from "@dokploy/server/services/dns/types";
import { ensureTraefikDnsProviderToken } from "@dokploy/server/services/dns/ensure-traefik-dns-token";
import { canSealSecrets } from "@dokploy/server/utils/crypto/seal";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const providerIdSchema = z.enum([
	"cloudflare",
	"digitalocean",
	"hetzner",
	"route53",
	"gcloud",
	"ns1",
	"akamai",
]);

export const dnsProvidersRouter = createTRPCRouter({
	listCapabilities: protectedProcedure.query(() => {
		ensureDnsAdaptersRegistered();
		return Object.entries(DNS_PROVIDER_CAPABILITIES).map(([id, caps]) => ({
			id: id as DnsProviderId,
			...caps,
			acme: resolveAcmeForProvider(id as DnsProviderId),
			adapterRegistered: !!getRegisteredAdapter(id as DnsProviderId),
		}));
	}),

	list: protectedProcedure.query(async ({ ctx }) => {
		return listDnsProviderCredentials(ctx.session.activeOrganizationId);
	}),

	setCredential: protectedProcedure
		.input(
			z.object({
				provider: providerIdSchema,
				label: z.string().min(1).max(120),
				secret: z.string().min(8),
				meta: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (!canSealSecrets()) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"DOKPLOY_ENCRYPTION_KEY is required to store DNS provider secrets securely",
				});
			}

			ensureDnsAdaptersRegistered();
			const adapter = getRegisteredAdapter(input.provider);
			if (adapter) {
				const test = await adapter.testCredentials({
					secret: input.secret,
					meta: input.meta,
				});
				if (!test.ok) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: test.detail ?? "Credential validation failed",
					});
				}
			}

			const row = await setDnsProviderCredential({
				organizationId: ctx.session.activeOrganizationId,
				provider: input.provider,
				label: input.label,
				secret: input.secret,
				meta: input.meta,
			});

			// Best-effort Traefik DNS-01 inject when provider requires it
			if (DNS_PROVIDER_CAPABILITIES[input.provider].requiresDns01WhenManaged) {
				void ensureTraefikDnsProviderToken({
					organizationId: ctx.session.activeOrganizationId,
					provider: input.provider,
					credentialId: row.id,
				}).catch(() => {});
			}

			// Best-effort zone mirror sync
			try {
				await syncDnsZonesForCredential({
					organizationId: ctx.session.activeOrganizationId,
					credentialId: row.id,
				});
			} catch {
				// Token valid but zone list may fail transiently
			}

			return row;
		}),

	rotateCredential: protectedProcedure
		.input(
			z.object({
				credentialId: z.string().min(1),
				secret: z.string().min(8),
				label: z.string().min(1).max(120).optional(),
				meta: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (!canSealSecrets()) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"DOKPLOY_ENCRYPTION_KEY is required to store DNS provider secrets securely",
				});
			}
			return rotateDnsProviderCredential({
				organizationId: ctx.session.activeOrganizationId,
				credentialId: input.credentialId,
				secret: input.secret,
				label: input.label,
				meta: input.meta,
			});
		}),

	deleteCredential: protectedProcedure
		.input(z.object({ credentialId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			return deleteDnsProviderCredential(
				ctx.session.activeOrganizationId,
				input.credentialId,
			);
		}),

	testCredential: protectedProcedure
		.input(
			z.object({
				provider: providerIdSchema,
				secret: z.string().min(8),
				meta: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			ensureDnsAdaptersRegistered();
			const adapter = getRegisteredAdapter(input.provider);
			if (!adapter) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Adapter not registered for ${input.provider}`,
				});
			}
			return adapter.testCredentials({
				secret: input.secret,
				meta: input.meta,
			});
		}),

	/** Internal-style: list zones for a stored credential (last4 path only). */
	listZonesForCredential: protectedProcedure
		.input(
			z.object({
				credentialId: z.string().min(1),
			}),
		)
		.query(async ({ ctx, input }) => {
			ensureDnsAdaptersRegistered();
			const resolved = await resolveDnsProviderSecret({
				organizationId: ctx.session.activeOrganizationId,
				credentialId: input.credentialId,
			});
			if (!resolved) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Credential not found" });
			}
			const adapter = getRegisteredAdapter(resolved.provider);
			if (!adapter) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Adapter not registered for ${resolved.provider}`,
				});
			}
			return adapter.listZones({ secret: resolved.secret });
		}),

	/** Sync vault credentials into dns_zone mirrors (+ optional CF legacy sync). */
	syncZones: protectedProcedure
		.input(
			z
				.object({
					credentialId: z.string().min(1).optional(),
					syncRecords: z.boolean().optional(),
				})
				.optional(),
		)
		.mutation(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;
			try {
				if (input?.credentialId) {
					const result = await syncDnsZonesForCredential({
						organizationId: orgId,
						credentialId: input.credentialId,
						syncRecords: input.syncRecords,
					});
					return { ...result, credentials: 1 };
				}
				return await syncAllDnsZonesForOrg(orgId);
			} catch (e) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: e instanceof Error ? e.message : "Failed to sync DNS zones",
				});
			}
		}),

	/** List mirrored zones from all providers (generic dns_zone table). */
	listZones: protectedProcedure.query(async ({ ctx }) => {
		const rows = await listMirroredDnsZones(ctx.session.activeOrganizationId);
		return rows.map((z) => ({
			id: z.id,
			provider: z.provider,
			zoneExternalId: z.externalId,
			/** Compat alias for CF UI that still expects cfZoneId */
			cfZoneId: z.externalId,
			name: z.name,
			status: z.status,
			paused: z.paused,
			lastSyncedAt: z.lastSyncedAt,
			credentialId: z.credentialId,
		}));
	}),

	listZoneRecords: protectedProcedure
		.input(
			z.object({
				provider: providerIdSchema,
				zoneExternalId: z.string().min(1),
				credentialId: z.string().min(1).optional(),
				live: z.boolean().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (input.live) {
				ensureDnsAdaptersRegistered();
				const resolved = await resolveDnsProviderSecret({
					organizationId: orgId,
					credentialId: input.credentialId,
					provider: input.provider,
				});
				if (!resolved) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "DNS provider credential not found",
					});
				}
				const adapter = getRegisteredAdapter(resolved.provider);
				if (!adapter) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Adapter not registered for ${resolved.provider}`,
					});
				}
				const records = await adapter.listRecords(
					{ secret: resolved.secret },
					input.zoneExternalId,
				);
				return {
					records: records.map((r) => ({
						cfRecordId: r.id,
						externalId: r.id,
						type: String(r.type),
						name: r.name,
						content: r.content,
						ttl: r.ttl ?? 1,
						proxied: r.options?.proxied === true,
						priority:
							typeof r.options?.priority === "number"
								? r.options.priority
								: null,
						managedBy: "manual" as const,
						lastSyncedAt: null,
					})),
				};
			}

			const rows = await listMirroredDnsRecords({
				organizationId: orgId,
				provider: input.provider,
				zoneExternalId: input.zoneExternalId,
			});
			return {
				records: rows.map((r) => ({
					cfRecordId: r.externalId,
					externalId: r.externalId,
					type: r.type,
					name: r.name,
					content: r.content,
					ttl: r.ttl,
					proxied: (r.options as { proxied?: boolean } | null)?.proxied === true,
					priority:
						typeof (r.options as { priority?: number } | null)?.priority ===
						"number"
							? (r.options as { priority?: number }).priority ?? null
							: null,
					managedBy: r.managedBy,
					lastSyncedAt: r.lastSyncedAt,
				})),
			};
		}),

	upsertZoneRecord: protectedProcedure
		.input(
			z.object({
				provider: providerIdSchema,
				zoneExternalId: z.string().min(1),
				credentialId: z.string().min(1).optional(),
				name: z.string().min(1),
				type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX"]),
				content: z.string().min(1),
				ttl: z.number().int().optional(),
				priority: z.number().int().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			ensureDnsAdaptersRegistered();
			const resolved = await resolveDnsProviderSecret({
				organizationId: ctx.session.activeOrganizationId,
				credentialId: input.credentialId,
				provider: input.provider,
			});
			if (!resolved) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "DNS provider credential not found",
				});
			}
			const adapter = getRegisteredAdapter(resolved.provider);
			if (!adapter) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Adapter not registered for ${resolved.provider}`,
				});
			}
			const record = await adapter.upsertRecord(
				{ secret: resolved.secret },
				{
					zoneId: input.zoneExternalId,
					name: input.name,
					type: input.type,
					content: input.content,
					ttl: input.ttl,
					options:
						input.priority !== undefined
							? { priority: input.priority }
							: undefined,
				},
			);
			return {
				cfRecordId: record.id,
				externalId: record.id,
				...record,
			};
		}),

	deleteZoneRecord: protectedProcedure
		.input(
			z.object({
				provider: providerIdSchema,
				zoneExternalId: z.string().min(1),
				recordExternalId: z.string().min(1),
				credentialId: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			ensureDnsAdaptersRegistered();
			const resolved = await resolveDnsProviderSecret({
				organizationId: ctx.session.activeOrganizationId,
				credentialId: input.credentialId,
				provider: input.provider,
			});
			if (!resolved) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "DNS provider credential not found",
				});
			}
			const adapter = getRegisteredAdapter(resolved.provider);
			if (!adapter) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Adapter not registered for ${resolved.provider}`,
				});
			}
			await adapter.deleteRecord(
				{ secret: resolved.secret },
				input.zoneExternalId,
				input.recordExternalId,
			);
			return { ok: true as const };
		}),
});
