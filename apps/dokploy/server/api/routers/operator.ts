import {
	checkPublicUrlHealth,
	deleteDnsRecordById,
	getCloudflareCredentialStatus,
	getHostnameCertStatus,
	getOperatorServiceLogs,
	getOperatorServiceStatus,
	getRecentTraefikAcmeErrors,
	isOperatorError,
	listOperatorApplications,
	listOperatorComposeServices,
	listOperatorEnvironments,
	listOperatorProjects,
	listOperatorZones,
	OperatorErrorCode,
	provisionDomain,
	redactSecrets,
	retryHostnameCertificate,
	upsertDnsRecordByName,
	waitForHostnameResolution,
	zoneDnsRecordTypeSchema,
} from "@dokploy/server/services/operator"
import {
	createDomain,
	findDomainById,
	findDomainsByApplicationId,
	findDomainsByComposeId,
	removeDomain,
	removeDomainById,
	updateDomainById,
	findApplicationById,
} from "@dokploy/server"
import {
	getWebServerSettings,
	updateWebServerSettings,
} from "@dokploy/server/services/web-server-settings"
import {
	updateServerTraefik,
	updateLetsEncryptEmail,
} from "@dokploy/server/utils/traefik/web-server"
import {
	previewServerDomainDns,
	applyServerDomainDns,
	resolveServerDomainCertResolver,
} from "@dokploy/server/services/cloudflare/server-domain-dns"
import { ensureCloudflareAppDnsForDomain } from "@dokploy/server/services/cloudflare/app-domain-automation"
import { ensureTraefikCloudflareDnsToken } from "@dokploy/server/services/cloudflare/traefik-dns-token"
import { manageDomain } from "@dokploy/server/utils/traefik/domain"
import { checkServicePermissionAndAccess } from "@dokploy/server/services/permission"
import { listZoneDnsRecords as listZoneDnsRecordsService } from "@dokploy/server/services/cloudflare/zone-dns-records"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
	createTRPCRouter,
	protectedProcedure,
} from "@/server/api/trpc"
import { audit } from "@/server/api/utils/audit"

import {
	findDnsProviderInOrganization,
	findDnsProvidersByOrganizationId,
	listDnsProviderRecords,
} from "@dokploy/server/services/dns-provider"

const throwOperator = (e: unknown): never => {
	if (isOperatorError(e)) {
		const code =
			e.code === OperatorErrorCode.unauthorized
				? "UNAUTHORIZED"
				: e.code === OperatorErrorCode.not_found
					? "NOT_FOUND"
					: "BAD_REQUEST"
		throw new TRPCError({
			code,
			message: JSON.stringify(e.toJSON()),
			cause: e,
		})
	}
	throw new TRPCError({
		code: "INTERNAL_SERVER_ERROR",
		message: e instanceof Error ? e.message : "Operator error",
		cause: e,
	})
}

/**
 * Operator-grade MCP surface: DNS → domain → cert → health, with stable error codes.
 * Designed so domainProvision cannot attach Traefik/ACME before DNS exists.
 */
export const operatorRouter = createTRPCRouter({
	ping: protectedProcedure.query(async () => {
		return {
			ok: true as const,
			service: "dokploy-operator",
			ts: new Date().toISOString(),
		}
	}),

	whoami: protectedProcedure.query(async ({ ctx }) => {
		return {
			ok: true as const,
			userId: ctx.user.id,
			email: ctx.user.email,
			role: ctx.user.role,
			organizationId: ctx.session.activeOrganizationId,
			// Never expose tokens
		}
	}),

	dnsStatus: protectedProcedure.query(async ({ ctx }) => {
		try {
			return await getCloudflareCredentialStatus(
				ctx.session.activeOrganizationId,
			)
		} catch (e) {
			throwOperator(e)
		}
	}),

	cloudflareStatus: protectedProcedure.query(async ({ ctx }) => {
		try {
			return await getCloudflareCredentialStatus(
				ctx.session.activeOrganizationId,
			)
		} catch (e) {
			throwOperator(e)
		}
	}),

	listDnsZones: protectedProcedure.query(async ({ ctx }) => {
		try {
			return await listOperatorZones(ctx.session.activeOrganizationId)
		} catch (e) {
			throwOperator(e)
		}
	}),

	listZones: protectedProcedure.query(async ({ ctx }) => {
		try {
			return await listOperatorZones(ctx.session.activeOrganizationId)
		} catch (e) {
			throwOperator(e)
		}
	}),

	listZoneDnsRecords: protectedProcedure
		.input(
			z.object({
				cfZoneId: z.string().min(1).optional(),
				dnsZoneId: z.string().min(1).optional(),
				dnsProviderId: z.string().min(1).optional(),
				credentialId: z.string().min(1).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			try {
				const zoneId = input.dnsZoneId || input.cfZoneId
				if (!zoneId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "cfZoneId or dnsZoneId is required",
					})
				}
				if (input.dnsProviderId) {
					const provider = await findDnsProviderInOrganization(
						input.dnsProviderId,
						ctx.session.activeOrganizationId,
					)
					const rawRecords = await listDnsProviderRecords(
						provider.config,
						zoneId,
					)
					return {
						dnsZoneId: zoneId,
						cfZoneId: zoneId,
						zoneName: "",
						records: rawRecords.map((r) => ({
							cfRecordId: r.id,
							dnsRecordId: r.id,
							type: r.type,
							name: r.name,
							content: r.content,
							ttl: r.ttl ?? 1,
							proxied: (r as unknown as { proxied?: boolean }).proxied ?? false,
							priority:
								(r as unknown as { priority?: number | null }).priority ?? null,
							managedBy: "manual" as const,
							lastSyncedAt: null,
						})),
					}
				}
				try {
					return await listZoneDnsRecordsService({
						organizationId: ctx.session.activeOrganizationId,
						cfZoneId: zoneId,
						credentialId: input.credentialId,
					})
				} catch (err) {
					const providers = await findDnsProvidersByOrganizationId(
						ctx.session.activeOrganizationId,
					)
					for (const p of providers) {
						try {
							const rawRecords = await listDnsProviderRecords(
								p.config,
								zoneId,
							)
							return {
								dnsZoneId: zoneId,
								cfZoneId: zoneId,
								zoneName: "",
								records: rawRecords.map((r) => ({
									cfRecordId: r.id,
									dnsRecordId: r.id,
									type: r.type,
									name: r.name,
									content: r.content,
									ttl: r.ttl ?? 1,
									proxied:
										(r as unknown as { proxied?: boolean }).proxied ?? false,
									priority:
										(r as unknown as { priority?: number | null }).priority ??
										null,
									managedBy: "manual" as const,
									lastSyncedAt: null,
								})),
							}
						} catch {
							// Continue
						}
					}
					throw err
				}
			} catch (e) {
				throwOperator(e)
			}
		}),

	listDnsRecords: protectedProcedure
		.input(
			z.object({
				cfZoneId: z.string().min(1).optional(),
				dnsZoneId: z.string().min(1).optional(),
				dnsProviderId: z.string().min(1).optional(),
				credentialId: z.string().min(1).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			try {
				const zoneId = input.dnsZoneId || input.cfZoneId
				if (!zoneId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "cfZoneId or dnsZoneId is required",
					})
				}
				if (input.dnsProviderId) {
					const provider = await findDnsProviderInOrganization(
						input.dnsProviderId,
						ctx.session.activeOrganizationId,
					)
					const rawRecords = await listDnsProviderRecords(
						provider.config,
						zoneId,
					)
					return {
						dnsZoneId: zoneId,
						cfZoneId: zoneId,
						zoneName: "",
						records: rawRecords.map((r) => ({
							cfRecordId: r.id,
							dnsRecordId: r.id,
							type: r.type,
							name: r.name,
							content: r.content,
							ttl: r.ttl ?? 1,
							proxied: (r as unknown as { proxied?: boolean }).proxied ?? false,
							priority:
								(r as unknown as { priority?: number | null }).priority ?? null,
							managedBy: "manual" as const,
							lastSyncedAt: null,
						})),
					}
				}
				try {
					return await listZoneDnsRecordsService({
						organizationId: ctx.session.activeOrganizationId,
						cfZoneId: zoneId,
						credentialId: input.credentialId,
					})
				} catch (err) {
					const providers = await findDnsProvidersByOrganizationId(
						ctx.session.activeOrganizationId,
					)
					for (const p of providers) {
						try {
							const rawRecords = await listDnsProviderRecords(
								p.config,
								zoneId,
							)
							return {
								dnsZoneId: zoneId,
								cfZoneId: zoneId,
								zoneName: "",
								records: rawRecords.map((r) => ({
									cfRecordId: r.id,
									dnsRecordId: r.id,
									type: r.type,
									name: r.name,
									content: r.content,
									ttl: r.ttl ?? 1,
									proxied:
										(r as unknown as { proxied?: boolean }).proxied ?? false,
									priority:
										(r as unknown as { priority?: number | null }).priority ??
										null,
									managedBy: "manual" as const,
									lastSyncedAt: null,
								})),
							}
						} catch {
							// Continue
						}
					}
					throw err
				}
			} catch (e) {
				throwOperator(e)
			}
		}),

	upsertDnsRecord: protectedProcedure
		.input(
			z.object({
				dnsZoneId: z.string().min(1).optional(),
				cfZoneId: z.string().min(1).optional(),
				dnsProviderId: z.string().min(1).optional(),
				name: z
					.string()
					.min(1)
					.describe("FQDN e.g. app.example.com"),
				type: zoneDnsRecordTypeSchema,
				content: z.string().min(1).describe("IP, hostname, or TXT value"),
				proxied: z
					.boolean()
					.optional()
					.describe(
						"Default false (DNS-only). Set true for Cloudflare proxy.",
					),
				ttl: z.union([z.literal(1), z.number().int().min(60).max(86400)]).optional(),
				priority: z.number().int().min(0).max(65535).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const result = await upsertDnsRecordByName({
					organizationId: ctx.session.activeOrganizationId,
					...input,
					cfZoneId: input.dnsZoneId || input.cfZoneId,
					dnsZoneId: input.dnsZoneId || input.cfZoneId,
				})
				await audit(ctx, {
					action: "update",
					resourceType: "domain",
					resourceId: result.cfRecordId,
					resourceName: result.name,
				})
				return result
			} catch (e) {
				throwOperator(e)
			}
		}),

	deleteDnsRecord: protectedProcedure
		.input(
			z.object({
				cfZoneId: z.string().min(1).optional(),
				dnsZoneId: z.string().min(1).optional(),
				cfRecordId: z.string().min(1).optional(),
				dnsRecordId: z.string().min(1).optional(),
				dnsProviderId: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const zoneId = input.dnsZoneId || input.cfZoneId
				const recordId = input.dnsRecordId || input.cfRecordId
				if (!zoneId || !recordId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Zone ID and Record ID are required",
					})
				}
				return await deleteDnsRecordById({
					organizationId: ctx.session.activeOrganizationId,
					dnsZoneId: zoneId,
					cfZoneId: zoneId,
					dnsRecordId: recordId,
					cfRecordId: recordId,
					dnsProviderId: input.dnsProviderId,
				})
			} catch (e) {
				throwOperator(e)
			}
		}),

	waitDns: protectedProcedure
		.input(
			z.object({
				host: z.string().min(1),
				expectedIp: z.string().optional(),
				timeoutMs: z.number().int().min(1000).max(600_000).optional(),
				intervalMs: z.number().int().min(500).max(60_000).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				return await waitForHostnameResolution(input)
			} catch (e) {
				throwOperator(e)
			}
		}),

	listDomains: protectedProcedure
		.input(
			z.object({
				applicationId: z.string().optional(),
				composeId: z.string().optional(),
				includeServerDomain: z.boolean().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const list: Array<Record<string, unknown>> = []
			if (input.applicationId) {
				await checkServicePermissionAndAccess(ctx, input.applicationId, {
					domain: ["read"],
				})
				const appDomains = await findDomainsByApplicationId(input.applicationId)
				list.push(...appDomains)
			} else if (input.composeId) {
				await checkServicePermissionAndAccess(ctx, input.composeId, {
					domain: ["read"],
				})
				const composeDomains = await findDomainsByComposeId(input.composeId)
				list.push(...composeDomains)
			}
			if (input.includeServerDomain) {
				const settings = await getWebServerSettings()
				if (settings?.host) {
					list.unshift({
						domainId: "server",
						domainType: "server",
						host: settings.host,
						https: settings.https,
						port: 3000,
						path: "/",
						certificateType: settings.certificateType,
						serverIp: settings.serverIp,
					})
				}
			}
			if (!input.applicationId && !input.composeId && !input.includeServerDomain) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: JSON.stringify({
						ok: false,
						code: OperatorErrorCode.validation_error,
						message: "applicationId, composeId, or includeServerDomain is required",
					}),
				})
			}
			return list
		}),

	getDomain: protectedProcedure
		.input(
			z.object({
				domainId: z.string().optional(),
				host: z.string().optional(),
			}),
		)
		.query(async ({ input }) => {
			if (input.domainId === "server") {
				const settings = await getWebServerSettings()
				return {
					domainId: "server",
					domainType: "server" as const,
					host: settings?.host ?? null,
					serverIp: settings?.serverIp ?? null,
					https: settings?.https ?? false,
					certificateType: settings?.certificateType ?? "none",
					letsEncryptEmail: settings?.letsEncryptEmail ?? null,
				}
			}
			if (input.domainId) {
				return await findDomainById(input.domainId)
			}
			if (input.host) {
				const norm = input.host.trim().toLowerCase()
				const settings = await getWebServerSettings()
				if (settings?.host?.trim().toLowerCase() === norm) {
					return {
						domainId: "server",
						domainType: "server" as const,
						host: settings.host,
						serverIp: settings.serverIp ?? null,
						https: settings.https,
						certificateType: settings.certificateType,
						letsEncryptEmail: settings.letsEncryptEmail ?? null,
					}
				}
				const { db } = await import("@dokploy/server/db")
				const { domains } = await import("@dokploy/server/db/schema")
				const { eq } = await import("drizzle-orm")
				const [row] = await db
					.select()
					.from(domains)
					.where(eq(domains.host, norm))
					.limit(1)
				if (row) return row
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Domain with host ${input.host} not found`,
				})
			}
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "domainId or host is required",
			})
		}),

	createDomain: protectedProcedure
		.input(
			z.object({
				host: z.string().min(1),
				domainType: z.enum(["application", "compose", "server"]),
				applicationId: z.string().optional(),
				composeId: z.string().optional(),
				serviceName: z.string().optional(),
				port: z.number().int().optional(),
				autoPort: z.boolean().optional(),
				path: z.string().optional(),
				internalPath: z.string().optional(),
				stripPath: z.boolean().optional(),
				https: z.boolean().optional(),
				certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
				customCertResolver: z.string().optional().nullable(),
				useCustomEntrypoint: z.boolean().optional(),
				customEntrypoint: z.string().optional().nullable(),
				middlewares: z.array(z.string()).optional(),
				dnsProvider: z
					.enum([
						"none",
						"cloudflare",
						"digitalocean",
						"hetzner",
						"route53",
						"porkbun",
						"infomaniak",
						"ovh",
						"gcloud",
					])
					.optional(),
				cfProxied: z.boolean().optional(),
				letsEncryptEmail: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.domainType === "server") {
				const settings = await updateWebServerSettings({
					host: input.host.trim().toLowerCase(),
					letsEncryptEmail: input.letsEncryptEmail,
					certificateType:
						input.certificateType ?? (input.https ? "letsencrypt" : "none"),
					https: input.https ?? true,
				})

				if (!settings) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Web server settings not found",
					})
				}

				const certResolver = await resolveServerDomainCertResolver(
					ctx.session.activeOrganizationId,
					input.host,
				)

				updateServerTraefik(
					settings,
					input.host,
					certResolver ? { certResolver } : undefined,
				)
				if (input.letsEncryptEmail) {
					updateLetsEncryptEmail(input.letsEncryptEmail)
				}

				await audit(ctx, {
					action: "update",
					resourceType: "settings",
					resourceName: "assign-domain-server",
				})

				return {
					domainId: "server",
					host: input.host,
					domainType: "server",
					https: settings.https,
					certificateType: settings.certificateType,
					serverIp: settings.serverIp,
				}
			}

			const serviceId = input.applicationId || input.composeId
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				})
			}
			const supportedDomainDnsProviders = [
				"akamai",
				"cloudflare",
				"digitalocean",
				"gcloud",
				"hetzner",
				"none",
				"ns1",
				"route53",
			] as const
			type DomainDnsProviderType = (typeof supportedDomainDnsProviders)[number]
			const dbDnsProvider: DomainDnsProviderType =
				input.dnsProvider &&
				(supportedDomainDnsProviders as readonly string[]).includes(
					input.dnsProvider,
				)
					? (input.dnsProvider as DomainDnsProviderType)
					: "none"

			const domain = await createDomain({
				host: input.host,
				domainType: input.domainType,
				applicationId: input.applicationId,
				composeId: input.composeId,
				serviceName: input.serviceName,
				port: input.port ?? 3000,
				autoPort: input.autoPort ?? false,
				path: input.path ?? "/",
				internalPath: input.internalPath ?? "/",
				stripPath: input.stripPath ?? false,
				https: input.https ?? true,
				certificateType: input.certificateType ?? "letsencrypt",
				customCertResolver: input.customCertResolver ?? null,
				customEntrypoint: input.customEntrypoint ?? null,
				middlewares: input.middlewares ?? [],
				dnsProvider: dbDnsProvider,
				cfProxied: input.cfProxied ?? false,
			})
			await audit(ctx, {
				action: "create",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			})

			if (input.dnsProvider && input.dnsProvider !== "none") {
				try {
					await ensureCloudflareAppDnsForDomain({
						organizationId: ctx.session.activeOrganizationId,
						domainId: domain.domainId,
						proxiedDefault: input.cfProxied ?? true,
					})
					void ensureTraefikCloudflareDnsToken({
						organizationId: ctx.session.activeOrganizationId,
					}).catch(() => {})
				} catch (err) {
					console.error("DNS provider domain auto DNS error:", err)
				}
			}

			return domain
		}),

	updateDomain: protectedProcedure
		.input(
			z.object({
				domainId: z.string().min(1),
				host: z.string().optional(),
				port: z.number().int().optional(),
				autoPort: z.boolean().optional(),
				path: z.string().optional(),
				internalPath: z.string().optional(),
				stripPath: z.boolean().optional(),
				https: z.boolean().optional(),
				certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
				customCertResolver: z.string().optional().nullable(),
				useCustomEntrypoint: z.boolean().optional(),
				customEntrypoint: z.string().optional().nullable(),
				middlewares: z.array(z.string()).optional(),
				serviceName: z.string().optional(),
				cfProxied: z.boolean().optional(),
				enabled: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.domainId === "server") {
				const settings = await updateWebServerSettings({
					host: input.host?.trim().toLowerCase(),
					https: input.https,
					certificateType: input.certificateType,
				})
				const certResolver = await resolveServerDomainCertResolver(
					ctx.session.activeOrganizationId,
					settings?.host,
				)
				updateServerTraefik(
					settings ?? null,
					settings?.host ?? null,
					certResolver ? { certResolver } : undefined,
				)
				return { domainId: "server", ...settings }
			}
			const current = await findDomainById(input.domainId)
			const serviceId = current.applicationId || current.composeId
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				})
			}
			const { domainId, useCustomEntrypoint: _unused, ...patch } = input
			await updateDomainById(domainId, patch)
			const domain = await findDomainById(domainId)
			if (domain.applicationId) {
				const application = await findApplicationById(domain.applicationId)
				await manageDomain(application, domain)
			}
			return domain
		}),

	deleteDomain: protectedProcedure
		.input(z.object({ domainId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			if (input.domainId === "server") {
				const settings = await updateWebServerSettings({
					host: null,
					https: false,
					certificateType: "none",
				})
				updateServerTraefik(settings ?? null, null)
				await audit(ctx, {
					action: "delete",
					resourceType: "settings",
					resourceName: "server-domain",
				})
				return { domainId: "server", deleted: true }
			}
			const domain = await findDomainById(input.domainId)
			const serviceId = domain.applicationId || domain.composeId
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["delete"],
				})
			}
			const result = await removeDomainById(input.domainId)
			if (domain.applicationId) {
				const application = await findApplicationById(domain.applicationId)
				await removeDomain(application, domain.uniqueConfigKey)
			}
			await audit(ctx, {
				action: "delete",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			})
			return result
		}),

	/**
	 * Safe high-level workflow: DNS upsert → wait resolve → attach domain →
	 * observe cert → HTTPS health. Prevents NXDOMAIN / ENOTFOUND ACME races.
	 * Supports application, compose, and server (main dokploy instance).
	 */
	domainProvision: protectedProcedure
		.input(
			z.object({
				host: z
					.string()
					.min(1)
					.describe("FQDN to provision, e.g. hydro.example.com"),
				domainType: z.enum(["application", "compose", "server"]),
				applicationId: z.string().optional(),
				composeId: z.string().optional(),
				serviceName: z
					.string()
					.optional()
					.describe("Required for compose — Traefik service name"),
				port: z.number().int().optional(),
				autoPort: z.boolean().optional(),
				path: z.string().optional(),
				internalPath: z.string().optional(),
				stripPath: z.boolean().optional(),
				https: z.boolean().optional().default(true),
				certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
				customCertResolver: z.string().optional().nullable(),
				useCustomEntrypoint: z.boolean().optional(),
				customEntrypoint: z.string().optional().nullable(),
				middlewares: z.array(z.string()).optional(),
				letsEncryptEmail: z.string().optional(),
				proxied: z
					.boolean()
					.optional()
					.describe(
						"Ignored for Cloudflare Auto DNS (always proxied + DNS-01). Kept for MCP compat.",
					),
				targetIp: z.string().optional(),
				waitDnsTimeoutMs: z.number().int().optional(),
				skipHealthCheck: z.boolean().optional(),
				dryRun: z.boolean().optional(),
				provider: z.string().optional(),
				dnsProviderId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.domainType !== "server") {
				const serviceId = input.applicationId || input.composeId
				if (serviceId) {
					await checkServicePermissionAndAccess(ctx, serviceId, {
						domain: ["create"],
					})
				}
			}
			try {
				const result = await provisionDomain({
					organizationId: ctx.session.activeOrganizationId,
					...input,
				})
				if (result.domain?.domainId) {
					await audit(ctx, {
						action: "create",
						resourceType: "domain",
						resourceId: result.domain.domainId,
						resourceName: result.host,
					})
				}
				return result
			} catch (e) {
				throwOperator(e)
			}
		}),

	serverDomainStatus: protectedProcedure.query(async ({ ctx }) => {
		try {
			const settings = await getWebServerSettings()
			const dnsPreview = await previewServerDomainDns(
				ctx.session.activeOrganizationId,
			)
			return {
				ok: true as const,
				host: settings?.host ?? null,
				serverIp: settings?.serverIp ?? null,
				https: settings?.https ?? false,
				certificateType: settings?.certificateType ?? "none",
				letsEncryptEmail: settings?.letsEncryptEmail ?? null,
				dns: dnsPreview,
			}
		} catch (e) {
			throwOperator(e)
		}
	}),

	assignServerDomain: protectedProcedure
		.input(
			z.object({
				host: z.string().min(1),
				https: z.boolean().optional().default(true),
				certificateType: z
					.enum(["letsencrypt", "none", "custom"])
					.optional()
					.default("letsencrypt"),
				letsEncryptEmail: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const settings = await updateWebServerSettings({
					host: input.host.trim().toLowerCase(),
					letsEncryptEmail: input.letsEncryptEmail,
					certificateType: input.certificateType,
					https: input.https,
				})

				if (!settings) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Web server settings not found",
					})
				}

				const certResolver = await resolveServerDomainCertResolver(
					ctx.session.activeOrganizationId,
					input.host,
				)

				updateServerTraefik(
					settings,
					input.host,
					certResolver ? { certResolver } : undefined,
				)
				if (input.letsEncryptEmail) {
					updateLetsEncryptEmail(input.letsEncryptEmail)
				}

				await audit(ctx, {
					action: "update",
					resourceType: "settings",
					resourceName: "assign-domain-server",
				})

				return settings
			} catch (e) {
				throwOperator(e)
			}
		}),

	previewServerDomainDns: protectedProcedure
		.input(
			z.object({ proxied: z.boolean().optional().default(true) }).optional(),
		)
		.query(async ({ ctx, input }) => {
			try {
				return await previewServerDomainDns(
					ctx.session.activeOrganizationId,
					input?.proxied ?? true,
				)
			} catch (e) {
				throwOperator(e)
			}
		}),

	applyServerDomainDns: protectedProcedure
		.input(
			z.object({ proxied: z.boolean().optional().default(true) }).optional(),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const result = await applyServerDomainDns({
					organizationId: ctx.session.activeOrganizationId,
					proxied: input?.proxied ?? true,
				})
				await audit(ctx, {
					action: "update",
					resourceType: "settings",
					resourceName: "apply-server-domain-dns",
				})
				return result
			} catch (e) {
				throwOperator(e)
			}
		}),

	provisionServerDomain: protectedProcedure
		.input(
			z.object({
				host: z.string().min(1),
				https: z.boolean().optional().default(true),
				certificateType: z
					.enum(["letsencrypt", "none", "custom"])
					.optional()
					.default("letsencrypt"),
				letsEncryptEmail: z.string().optional(),
				targetIp: z.string().optional(),
				proxied: z.boolean().optional(),
				waitDnsTimeoutMs: z.number().int().optional(),
				skipHealthCheck: z.boolean().optional(),
				dryRun: z.boolean().optional(),
				provider: z.string().optional(),
				dnsProviderId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const result = await provisionDomain({
					organizationId: ctx.session.activeOrganizationId,
					...input,
					domainType: "server",
				})
				await audit(ctx, {
					action: "update",
					resourceType: "settings",
					resourceName: "provision-server-domain",
				})
				return result
			} catch (e) {
				throwOperator(e)
			}
		}),

	provisionDns: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).describe("FQDN e.g. api.example.com"),
				type: zoneDnsRecordTypeSchema.default("A"),
				content: z.string().min(1).describe("Target IP or CNAME target"),
				proxied: z.boolean().optional().default(true),
				ttl: z
					.union([z.literal(1), z.number().int().min(60).max(86400)])
					.optional()
					.default(1),
				priority: z.number().int().min(0).max(65535).optional(),
				waitForResolution: z.boolean().optional().default(true),
				waitDnsTimeoutMs: z.number().int().optional(),
				provider: z.string().optional(),
				dnsProviderId: z.string().optional(),
				dnsZoneId: z.string().optional(),
				cfZoneId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const dnsRaw = await upsertDnsRecordByName({
					organizationId: ctx.session.activeOrganizationId,
					name: input.name,
					type: input.type,
					content: input.content,
					proxied: input.proxied,
					ttl: input.ttl,
					priority: input.priority,
					dnsZoneId: input.dnsZoneId || input.cfZoneId,
					cfZoneId: input.dnsZoneId || input.cfZoneId,
					dnsProviderId: input.dnsProviderId,
				})
				await audit(ctx, {
					action: "update",
					resourceType: "domain",
					resourceId: dnsRaw.cfRecordId,
					resourceName: dnsRaw.name,
				})

				let resolution = null
				if (input.waitForResolution) {
					resolution = await waitForHostnameResolution({
						host: input.name,
						expectedIp: input.proxied ? null : input.content,
						timeoutMs: input.waitDnsTimeoutMs ?? 180_000,
						intervalMs: 4_000,
					})
				}

				return {
					ok: true as const,
					record: dnsRaw,
					resolution,
				}
			} catch (e) {
				throwOperator(e)
			}
		}),

	certStatus: protectedProcedure
		.input(z.object({ host: z.string().min(1) }))
		.query(async ({ input }) => {
			try {
				return await getHostnameCertStatus(input.host)
			} catch (e) {
				throwOperator(e)
			}
		}),

	certRetry: protectedProcedure
		.input(z.object({ host: z.string().min(1) }))
		.mutation(async ({ input }) => {
			try {
				return await retryHostnameCertificate(input.host)
			} catch (e) {
				throwOperator(e)
			}
		}),

	traefikAcmeErrors: protectedProcedure
		.input(
			z.object({
				host: z.string().optional(),
				tail: z.number().int().min(10).max(2000).optional(),
			}),
		)
		.query(async ({ input }) => {
			try {
				return await getRecentTraefikAcmeErrors(input.host, input.tail)
			} catch (e) {
				throwOperator(e)
			}
		}),

	listProjects: protectedProcedure.query(async ({ ctx }) => {
		return await listOperatorProjects(ctx.session.activeOrganizationId)
	}),

	listEnvironments: protectedProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.query(async ({ ctx, input }) => {
			return await listOperatorEnvironments(
				ctx.session.activeOrganizationId,
				input?.projectId,
			)
		}),

	listApplications: protectedProcedure
		.input(z.object({ environmentId: z.string().optional() }).optional())
		.query(async ({ ctx, input }) => {
			return await listOperatorApplications(
				ctx.session.activeOrganizationId,
				input?.environmentId,
			)
		}),

	listCompose: protectedProcedure
		.input(z.object({ environmentId: z.string().optional() }).optional())
		.query(async ({ ctx, input }) => {
			return await listOperatorComposeServices(
				ctx.session.activeOrganizationId,
				input?.environmentId,
			)
		}),

	serviceStatus: protectedProcedure
		.input(
			z.object({
				applicationId: z.string().optional(),
				composeId: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			try {
				return await getOperatorServiceStatus({
					organizationId: ctx.session.activeOrganizationId,
					...input,
				})
			} catch (e) {
				throwOperator(e)
			}
		}),

	serviceLogs: protectedProcedure
		.input(
			z.object({
				appName: z.string().min(1),
				tail: z.number().int().min(1).max(5000).optional(),
				search: z.string().optional(),
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input }) => {
			try {
				const logs = await getOperatorServiceLogs(input)
				return { logs: redactSecrets(logs) }
			} catch (e) {
				throwOperator(e)
			}
		}),

	urlHealth: protectedProcedure
		.input(
			z.object({
				host: z.string().min(1),
				path: z.string().optional(),
				expectedIp: z.string().optional(),
				timeoutMs: z.number().int().optional(),
			}),
		)
		.query(async ({ input }) => {
			try {
				return await checkPublicUrlHealth(input)
			} catch (e) {
				throwOperator(e)
			}
		}),
})
