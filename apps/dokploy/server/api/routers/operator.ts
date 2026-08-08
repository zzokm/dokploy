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

	cloudflareStatus: protectedProcedure.query(async ({ ctx }) => {
		try {
			return await getCloudflareCredentialStatus(
				ctx.session.activeOrganizationId,
			)
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
		.input(z.object({ cfZoneId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			try {
				return await listZoneDnsRecordsService({
					organizationId: ctx.session.activeOrganizationId,
					cfZoneId: input.cfZoneId,
				})
			} catch (e) {
				throwOperator(e)
			}
		}),

	upsertDnsRecord: protectedProcedure
		.input(
			z.object({
				cfZoneId: z.string().min(1).optional(),
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
						"Default false (DNS-only). Use true only with DNS-01 ACME.",
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
				cfZoneId: z.string().min(1),
				cfRecordId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await deleteDnsRecordById({
					organizationId: ctx.session.activeOrganizationId,
					...input,
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
			}),
		)
		.query(async ({ ctx, input }) => {
			if (input.applicationId) {
				await checkServicePermissionAndAccess(ctx, input.applicationId, {
					domain: ["read"],
				})
				return await findDomainsByApplicationId(input.applicationId)
			}
			if (input.composeId) {
				await checkServicePermissionAndAccess(ctx, input.composeId, {
					domain: ["read"],
				})
				return await findDomainsByComposeId(input.composeId)
			}
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: JSON.stringify({
					ok: false,
					code: OperatorErrorCode.validation_error,
					message: "applicationId or composeId is required",
				}),
			})
		}),

	createDomain: protectedProcedure
		.input(
			z.object({
				host: z.string().min(1),
				domainType: z.enum(["application", "compose"]),
				applicationId: z.string().optional(),
				composeId: z.string().optional(),
				serviceName: z.string().optional(),
				port: z.number().int().optional(),
				path: z.string().optional(),
				https: z.boolean().optional(),
				certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
				/**
				 * Prefer operator.domainProvision — this primitive does NOT wait for DNS.
				 */
				dnsProvider: z.enum(["none", "cloudflare"]).optional(),
				cfProxied: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const serviceId = input.applicationId || input.composeId
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				})
			}
			const domain = await createDomain({
				host: input.host,
				domainType: input.domainType,
				applicationId: input.applicationId,
				composeId: input.composeId,
				serviceName: input.serviceName,
				port: input.port ?? 3000,
				path: input.path ?? "/",
				https: input.https ?? true,
				certificateType: input.certificateType ?? "letsencrypt",
				dnsProvider: input.dnsProvider ?? "none",
				cfProxied: input.cfProxied ?? false,
			})
			await audit(ctx, {
				action: "create",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			})
			return domain
		}),

	updateDomain: protectedProcedure
		.input(
			z.object({
				domainId: z.string().min(1),
				host: z.string().optional(),
				port: z.number().int().optional(),
				path: z.string().optional(),
				https: z.boolean().optional(),
				certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
				serviceName: z.string().optional(),
				cfProxied: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const current = await findDomainById(input.domainId)
			const serviceId = current.applicationId || current.composeId
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				})
			}
			const { domainId, ...patch } = input
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
	 */
	domainProvision: protectedProcedure
		.input(
			z.object({
				host: z
					.string()
					.min(1)
					.describe("FQDN to provision, e.g. hydro.example.com"),
				domainType: z.enum(["application", "compose"]),
				applicationId: z.string().optional(),
				composeId: z.string().optional(),
				serviceName: z
					.string()
					.optional()
					.describe("Required for compose — Traefik service name"),
				port: z.number().int().optional(),
				path: z.string().optional(),
				https: z.boolean().optional().default(true),
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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const serviceId = input.applicationId || input.composeId
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				})
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
