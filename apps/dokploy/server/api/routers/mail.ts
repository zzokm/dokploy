import { db } from "@dokploy/server/db"
import {
	createMailAliasInput,
	createMailboxInput,
	mailAlias,
} from "@/server/db/schema"
import {
	applyMailConfigurations,
	createMailbox,
	ensureDkimForMailDomain,
	extractMailTlsForDomain,
	listAliasesForDomain,
	listMailboxesForDomain,
	listMailManagedDomains,
	syncMailTlsFromTraefikForApex,
} from "@dokploy/server/services/mail"
import { getHostedDomainById } from "@dokploy/server/services/dns"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
	createTRPCRouter,
	protectedProcedure,
	withPermission,
} from "@/server/api/trpc"

const orgId = (session: { activeOrganizationId: string }) => {
	if (!session.activeOrganizationId) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "No active organization" })
	}
	return session.activeOrganizationId
}

export const mailRouter = createTRPCRouter({
	provisionMail: withPermission("organization", "update")
		.input(z.object({ domainId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const d = await getHostedDomainById(db, input.domainId, oid)
			if (!d) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}
			await ensureDkimForMailDomain(db, input.domainId)
			try {
				await syncMailTlsFromTraefikForApex({ apexDomain: d.name })
			} catch {
				// Traefik may not have issued yet for mail.<apex>
			}
			await applyMailConfigurations(db, {
				organizationId: oid,
				serverId: d.serverId,
			})
			return { ok: true as const }
		}),

	createMailbox: withPermission("organization", "update")
		.input(createMailboxInput)
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			return createMailbox(db, {
				organizationId: oid,
				domainId: input.domainId,
				localPart: input.localPart,
				password: input.password,
				quotaBytes: input.quotaBytes,
			})
		}),

	createAlias: withPermission("organization", "update")
		.input(createMailAliasInput)
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const d = await getHostedDomainById(db, input.domainId, oid)
			if (!d) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}
			const [row] = await db
				.insert(mailAlias)
				.values({
					domainId: input.domainId,
					sourceLocalPart: input.sourceLocalPart,
					destination: input.destination,
				})
				.returning()
			await applyMailConfigurations(db, {
				organizationId: oid,
				serverId: d.serverId,
			})
			return row
		}),

	extractMailTls: withPermission("organization", "update")
		.input(z.object({ domain: z.string().min(1) }))
		.mutation(async ({ input }) => {
			await extractMailTlsForDomain({ domain: input.domain })
			return { ok: true as const }
		}),

	listMailboxes: protectedProcedure
		.input(z.object({ domainId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const rows = await listMailboxesForDomain(db, input.domainId, oid)
			if (rows === null) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}
			return rows
		}),

	listAliases: protectedProcedure
		.input(z.object({ domainId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const rows = await listAliasesForDomain(db, input.domainId, oid)
			if (rows === null) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}
			return rows
		}),

	listMailDomains: protectedProcedure.query(async ({ ctx }) => {
		const oid = orgId(ctx.session)
		return listMailManagedDomains(db, oid)
	}),
})
