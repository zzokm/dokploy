import { relations } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { organization } from "./account";
import {
	autoDnsProviderEnum,
	dnsProviderCredential,
} from "./dns-provider-credential";

export const dnsRecordManagedBy = pgEnum("dnsRecordManagedBy", [
	"app_domain",
	"mail_stack", // historical; unused after email hosting removal
	"manual",
]);

/** Provider-specific record options (e.g. Cloudflare `{ proxied: true }` mirror). */
export type DnsRecordOptions = {
	proxied?: boolean;
	priority?: number;
	[key: string]: unknown;
};

/**
 * Provider-agnostic DNS record mirror.
 * Unique per (organization_id, provider, credential_id, external_id).
 * CF proxied lives in `options`, not as a user preference column.
 */
export const dnsRecord = pgTable(
	"dns_record",
	{
		id: text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		credentialId: text("credential_id").references(
			() => dnsProviderCredential.id,
			{ onDelete: "set null" },
		),
		provider: autoDnsProviderEnum("provider").notNull(),
		zoneExternalId: text("zone_external_id").notNull(),
		externalId: text("external_id").notNull(),
		type: text("type").notNull(),
		name: text("name").notNull(),
		content: text("content").notNull(),
		ttl: integer("ttl").notNull().default(1),
		options: jsonb("options").$type<DnsRecordOptions>().default({}).notNull(),
		managedBy: dnsRecordManagedBy("managed_by").notNull().default("manual"),
		lastSyncedAt: timestamp("last_synced_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("dns_record_org_idx").on(table.organizationId),
		index("dns_record_zone_idx").on(table.zoneExternalId),
		index("dns_record_external_id_idx").on(table.externalId),
		index("dns_record_credential_id_idx").on(table.credentialId),
		uniqueIndex("dns_record_org_provider_credential_external_id_uq").on(
			table.organizationId,
			table.provider,
			table.credentialId,
			table.externalId,
		),
	],
);

export const dnsRecordRelations = relations(dnsRecord, ({ one }) => ({
	organization: one(organization, {
		fields: [dnsRecord.organizationId],
		references: [organization.id],
	}),
}));
