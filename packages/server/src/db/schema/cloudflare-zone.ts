import { relations } from "drizzle-orm"
import {
	boolean,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core"
import { nanoid } from "nanoid"
import { organization } from "./account"

export const cloudflareZoneStatus = pgEnum("cloudflareZoneStatus", [
	"active",
	"pending",
	"disabled",
])

export const cloudflareZone = pgTable(
	"cloudflare_zone",
	{
		id: text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		cfZoneId: text("cf_zone_id").notNull(),
		name: text("name").notNull(),
		status: cloudflareZoneStatus("status").notNull().default("pending"),
		paused: boolean("paused").notNull().default(false),
		lastSyncedAt: timestamp("last_synced_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("cloudflare_zone_org_idx").on(table.organizationId),
		index("cloudflare_zone_cfZoneId_idx").on(table.cfZoneId),
		uniqueIndex("cloudflare_zone_org_cfZoneId_uq").on(
			table.organizationId,
			table.cfZoneId,
		),
	],
)

export const cloudflareZoneRelations = relations(cloudflareZone, ({ one }) => ({
	organization: one(organization, {
		fields: [cloudflareZone.organizationId],
		references: [organization.id],
	}),
}))

