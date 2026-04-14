import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { provisionMailDnsForZone } from "@dokploy/server/services/cloudflare/mail-dns"
import { createTRPCRouter, protectedProcedure, withPermission } from "../trpc"

export const cloudflareMailRouter = createTRPCRouter({
	provisionForZone: withPermission("organization", "update")
		.input(z.object({ cfZoneId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			try {
				return await provisionMailDnsForZone({
					organizationId: ctx.session.activeOrganizationId,
					cfZoneId: input.cfZoneId,
				})
			} catch (e) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: e instanceof Error ? e.message : "Failed to provision mail DNS",
				})
			}
		}),
})

