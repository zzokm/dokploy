import { relations } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { organization } from "./account";
import { server } from "./server";

export const hostedDomainEmailHosting = pgEnum("hostedDomainEmailHosting", [
	"dokploy",
	"external",
	"none",
])

export const hostedDomain = pgTable(
	"hosted_domain",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		serverId: text("server_id").references(() => server.serverId, {
			onDelete: "set null",
		}),
		name: text("name").notNull(),
		isDnsManaged: boolean("is_dns_managed").notNull().default(true),
		isMailManaged: boolean("is_mail_managed").notNull().default(false),
		emailHosting: hostedDomainEmailHosting("email_hosting")
			.notNull()
			.default("none"),
		catchAllLocalPart: text("catch_all_local_part"),
		dkimSelector: text("dkim_selector"),
		dkimPrivateKeyPath: text("dkim_private_key_path"),
		createdAt: text("created_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		updatedAt: text("updated_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(t) => ({
		orgNameIdx: uniqueIndex("hosted_domain_org_name_uidx").on(
			t.organizationId,
			t.name,
		),
		orgIdx: index("hosted_domain_organization_id_idx").on(t.organizationId),
	}),
);

export const dnsRecord = pgTable(
	"dns_record",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		domainId: text("domain_id")
			.notNull()
			.references(() => hostedDomain.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		recordName: text("record_name").notNull(),
		content: text("content").notNull(),
		ttl: integer("ttl").notNull().default(3600),
		priority: integer("priority"),
		srvWeight: integer("srv_weight"),
		srvPort: integer("srv_port"),
		srvTarget: text("srv_target"),
	},
	(t) => ({
		domainIdx: index("dns_record_domain_id_idx").on(t.domainId),
	}),
);

export const mailbox = pgTable(
	"mailbox",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		domainId: text("domain_id")
			.notNull()
			.references(() => hostedDomain.id, { onDelete: "cascade" }),
		localPart: text("local_part").notNull(),
		passwordHash: text("password_hash").notNull(),
		quotaBytes: bigint("quota_bytes", { mode: "number" })
			.notNull()
			.default(5_368_709_120),
		isActive: boolean("is_active").notNull().default(true),
		createdAt: text("created_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		updatedAt: text("updated_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(t) => ({
		domainLocalUid: uniqueIndex("mailbox_domain_local_uidx").on(
			t.domainId,
			t.localPart,
		),
	}),
);

export const mailAlias = pgTable(
	"mail_alias",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		domainId: text("domain_id")
			.notNull()
			.references(() => hostedDomain.id, { onDelete: "cascade" }),
		sourceLocalPart: text("source_local_part").notNull(),
		destination: text("destination").notNull(),
	},
	(t) => ({
		domainSourceUid: uniqueIndex("mail_alias_domain_source_uidx").on(
			t.domainId,
			t.sourceLocalPart,
		),
	}),
);

export const hostedDomainRelations = relations(hostedDomain, ({ one, many }) => ({
	organization: one(organization, {
		fields: [hostedDomain.organizationId],
		references: [organization.id],
	}),
	remoteServer: one(server, {
		fields: [hostedDomain.serverId],
		references: [server.serverId],
	}),
	dnsRecords: many(dnsRecord),
	mailboxes: many(mailbox),
	aliases: many(mailAlias),
}));

export const dnsRecordRelations = relations(dnsRecord, ({ one }) => ({
	domain: one(hostedDomain, {
		fields: [dnsRecord.domainId],
		references: [hostedDomain.id],
	}),
}));

export const mailboxRelations = relations(mailbox, ({ one }) => ({
	domain: one(hostedDomain, {
		fields: [mailbox.domainId],
		references: [hostedDomain.id],
	}),
}));

export const mailAliasRelations = relations(mailAlias, ({ one }) => ({
	domain: one(hostedDomain, {
		fields: [mailAlias.domainId],
		references: [hostedDomain.id],
	}),
}));

export {
	createDnsRecordInput,
	createHostedDomainInput,
	createMailAliasInput,
	createMailboxInput,
	updateHostedDomainInput,
} from "../../validations/dns-mail-schemas";
