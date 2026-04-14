import { relations } from "drizzle-orm"
import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core"
import { nanoid } from "nanoid"
import { organization } from "./account"

export const cloudflareDnsRecordManagedBy = pgEnum("cloudflareDnsRecordManagedBy", [
	"app_domain",
	"mail_stack",
	"manual",
])

export const cloudflareDnsRecord = pgTable(
	"cloudflare_dns_record",
	{
		id: text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		cfZoneId: text("cf_zone_id").notNull(),
		cfRecordId: text("cf_record_id").notNull(),
		type: text("type").notNull(),
		name: text("name").notNull(),
		content: text("content").notNull(),
		ttl: integer("ttl").notNull().default(1),
		proxied: boolean("proxied").notNull().default(false),
		priority: integer("priority"),
		managedBy: cloudflareDnsRecordManagedBy("managed_by")
			.notNull()
			.default("manual"),
		lastSyncedAt: timestamp("last_synced_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("cloudflare_dns_record_org_idx").on(table.organizationId),
		index("cloudflare_dns_record_zone_idx").on(table.cfZoneId),
		index("cloudflare_dns_record_cfRecordId_idx").on(table.cfRecordId),
		uniqueIndex("cloudflare_dns_record_org_cfRecordId_uq").on(
			table.organizationId,
			table.cfRecordId,
		),
	],
)

export const cloudflareDnsRecordRelations = relations(
	cloudflareDnsRecord,
	({ one }) => ({
		organization: one(organization, {
			fields: [cloudflareDnsRecord.organizationId],
			references: [organization.id],
		}),
	}),
)

