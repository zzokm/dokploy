import { relations } from "drizzle-orm";
import {
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

export const dnsProvider = pgEnum("dnsProvider", [
	"cloudflare",
	"digitalocean",
	"hetzner",
	"route53",
	"gcloud",
	"ns1",
	"akamai",
]);

export type DnsProviderMeta = Record<string, unknown>;

/**
 * Org-scoped sealed credential vault for Auto DNS providers.
 * Secrets are AES-256-GCM sealed (`sealString`); APIs expose last4 only.
 */
export const dnsProviderCredential = pgTable(
	"dns_provider_credential",
	{
		id: text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: dnsProvider("provider").notNull(),
		label: text("label").notNull(),
		secretEncrypted: text("secret_encrypted").notNull(),
		secretLast4: text("secret_last4").notNull(),
		meta: jsonb("meta").$type<DnsProviderMeta>().default({}).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("dns_provider_credential_org_idx").on(table.organizationId),
		index("dns_provider_credential_org_provider_idx").on(
			table.organizationId,
			table.provider,
		),
		uniqueIndex("dns_provider_credential_org_provider_label_uq").on(
			table.organizationId,
			table.provider,
			table.label,
		),
	],
);

export const dnsProviderCredentialRelations = relations(
	dnsProviderCredential,
	({ one }) => ({
		organization: one(organization, {
			fields: [dnsProviderCredential.organizationId],
			references: [organization.id],
		}),
	}),
);
