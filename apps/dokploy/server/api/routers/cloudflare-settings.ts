import {
	findDomainById,
	findPreviewDeploymentById,
	prepareEnvironmentVariables,
	readEnvironmentVariables,
	readPorts,
	writeTraefikSetup,
} from "@dokploy/server";
import { cloudflareSettings, cloudflareZone } from "@dokploy/server/db/schema";
import {
	applyCloudflareDnsSelectionsForOrg,
	assertDomainIdsAllowedForOrgCloudflareApply,
	previewCloudflareAppDnsForDomain,
	previewCloudflareAppDnsForOrg,
} from "@dokploy/server/services/cloudflare/dns-preview";
import {
	applyServerDomainDns,
	previewServerDomainDns,
} from "@dokploy/server/services/cloudflare/server-domain-dns";
import { syncCloudflareZonesForOrg } from "@dokploy/server/services/cloudflare/sync-zones";
import { validateCloudflareApiToken } from "@dokploy/server/services/cloudflare/token-validation";
import {
	createZoneDnsRecord as createZoneDnsRecordService,
	deleteZoneDnsRecord as deleteZoneDnsRecordService,
	listZoneDnsRecords as listZoneDnsRecordsService,
	updateZoneDnsRecord as updateZoneDnsRecordService,
	zoneDnsRecordInputSchema,
} from "@dokploy/server/services/cloudflare/zone-dns-records";
import { checkServicePermissionAndAccess } from "@dokploy/server/services/permission";
import {
	canSealSecrets,
	sealString,
	unsealString,
} from "@dokploy/server/utils/crypto/seal";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const cloudflareSettingsRouter = createTRPCRouter({
	get: protectedProcedure.query(async ({ ctx }) => {
		const [row] = await ctx.db
			.select({
				apiTokenLast4: cloudflareSettings.apiTokenLast4,
				updatedAt: cloudflareSettings.updatedAt,
			})
			.from(cloudflareSettings)
			.where(
				eq(cloudflareSettings.organizationId, ctx.session.activeOrganizationId),
			)
			.limit(1);

		if (!row) {
			return {
				connected: false as const,
				apiTokenLast4: null,
				updatedAt: null,
			};
		}

		return {
			connected: true as const,
			apiTokenLast4: row.apiTokenLast4,
			updatedAt: row.updatedAt?.toISOString?.() ?? null,
		};
	}),

	setToken: protectedProcedure
		.input(z.object({ apiToken: z.string().min(20) }))
		.mutation(async ({ ctx, input }) => {
			if (!canSealSecrets()) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"DOKPLOY_ENCRYPTION_KEY is required to store sensitive tokens securely",
				});
			}

			let tokenEncrypted = "";
			try {
				tokenEncrypted = sealString(input.apiToken);
			} catch {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"DOKPLOY_ENCRYPTION_KEY is invalid. Provide a base64-encoded 32-byte key.",
				});
			}

			const validation = await validateCloudflareApiToken(input.apiToken);
			if (!validation.ok) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: validation.message,
				});
			}

			const apiTokenLast4 = input.apiToken.slice(-4);
			const now = new Date();

			await ctx.db
				.insert(cloudflareSettings)
				.values({
					organizationId: ctx.session.activeOrganizationId,
					apiTokenEncrypted: tokenEncrypted,
					apiTokenLast4,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: cloudflareSettings.organizationId,
					set: {
						apiTokenEncrypted: tokenEncrypted,
						apiTokenLast4,
						updatedAt: now,
					},
				});

			try {
				await syncCloudflareZonesForOrg(ctx.session.activeOrganizationId);
			} catch (e) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: e instanceof Error ? e.message : "Failed to sync domains",
				});
			}

			// Best-effort: inject token into Traefik for DNS-01
			try {
				const env = await readEnvironmentVariables("dokploy-traefik");
				const ports = await readPorts("dokploy-traefik");
				const prepared = prepareEnvironmentVariables(env);
				const nextEnv = prepared.some((e) => e.startsWith("CF_DNS_API_TOKEN="))
					? prepared.map((e) =>
							e.startsWith("CF_DNS_API_TOKEN=")
								? `CF_DNS_API_TOKEN=${input.apiToken}`
								: e,
						)
					: [...prepared, `CF_DNS_API_TOKEN=${input.apiToken}`];
				void writeTraefikSetup({ env: nextEnv, additionalPorts: ports }).catch(
					() => {},
				);
			} catch {
				// Traefik might not be deployed yet in local dev
			}

			return {
				connected: true as const,
				apiTokenLast4,
				validation: {
					zoneRead: validation.zoneRead,
					dnsRead: validation.dnsRead,
					dnsWrite: validation.dnsWrite,
					warning: validation.warning ?? null,
				},
			};
		}),

	syncZones: protectedProcedure.mutation(async ({ ctx }) => {
		const [settings] = await ctx.db
			.select({ apiTokenEncrypted: cloudflareSettings.apiTokenEncrypted })
			.from(cloudflareSettings)
			.where(
				eq(cloudflareSettings.organizationId, ctx.session.activeOrganizationId),
			)
			.limit(1);

		if (!settings) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Connect Cloudflare first",
			});
		}

		try {
			unsealString(settings.apiTokenEncrypted);
		} catch {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"DOKPLOY_ENCRYPTION_KEY is required to use Cloudflare features. Set it and restart.",
			});
		}

		return await syncCloudflareZonesForOrg(ctx.session.activeOrganizationId);
	}),

	listZones: protectedProcedure.query(async ({ ctx }) => {
		return await ctx.db
			.select({
				id: cloudflareZone.id,
				cfZoneId: cloudflareZone.cfZoneId,
				name: cloudflareZone.name,
				status: cloudflareZone.status,
				paused: cloudflareZone.paused,
				lastSyncedAt: cloudflareZone.lastSyncedAt,
			})
			.from(cloudflareZone)
			.where(
				eq(cloudflareZone.organizationId, ctx.session.activeOrganizationId),
			)
			.orderBy(cloudflareZone.name);
	}),

	previewAppDns: protectedProcedure.query(async ({ ctx }) => {
		return await previewCloudflareAppDnsForOrg(
			ctx.session.activeOrganizationId,
		);
	}),

	previewAppDnsForDomain: protectedProcedure
		.input(z.object({ domainId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["read"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["read"],
				});
			}

			return await previewCloudflareAppDnsForDomain({
				organizationId: ctx.session.activeOrganizationId,
				domainId: input.domainId,
			});
		}),

	applyAppDnsSelections: protectedProcedure
		.input(
			z.object({
				selections: z.array(
					z.object({
						domainId: z.string().min(1),
						apply: z.boolean(),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const allIds = input.selections.map((s) => s.domainId);
			await assertDomainIdsAllowedForOrgCloudflareApply(
				ctx.session.activeOrganizationId,
				allIds,
			);

			for (const s of input.selections) {
				if (!s.apply) {
					continue;
				}
				const domain = await findDomainById(s.domainId);
				const serviceId = domain.applicationId || domain.composeId;
				if (serviceId) {
					await checkServicePermissionAndAccess(ctx, serviceId, {
						domain: ["create"],
					});
				} else if (domain.previewDeploymentId) {
					const preview = await findPreviewDeploymentById(
						domain.previewDeploymentId,
					);
					await checkServicePermissionAndAccess(ctx, preview.applicationId, {
						domain: ["create"],
					});
				}
			}

			return await applyCloudflareDnsSelectionsForOrg({
				organizationId: ctx.session.activeOrganizationId,
				selections: input.selections,
			});
		}),

	syncDns: protectedProcedure.mutation(async ({ ctx }) => {
		const organizationId = ctx.session.activeOrganizationId;
		// Ensure Cloudflare token is present + decryptable
		const [settings] = await ctx.db
			.select({ apiTokenEncrypted: cloudflareSettings.apiTokenEncrypted })
			.from(cloudflareSettings)
			.where(eq(cloudflareSettings.organizationId, organizationId))
			.limit(1);

		if (!settings) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Connect Cloudflare first",
			});
		}

		try {
			unsealString(settings.apiTokenEncrypted);
		} catch {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"Cloudflare token could not be decrypted. Check DOKPLOY_ENCRYPTION_KEY and restart Dokploy.",
			});
		}

		await syncCloudflareZonesForOrg(organizationId);

		const preview = await previewCloudflareAppDnsForOrg(organizationId);
		const actionable = preview.filter((r) => r.state !== "ok");
		const selections = actionable.map((r) => {
			const canApply =
				r.state === "drift" ||
				r.state === "missing" ||
				(r.state === "error" && r.wouldChange);
			return { domainId: r.domainId, apply: canApply };
		});

		const appliedRes = selections.some((s) => s.apply)
			? await applyCloudflareDnsSelectionsForOrg({
					organizationId,
					selections,
				})
			: { applied: [], errors: [] };

		return {
			ok: true as const,
			appDns: appliedRes,
		};
	}),

	previewServerDomainDns: protectedProcedure.query(async ({ ctx }) => {
		return await previewServerDomainDns(ctx.session.activeOrganizationId);
	}),

	applyServerDomainDns: protectedProcedure
		.input(
			z
				.object({
					proxied: z.boolean().optional(),
				})
				.optional(),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await applyServerDomainDns({
					organizationId: ctx.session.activeOrganizationId,
					proxied: input?.proxied,
				});
			} catch (e) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						e instanceof Error ? e.message : "Failed to sync server domain DNS",
				});
			}
		}),

	listZoneDnsRecords: protectedProcedure
		.input(z.object({ cfZoneId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			try {
				return await listZoneDnsRecordsService({
					organizationId: ctx.session.activeOrganizationId,
					cfZoneId: input.cfZoneId,
				});
			} catch (e) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						e instanceof Error ? e.message : "Failed to list DNS records",
				});
			}
		}),

	createZoneDnsRecord: protectedProcedure
		.input(
			z.object({
				cfZoneId: z.string().min(1),
				record: zoneDnsRecordInputSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await createZoneDnsRecordService({
					organizationId: ctx.session.activeOrganizationId,
					cfZoneId: input.cfZoneId,
					record: input.record,
				});
			} catch (e) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						e instanceof Error ? e.message : "Failed to create DNS record",
				});
			}
		}),

	updateZoneDnsRecord: protectedProcedure
		.input(
			z.object({
				cfZoneId: z.string().min(1),
				cfRecordId: z.string().min(1),
				record: zoneDnsRecordInputSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await updateZoneDnsRecordService({
					organizationId: ctx.session.activeOrganizationId,
					cfZoneId: input.cfZoneId,
					cfRecordId: input.cfRecordId,
					record: input.record,
				});
			} catch (e) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						e instanceof Error ? e.message : "Failed to update DNS record",
				});
			}
		}),

	deleteZoneDnsRecord: protectedProcedure
		.input(
			z.object({
				cfZoneId: z.string().min(1),
				cfRecordId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await deleteZoneDnsRecordService({
					organizationId: ctx.session.activeOrganizationId,
					cfZoneId: input.cfZoneId,
					cfRecordId: input.cfRecordId,
				});
			} catch (e) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						e instanceof Error ? e.message : "Failed to delete DNS record",
				});
			}
		}),

	disconnect: protectedProcedure.mutation(async ({ ctx }) => {
		await ctx.db
			.delete(cloudflareSettings)
			.where(
				eq(cloudflareSettings.organizationId, ctx.session.activeOrganizationId),
			);

		return { connected: false as const };
	}),
});
