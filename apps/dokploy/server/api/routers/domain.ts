import {
	createDomain,
	findApplicationById,
	findDomainById,
	findDomainsByApplicationId,
	findDomainsByComposeId,
	findPreviewDeploymentById,
	findServerById,
	generateTraefikMeDomain,
	getConnectionInstructionsForDomain,
	getDomainConnectionStatus,
	getWebServerSettings,
	manageDomain,
	prepareEnvironmentVariables,
	readEnvironmentVariables,
	readPorts,
	removeDomain,
	removeDomainById,
	updateDomainById,
	validateDomain,
	verifyDomainConnection,
	writeTraefikSetup,
} from "@dokploy/server";
import { checkServicePermissionAndAccess } from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
	createTRPCRouter,
	protectedProcedure,
	withPermission,
} from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";
import {
	apiCreateDomain,
	apiFindCompose,
	apiFindDomain,
	apiFindOneApplication,
	apiUpdateDomain,
} from "@/server/db/schema";
import { db } from "@dokploy/server/db";
import { cloudflareIntegration, domains } from "@dokploy/server/db/schema";
import {
	getDomainCloudflareConfig,
	upsertAppDnsRecord,
} from "@dokploy/server/services/cloudflare/dns-records";
import { unsealString } from "@dokploy/server/utils/crypto/seal";

export const domainRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreateDomain)
		.mutation(async ({ input, ctx }) => {
			try {
				if (input.domainType === "compose" && input.composeId) {
					await checkServicePermissionAndAccess(ctx, input.composeId, {
						domain: ["create"],
					});
				} else if (input.domainType === "application" && input.applicationId) {
					await checkServicePermissionAndAccess(ctx, input.applicationId, {
						domain: ["create"],
					});
				}
				const domain = await createDomain(input);
				await audit(ctx, {
					action: "create",
					resourceType: "domain",
					resourceId: domain.domainId,
					resourceName: domain.host,
				});
				return domain;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Error creating the domain",
					cause: error,
				});
			}
		}),
	byApplicationId: protectedProcedure
		.input(apiFindOneApplication)
		.query(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(ctx, input.applicationId, {
				domain: ["read"],
			});
			return await findDomainsByApplicationId(input.applicationId);
		}),
	byComposeId: protectedProcedure
		.input(apiFindCompose)
		.query(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(ctx, input.composeId, {
				domain: ["read"],
			});
			return await findDomainsByComposeId(input.composeId);
		}),
	generateDomain: withPermission("domain", "create")
		.input(z.object({ appName: z.string(), serverId: z.string().optional() }))
		.mutation(async ({ input, ctx }) => {
			return generateTraefikMeDomain(
				input.appName,
				ctx.user.ownerId,
				input.serverId,
			);
		}),
	canGenerateTraefikMeDomains: withPermission("domain", "read")
		.input(z.object({ serverId: z.string() }))
		.query(async ({ input }) => {
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				return server.ipAddress;
			}
			const settings = await getWebServerSettings();
			return settings?.serverIp || "";
		}),

	update: protectedProcedure
		.input(apiUpdateDomain)
		.mutation(async ({ input, ctx }) => {
			const currentDomain = await findDomainById(input.domainId);
			const serviceId = currentDomain.applicationId || currentDomain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				});
			} else if (currentDomain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					currentDomain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["create"],
				});
			}

			const result = await updateDomainById(input.domainId, input);
			const domain = await findDomainById(input.domainId);
			await audit(ctx, {
				action: "update",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			});
			if (domain.applicationId) {
				const application = await findApplicationById(domain.applicationId);
				await manageDomain(application, domain);
			} else if (domain.previewDeploymentId) {
				const previewDeployment = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				const application = await findApplicationById(
					previewDeployment.applicationId,
				);
				application.appName = previewDeployment.appName;
				await manageDomain(application, domain);
			}
			return result;
		}),
	one: protectedProcedure.input(apiFindDomain).query(async ({ input, ctx }) => {
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
		return domain;
	}),
	delete: protectedProcedure
		.input(apiFindDomain)
		.mutation(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["delete"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["delete"],
				});
			}

			const result = await removeDomainById(input.domainId);
			await audit(ctx, {
				action: "delete",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			});

			if (domain.applicationId) {
				const application = await findApplicationById(domain.applicationId);
				await removeDomain(application, domain.uniqueConfigKey);
			}

			return result;
		}),

	validateDomain: withPermission("domain", "read")
		.input(
			z.object({
				domain: z.string(),
				serverIp: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			return validateDomain(input.domain, input.serverIp);
		}),

	getConnectionInstructions: protectedProcedure
		.input(apiFindDomain)
		.query(async ({ input, ctx }) => {
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
			return getConnectionInstructionsForDomain(input.domainId);
		}),

	getConnectionStatus: protectedProcedure
		.input(apiFindDomain)
		.query(async ({ input, ctx }) => {
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
			return getDomainConnectionStatus(input.domainId);
		}),

	verifyConnection: protectedProcedure
		.input(apiFindDomain)
		.mutation(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
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
			return verifyDomainConnection(input.domainId);
		}),

	setDnsProviderCloudflare: protectedProcedure
		.input(
			z.object({
				domainId: z.string().min(1),
				integrationId: z.string().min(1),
				zoneId: z.string().min(1),
				proxied: z.boolean().default(true),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(domain.previewDeploymentId);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["create"],
				});
			}

			const organizationId = ctx.session.activeOrganizationId;
			const [integration] = await db
				.select()
				.from(cloudflareIntegration)
				.where(
					and(
						eq(cloudflareIntegration.id, input.integrationId),
						eq(cloudflareIntegration.organizationId, organizationId),
					),
				)
				.limit(1);
			if (!integration) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Cloudflare integration not found" });
			}

			// Ensure Traefik has the Cloudflare token for DNS-01 (required when proxied=true)
			try {
				const token = unsealString(integration.apiTokenEncrypted);
				const env = await readEnvironmentVariables("dokploy-traefik");
				const ports = await readPorts("dokploy-traefik");
				const prepared = prepareEnvironmentVariables(env);
				const nextEnv = prepared.some((e) => e.startsWith("CF_DNS_API_TOKEN="))
					? prepared.map((e) =>
							e.startsWith("CF_DNS_API_TOKEN=") ? `CF_DNS_API_TOKEN=${token}` : e,
						)
					: [...prepared, `CF_DNS_API_TOKEN=${token}`];
				void writeTraefikSetup({ env: nextEnv, additionalPorts: ports }).catch(() => {});
			} catch {
				// Token storage may be misconfigured (missing DOKPLOY_ENCRYPTION_KEY).
				// Domain config still saves, but cert issuance via DNS-01 will fail until fixed.
			}

			await db
				.update(domains)
				.set({
					dnsProvider: "cloudflare",
					cloudflareIntegrationId: integration.id,
					cloudflareZoneId: input.zoneId,
					cloudflareProxied: input.proxied,
					cloudflareRecordId: null,
					cloudflareRecordType: "A",
					certificateType: "letsencrypt",
					customCertResolver: input.proxied ? "letsencrypt-cloudflare" : null,
					https: true,
				})
				.where(eq(domains.domainId, input.domainId));

			await audit(ctx, {
				action: "update",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			});

			return true;
		}),

	syncCloudflareDns: protectedProcedure
		.input(z.object({ domainId: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(domain.previewDeploymentId);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["create"],
				});
			}

			const cfg = await getDomainCloudflareConfig(input.domainId);
			if (cfg.dnsProvider !== "cloudflare" || !cfg.cloudflareIntegrationId || !cfg.cloudflareZoneId) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "Domain is not configured for Cloudflare DNS" });
			}

			const organizationId = ctx.session.activeOrganizationId;
			const [integration] = await db
				.select()
				.from(cloudflareIntegration)
				.where(
					and(
						eq(cloudflareIntegration.id, cfg.cloudflareIntegrationId),
						eq(cloudflareIntegration.organizationId, organizationId),
					),
				)
				.limit(1);
			if (!integration) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Cloudflare integration not found" });
			}

			let token: string;
			try {
				token = unsealString(integration.apiTokenEncrypted);
			} catch (e) {
				const message =
					e instanceof Error
						? e.message
						: "Failed to decrypt Cloudflare token";
				throw new TRPCError({ code: "BAD_REQUEST", message });
			}
			const res = await upsertAppDnsRecord({
				token,
				domainId: input.domainId,
				zoneId: cfg.cloudflareZoneId,
				proxied: cfg.cloudflareProxied,
				recordType: "A",
			});

			await db
				.update(domains)
				.set({
					cloudflareRecordId: res.recordId,
					cloudflareRecordType: "A",
				})
				.where(eq(domains.domainId, input.domainId));

			return res;
		}),
});
