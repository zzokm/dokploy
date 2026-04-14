import { relations } from "drizzle-orm"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"
import { organization } from "./account"

export const cloudflareSettings = pgTable("cloudflare_settings", {
	organizationId: text("organization_id")
		.notNull()
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	apiTokenEncrypted: text("api_token_encrypted").notNull(),
	apiTokenLast4: text("api_token_last4").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export const cloudflareSettingsRelations = relations(
	cloudflareSettings,
	({ one }) => ({
		organization: one(organization, {
			fields: [cloudflareSettings.organizationId],
			references: [organization.id],
		}),
	}),
)

const createSchema = createInsertSchema(cloudflareSettings, {
	organizationId: z.string().min(1),
})

export const apiSetCloudflareToken = z.object({
	apiToken: z.string().min(20),
})

export const apiGetCloudflareSettings = createSchema.pick({ organizationId: true })

