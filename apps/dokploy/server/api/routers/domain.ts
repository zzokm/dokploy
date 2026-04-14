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
} from "@dokploy/server"
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
import { domains } from "@dokploy/server/db/schema";
import {
	deleteCloudflareAppDnsForDomain,
	ensureCloudflareAppDnsForDomain,
} from "@dokploy/server/services/cloudflare/app-domain-automation";

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

				if (input.dnsProvider === "cloudflare") {
					const cfResult = await ensureCloudflareAppDnsForDomain({
						organizationId: ctx.session.activeOrganizationId,
						domainId: domain.domainId,
						proxiedDefault: input.cfProxied ?? input.cloudflareProxied ?? true,
					})
					if (cfResult.skipped) {
						if (domain.applicationId) {
							const application = await findApplicationById(domain.applicationId)
							await removeDomain(application, domain.uniqueConfigKey)
						}
						await removeDomainById(domain.domainId)
						const msg =
							cfResult.reason === "no_zone_match"
								? "No Cloudflare zone matches this hostname. Sync zones on Domains or choose a zone when adding the domain."
								: cfResult.reason === "no_cloudflare_settings"
									? "Connect Cloudflare under Domains first."
									: cfResult.reason === "token_unseal_failed"
										? "Cloudflare token could not be decrypted. Check DOKPLOY_ENCRYPTION_KEY."
										: "Could not configure Cloudflare DNS for this domain."
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: msg,
						})
					}
					const refreshed = await findDomainById(domain.domainId)
					if (refreshed.applicationId) {
						const application = await findApplicationById(refreshed.applicationId)
						await manageDomain(application, refreshed)
					}
				}

				return await findDomainById(domain.domainId)
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

			if (domain.dnsProvider === "cloudflare") {
				await ensureCloudflareAppDnsForDomain({
					organizationId: ctx.session.activeOrganizationId,
					domainId: input.domainId,
					proxiedDefault: true,
				}).catch(() => {})
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

			if (domain.dnsProvider === "cloudflare") {
				await deleteCloudflareAppDnsForDomain({
					organizationId: ctx.session.activeOrganizationId,
					domainId: input.domainId,
				}).catch(() => {})
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

			await ctx.db
				.update(domains)
				.set({
					dnsProvider: "cloudflare",
					cfProxied: input.proxied,
					cfStatus: "pending",
					https: true,
					certificateType: "letsencrypt",
					customCertResolver: input.proxied ? "letsencrypt-cloudflare" : null,
				})
				.where(eq(domains.domainId, input.domainId))

			await audit(ctx, {
				action: "update",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			});
			await ensureCloudflareAppDnsForDomain({
				organizationId: ctx.session.activeOrganizationId,
				domainId: input.domainId,
				proxiedDefault: input.proxied,
			})

			return true
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

			const [domainRow] = await ctx.db
				.select({ dnsProvider: domains.dnsProvider })
				.from(domains)
				.where(eq(domains.domainId, input.domainId))
				.limit(1)

			if (domainRow?.dnsProvider !== "cloudflare") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Domain is not configured for Cloudflare DNS",
				})
			}

			return await ensureCloudflareAppDnsForDomain({
				organizationId: ctx.session.activeOrganizationId,
				domainId: input.domainId,
				proxiedDefault: true,
			})
		}),
});
