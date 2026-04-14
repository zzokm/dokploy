import { eq, and, desc } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { db } from "@dokploy/server/db"
import { cloudflareIntegration } from "@dokploy/server/db/schema"
import { listCloudflareZones } from "@dokploy/server/services/cloudflare/zones"
import { canSealSecrets, unsealString, sealString } from "@dokploy/server/utils/crypto/seal"
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc"

export const cloudflareRouter = createTRPCRouter({
	listIntegrations: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = ctx.session.activeOrganizationId
		const rows = await db
			.select()
			.from(cloudflareIntegration)
			.where(eq(cloudflareIntegration.organizationId, organizationId))
			.orderBy(desc(cloudflareIntegration.createdAt))
		return rows.map((r) => ({
			id: r.id,
			name: r.name,
			apiTokenLast4: r.apiTokenLast4,
			allowedZoneIds: r.allowedZoneIds,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}))
	}),

	createIntegration: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				apiToken: z.string().min(20),
				allowedZoneIds: z.array(z.string().min(1)).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const organizationId = ctx.session.activeOrganizationId
			if (!canSealSecrets()) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"DOKPLOY_ENCRYPTION_KEY is required to store Cloudflare tokens securely. Set it and restart Dokploy.",
				})
			}

			let zones
			try {
				zones = await listCloudflareZones({ token: input.apiToken })
			} catch (e) {
				const message = e instanceof Error ? e.message : "Failed to validate token"
				throw new TRPCError({ code: "BAD_REQUEST", message })
			}

			const allowedZoneIds = input.allowedZoneIds ?? []
			if (allowedZoneIds.length) {
				const zoneIds = new Set(zones.map((z) => z.id))
				const unknown = allowedZoneIds.filter((z) => !zoneIds.has(z))
				if (unknown.length) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Token cannot access zone(s): ${unknown.join(", ")}`,
					})
				}
			}

			let encrypted: string
			try {
				encrypted = sealString(input.apiToken)
			} catch (e) {
				const message =
					e instanceof Error
						? e.message
						: "Failed to encrypt Cloudflare token"
				throw new TRPCError({ code: "BAD_REQUEST", message })
			}
			const last4 = input.apiToken.slice(-4)

			const [row] = await db
				.insert(cloudflareIntegration)
				.values({
					organizationId,
					name: input.name,
					apiTokenEncrypted: encrypted,
					apiTokenLast4: last4,
					allowedZoneIds,
				})
				.returning()

			if (!row) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save integration" })
			}

			return { id: row.id }
		}),

	deleteIntegration: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			const organizationId = ctx.session.activeOrganizationId
			const res = await db
				.delete(cloudflareIntegration)
				.where(
					and(
						eq(cloudflareIntegration.id, input.id),
						eq(cloudflareIntegration.organizationId, organizationId),
					),
				)
				.returning({ id: cloudflareIntegration.id })

			if (!res.length) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Integration not found" })
			}

			return true
		}),

	listZones: protectedProcedure
		.input(z.object({ integrationId: z.string().min(1) }))
		.query(async ({ input, ctx }) => {
			const organizationId = ctx.session.activeOrganizationId
			const [integration] = await db
				.select()
				.from(cloudflareIntegration)
				.where(
					and(
						eq(cloudflareIntegration.id, input.integrationId),
						eq(cloudflareIntegration.organizationId, organizationId),
					),
				)
				.limit(1)
			if (!integration) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Integration not found" })
			}

			let token: string
			try {
				token = unsealString(integration.apiTokenEncrypted)
			} catch (e) {
				const message =
					e instanceof Error
						? e.message
						: "Failed to decrypt Cloudflare token"
				throw new TRPCError({ code: "BAD_REQUEST", message })
			}
			const zones = await listCloudflareZones({ token })

			const allowed = integration.allowedZoneIds.length
				? new Set(integration.allowedZoneIds)
				: null

			return zones
				.filter((z) => (allowed ? allowed.has(z.id) : true))
				.map((z) => ({ id: z.id, name: z.name, status: z.status, paused: z.paused }))
		}),
})

