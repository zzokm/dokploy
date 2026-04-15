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
import { getHostedDomainById, listHostedDomains } from "@dokploy/server/services/hosted-domain"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
	createTRPCRouter,
	protectedProcedure,
	withPermission,
} from "@/server/api/trpc"
import { hostedDomain, updateHostedDomainInput } from "@/server/db/schema"
import { and, eq } from "drizzle-orm"
import {
	CORE_DMS_IMAGE,
	CORE_ROUNDCUBE_IMAGE,
} from "@dokploy/server/utils/docker/core-services"
import { getCoreServicesStatus } from "@dokploy/server/services/docker/core-services-reconcile"
import dns from "node:dns"

const orgId = (session: { activeOrganizationId: string }) => {
	if (!session.activeOrganizationId) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "No active organization" })
	}
	return session.activeOrganizationId
}

export const mailRouter = createTRPCRouter({
	listDomains: protectedProcedure.query(async ({ ctx }) => {
		const oid = orgId(ctx.session)
		return await listHostedDomains(db, oid)
	}),

	updateDomain: withPermission("organization", "update")
		.input(updateHostedDomainInput)
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const existing = await getHostedDomainById(db, input.id, oid)
			if (!existing) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}
			const [row] = await ctx.db
				.update(hostedDomain)
				.set({
					...(input.isMailManaged !== undefined && {
						isMailManaged: input.isMailManaged,
					}),
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
			return row
		}),

	stackReference: protectedProcedure.query(() => ({
		mailserverImage: CORE_DMS_IMAGE,
		roundcubeImage: CORE_ROUNDCUBE_IMAGE,
	})),

	stackStatus: protectedProcedure.query(async () => {
		const status = await getCoreServicesStatus({ serverId: null, isServer: true })
		const byName = new Map(status.services.map((s) => [s.name, s]))
		return {
			mailserver: byName.get("mailserver") ?? null,
			roundcube: byName.get("roundcube") ?? null,
		}
	}),

	checkDnsPropagation: protectedProcedure
		.input(z.object({ domainId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const oid = orgId(ctx.session)
			const d = await getHostedDomainById(db, input.domainId, oid)
			if (!d) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" })
			}

			const apex = d.name.trim().toLowerCase()
			const expectedMx = `mail.${apex}`
			const expectedDkimName = `mail._domainkey.${apex}`
			const expectedDmarcName = `_dmarc.${apex}`
			const expectedMailHost = `mail.${apex}`
			const expectedWebmailHost = `webmail.${apex}`

			const resolve4 = dns.promises.resolve4
			const resolveMx = dns.promises.resolveMx
			const resolveTxt = dns.promises.resolveTxt

			const checks: Array<{
				name: string
				type: string
				status: "ok" | "missing" | "mismatch" | "error"
				details?: string | null
			}> = []

			const add = (
				name: string,
				type: string,
				status: "ok" | "missing" | "mismatch" | "error",
				details?: string | null,
			) => checks.push({ name, type, status, details: details ?? null })

			// A: mail / webmail
			for (const host of [expectedMailHost, expectedWebmailHost]) {
				try {
					const ips = await resolve4(host)
					add(host, "A", ips.length ? "ok" : "missing", ips.join(", "))
				} catch (e) {
					add(
						host,
						"A",
						"error",
						e instanceof Error ? e.message : "DNS lookup failed",
					)
				}
			}

			// MX: apex
			try {
				const mx = await resolveMx(apex)
				const has = mx.some((m) => m.exchange.toLowerCase().replace(/\.$/, "") === expectedMx)
				add(
					apex,
					"MX",
					has ? "ok" : mx.length ? "mismatch" : "missing",
					mx.map((m) => `${m.priority} ${m.exchange}`).join(", "),
				)
			} catch (e) {
				add(
					apex,
					"MX",
					"error",
					e instanceof Error ? e.message : "DNS lookup failed",
				)
			}

			// TXT: SPF apex
			try {
				const txt = await resolveTxt(apex)
				const flattened = txt.map((parts) => parts.join("")).map((v) => v.trim())
				const spf = flattened.find((v) => v.toLowerCase().startsWith("v=spf1"))
				add(apex, "TXT (SPF)", spf ? "ok" : "missing", spf ?? flattened.join(" | "))
			} catch (e) {
				add(
					apex,
					"TXT (SPF)",
					"error",
					e instanceof Error ? e.message : "DNS lookup failed",
				)
			}

			// TXT: DMARC
			try {
				const txt = await resolveTxt(expectedDmarcName)
				const flattened = txt.map((parts) => parts.join("")).map((v) => v.trim())
				const dmarc = flattened.find((v) => v.toLowerCase().startsWith("v=dmarc1"))
				add(expectedDmarcName, "TXT (DMARC)", dmarc ? "ok" : "missing", dmarc ?? null)
			} catch (e) {
				add(
					expectedDmarcName,
					"TXT (DMARC)",
					"error",
					e instanceof Error ? e.message : "DNS lookup failed",
				)
			}

			// TXT: DKIM
			try {
				const txt = await resolveTxt(expectedDkimName)
				const flattened = txt.map((parts) => parts.join("")).map((v) => v.trim())
				const dkim = flattened.find((v) => v.toLowerCase().includes("v=dkim1"))
				add(expectedDkimName, "TXT (DKIM)", dkim ? "ok" : "missing", dkim ?? null)
			} catch (e) {
				add(
					expectedDkimName,
					"TXT (DKIM)",
					"error",
					e instanceof Error ? e.message : "DNS lookup failed",
				)
			}

			return { ok: true as const, checks }
		}),

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
