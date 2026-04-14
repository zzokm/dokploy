import { db } from "@dokploy/server/db"
import {
	createDnsRecordInput,
	createHostedDomainInput,
	updateHostedDomainInput,
	dnsRecord,
	hostedDomain,
} from "@/server/db/schema"
import {
	applyDnsForDomain,
	checkDnsStackStatus,
	createHostedDomain,
	getHostedDomainById,
	listHostedDomains,
} from "@dokploy/server/services/dns"
import { findServerById, getWebServerSettings, validateDomain } from "@dokploy/server"
import { deployCoreServices } from "@dokploy/server/services/docker/bootstrap-core-services"
import {
	CORE_BIND_IMAGE,
	CORE_DOVECOT_IMAGE,
	CORE_EXIM_IMAGE,
	CORE_ROUNDCUBE_IMAGE,
} from "@dokploy/server/utils/docker/core-services"
import { TRPCError } from "@trpc/server"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import {
	createTRPCRouter,
	protectedProcedure,
	withPermission,
} from "@/server/api/trpc"
import { normalizeDomainName } from "@dokploy/server"
import {
	applyMailConfigurations,
	onboardMailServiceForDomain,
} from "@dokploy/server/services/mail"

const orgId = (session: { activeOrganizationId: string }) => {
	if (!session.activeOrganizationId) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "No active organization" })
	}
	return session.activeOrganizationId
}

export const dnsRouter = createTRPCRouter({
	listDomains: protectedProcedure.query(async ({ ctx }) => {
		const oid = orgId(ctx.session)
		return listHostedDomains(db, oid)
	}),

	createDomain: withPermission("organization", "update")
		.input(createHostedDomainInput)
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			let name: string
			try {
				name = normalizeDomainName(input.name)
			} catch {
				throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid domain name" })
			}
			const created = await createHostedDomain(db, {
				organizationId: oid,
				name,
				isDnsManaged: input.isDnsManaged,
				isMailManaged: input.isMailManaged,
				serverId: input.serverId ?? null,
			})
			if (!created) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create domain",
				})
			}
			if (created.isMailManaged) {
				await onboardMailServiceForDomain(db, {
					domainId: created.id,
					organizationId: oid,
				})
			}
			return created
		}),

	updateDomain: withPermission("organization", "update")
		.input(updateHostedDomainInput)
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const existing = await getHostedDomainById(db, input.id, oid)
			if (!existing) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}
			let nextName = existing.name
			if (input.name !== undefined) {
				try {
					nextName = normalizeDomainName(input.name)
				} catch {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Invalid domain name",
					})
				}
			}
			const mailTurnedOn =
				input.isMailManaged === true && existing.isMailManaged === false

			const [row] = await db
				.update(hostedDomain)
				.set({
					...(input.name !== undefined && { name: nextName }),
					...(input.isDnsManaged !== undefined && {
						isDnsManaged: input.isDnsManaged,
					}),
					...(input.isMailManaged !== undefined && {
						isMailManaged: input.isMailManaged,
					}),
					...(input.serverId !== undefined && { serverId: input.serverId }),
					...(input.catchAllLocalPart !== undefined && {
						catchAllLocalPart: input.catchAllLocalPart,
					}),
					updatedAt: new Date().toISOString(),
				})
				.where(
					and(
						eq(hostedDomain.id, input.id),
						eq(hostedDomain.organizationId, oid),
					),
				)
				.returning()

			if (mailTurnedOn && row) {
				await onboardMailServiceForDomain(db, {
					domainId: input.id,
					organizationId: oid,
				})
			}

			return row
		}),

	deleteDomain: withPermission("organization", "update")
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const existing = await getHostedDomainById(db, input.id, oid)
			if (!existing) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}
			const wasMail = existing.isMailManaged
			await db.delete(hostedDomain).where(eq(hostedDomain.id, input.id))
			if (wasMail) {
				await applyMailConfigurations(db, {
					organizationId: oid,
					serverId: existing.serverId,
				})
			}
			return { ok: true as const }
		}),

	listRecords: protectedProcedure
		.input(z.object({ domainId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const d = await getHostedDomainById(db, input.domainId, oid)
			if (!d) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}
			return db
				.select()
				.from(dnsRecord)
				.where(eq(dnsRecord.domainId, input.domainId))
		}),

	createRecord: withPermission("organization", "update")
		.input(createDnsRecordInput)
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const d = await getHostedDomainById(db, input.domainId, oid)
			if (!d) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}
			const [row] = await db
				.insert(dnsRecord)
				.values({
					domainId: input.domainId,
					type: input.type,
					recordName: input.recordName,
					content: input.content,
					ttl: input.ttl ?? 3600,
					priority: input.priority ?? null,
					srvWeight: input.srvWeight ?? null,
					srvPort: input.srvPort ?? null,
					srvTarget: input.srvTarget ?? null,
				})
				.returning()
			return row
		}),

	deleteRecord: withPermission("organization", "update")
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const [rec] = await db
				.select()
				.from(dnsRecord)
				.where(eq(dnsRecord.id, input.id))
				.limit(1)
			if (!rec) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" })
			}
			const d = await getHostedDomainById(db, rec.domainId, oid)
			if (!d) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" })
			}
			await db.delete(dnsRecord).where(eq(dnsRecord.id, input.id))
			return { ok: true as const }
		}),

	applyDns: withPermission("organization", "update")
		.input(z.object({ domainId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			await applyDnsForDomain(db, {
				domainId: input.domainId,
				organizationId: oid,
			})
			return { ok: true as const }
		}),

	getConnectionInfo: protectedProcedure
		.input(z.object({ domainId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const d = await getHostedDomainById(db, input.domainId, oid)
			if (!d) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}

			let expectedIp = ""
			if (d.serverId) {
				const server = await findServerById(d.serverId)
				expectedIp = server.ipAddress
			} else {
				const settings = await getWebServerSettings()
				expectedIp = settings?.serverIp || ""
			}

			const ns1 = `ns1.${d.name}`
			const ns2 = `ns2.${d.name}`

			return {
				domainId: d.id,
				name: d.name,
				expectedIp,
				records: expectedIp
					? [
							{ type: "A" as const, name: "@", value: expectedIp },
							{ type: "A" as const, name: "www", value: expectedIp },
					  ]
					: [],
				nameservers: [
					{ type: "NS" as const, name: "@", value: ns1 },
					{ type: "NS" as const, name: "@", value: ns2 },
				],
				glue: expectedIp
					? [
							{ type: "A" as const, name: "ns1", value: expectedIp },
							{ type: "A" as const, name: "ns2", value: expectedIp },
					  ]
					: [],
			}
		}),

	verifyConnection: protectedProcedure
		.input(z.object({ domainId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const d = await getHostedDomainById(db, input.domainId, oid)
			if (!d) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}

			let expectedIp = ""
			if (d.serverId) {
				const server = await findServerById(d.serverId)
				expectedIp = server.ipAddress
			} else {
				const settings = await getWebServerSettings()
				expectedIp = settings?.serverIp || ""
			}

			return validateDomain(d.name, expectedIp || undefined)
		}),

	health: protectedProcedure.query(async ({ ctx }) => {
		const oid = orgId(ctx.session)
		const domains = await listHostedDomains(db, oid)
		return {
			domainCount: domains.length,
			lastChecked: new Date().toISOString(),
		}
	}),

	dnsStackStatus: withPermission("organization", "update")
		.input(z.object({ serverId: z.string().min(1).nullable().optional() }))
		.query(async ({ input }) => {
			return checkDnsStackStatus(input.serverId ?? null)
		}),

	stackReference: protectedProcedure.query(() => ({
		bindImage: CORE_BIND_IMAGE,
		eximImage: CORE_EXIM_IMAGE,
		dovecotImage: CORE_DOVECOT_IMAGE,
		roundcubeImage: CORE_ROUNDCUBE_IMAGE,
	})),

	deployCoreServices: withPermission("organization", "update")
		.input(z.object({ serverId: z.string().min(1).nullable().optional() }))
		.mutation(async ({ input }) => {
			await deployCoreServices({ serverId: input.serverId ?? null })
			return { ok: true as const }
		}),
})
