import { relations } from "drizzle-orm"
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import { nanoid } from "nanoid"
import { z } from "zod"
import { organization } from "./account"

export const cloudflareIntegration = pgTable("cloudflare_integration", {
	id: text("id")
		.primaryKey()
		.notNull()
		.$defaultFn(() => nanoid()),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	apiTokenEncrypted: text("api_token_encrypted").notNull(),
	apiTokenLast4: text("api_token_last4").notNull(),
	allowedZoneIds: jsonb("allowed_zone_ids").$type<string[]>().notNull().default([]),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export const cloudflareIntegrationRelations = relations(
	cloudflareIntegration,
	({ one }) => ({
		organization: one(organization, {
			fields: [cloudflareIntegration.organizationId],
			references: [organization.id],
		}),
	}),
)

const createSchema = createInsertSchema(cloudflareIntegration, {
	id: z.string().min(1),
})

export const apiCreateCloudflareIntegration = createSchema
	.pick({
		organizationId: true,
		name: true,
		apiTokenEncrypted: true,
		apiTokenLast4: true,
		allowedZoneIds: true,
	})
	.required()

export const apiListCloudflareIntegrations = z.object({
	organizationId: z.string().min(1),
})

export const apiDeleteCloudflareIntegration = z.object({
	id: z.string().min(1),
	organizationId: z.string().min(1),
})

