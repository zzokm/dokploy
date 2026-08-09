import { relations } from "drizzle-orm";
import {
	boolean,
	index,
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
	dnsProvider,
	dnsProviderCredential,
	type DnsProviderMeta,
} from "./dns-provider-credential";

export const dnsZoneStatus = pgEnum("dnsZoneStatus", [
	"active",
	"pending",
	"disabled",
]);

/**
 * Provider-agnostic zone mirror.
 * Unique per (organization_id, provider, credential_id, external_id) so two
 * accounts under the same provider can mirror the same external zone id.
 */
export const dnsZone = pgTable(
	"dns_zone",
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
		provider: dnsProvider("provider").notNull(),
		externalId: text("external_id").notNull(),
		name: text("name").notNull(),
		status: dnsZoneStatus("status").notNull().default("pending"),
		paused: boolean("paused").notNull().default(false),
		meta: jsonb("meta").$type<DnsProviderMeta>().default({}).notNull(),
		lastSyncedAt: timestamp("last_synced_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("dns_zone_org_idx").on(table.organizationId),
		index("dns_zone_external_id_idx").on(table.externalId),
		uniqueIndex("dns_zone_org_provider_credential_external_id_uq").on(
			table.organizationId,
			table.provider,
			table.credentialId,
			table.externalId,
		),
	],
);

export const dnsZoneRelations = relations(dnsZone, ({ one }) => ({
	organization: one(organization, {
		fields: [dnsZone.organizationId],
		references: [organization.id],
	}),
	credential: one(dnsProviderCredential, {
		fields: [dnsZone.credentialId],
		references: [dnsProviderCredential.id],
	}),
}));
