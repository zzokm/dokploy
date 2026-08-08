import { relations, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { domain } from "../validations/domain";
import { applications } from "./application";
import { compose } from "./compose";
import { dnsProviderCredential } from "./dns-provider-credential";
import { previewDeployments } from "./preview-deployments";
import { certificateType } from "./shared";

export const domainType = pgEnum("domainType", [
	"compose",
	"application",
	"preview",
]);

export const domainDnsProvider = pgEnum("domainDnsProvider", [
	"none",
	"cloudflare",
	"digitalocean",
	"hetzner",
	"route53",
	"gcloud",
	"ns1",
	"akamai",
]);

/** @deprecated Prefer `dnsDomainStatus` / `dns_status` column. Kept for dual-write. */
export const cloudflareDomainStatus = pgEnum("cloudflareDomainStatus", [
	"synced",
	"pending",
	"error",
]);

export const dnsDomainStatus = pgEnum("dnsDomainStatus", [
	"synced",
	"pending",
	"error",
]);

/** Provider-specific domain DNS options (e.g. CF mirror `{ proxied: true }`). */
export type DomainDnsOptions = {
	proxied?: boolean;
	[key: string]: unknown;
};

export const domains = pgTable("domain", {
	domainId: text("domainId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	host: text("host").notNull(),
	https: boolean("https").notNull().default(false),
	port: integer("port").default(3000),
	customEntrypoint: text("customEntrypoint"),
	path: text("path").default("/"),
	serviceName: text("serviceName"),
	domainType: domainType("domainType").default("application"),
	uniqueConfigKey: serial("uniqueConfigKey"),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	composeId: text("composeId").references(() => compose.composeId, {
		onDelete: "cascade",
	}),
	customCertResolver: text("customCertResolver"),
	applicationId: text("applicationId").references(
		() => applications.applicationId,
		{ onDelete: "cascade" },
	),
	previewDeploymentId: text("previewDeploymentId").references(
		(): AnyPgColumn => previewDeployments.previewDeploymentId,
		{ onDelete: "cascade" },
	),
	certificateType: certificateType("certificateType").notNull().default("none"),
	internalPath: text("internalPath").default("/"),
	stripPath: boolean("stripPath").notNull().default(false),
	middlewares: text("middlewares").array().default(sql`ARRAY[]::text[]`),
	forwardAuthEnabled: boolean("forwardAuthEnabled").notNull().default(false),

	dnsProvider: domainDnsProvider("dnsProvider").notNull().default("none"),

	// Generic Auto DNS binding (preferred)
	dnsCredentialId: text("dns_credential_id").references(
		() => dnsProviderCredential.id,
		{ onDelete: "set null" },
	),
	dnsZoneId: text("dns_zone_id"),
	dnsZoneName: text("dns_zone_name"),
	dnsRecordId: text("dns_record_id"),
	dnsStatus: dnsDomainStatus("dns_status").notNull().default("pending"),
	dnsOptions: jsonb("dns_options")
		.$type<DomainDnsOptions>()
		.default({})
		.notNull(),

	// Legacy Cloudflare columns — kept for dual-write compat (do not drop yet)
	cfZoneId: text("cf_zone_id"),
	cfZoneName: text("cf_zone_name"),
	cfDnsRecordId: text("cf_dns_record_id"),
	cfProxied: boolean("cf_proxied").notNull().default(true),
	cfStatus: cloudflareDomainStatus("cf_status").notNull().default("pending"),
});

export const domainsRelations = relations(domains, ({ one }) => ({
	application: one(applications, {
		fields: [domains.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [domains.composeId],
		references: [compose.composeId],
	}),
	previewDeployment: one(previewDeployments, {
		fields: [domains.previewDeploymentId],
		references: [previewDeployments.previewDeploymentId],
	}),
	dnsCredential: one(dnsProviderCredential, {
		fields: [domains.dnsCredentialId],
		references: [dnsProviderCredential.id],
	}),
}));

const dnsProviderEnum = z.enum([
	"none",
	"cloudflare",
	"digitalocean",
	"hetzner",
	"route53",
	"gcloud",
	"ns1",
	"akamai",
]);

const dnsStatusEnum = z.enum(["synced", "pending", "error"]);

const createSchema = createInsertSchema(domains, {
	...domain.shape,
	// Override pgEnum so Zod 4 infers only string literals, not numeric enum index
	domainType: z.enum(["compose", "application", "preview"]).optional(),
	dnsProvider: dnsProviderEnum.optional(),
	dnsStatus: dnsStatusEnum.optional(),
	cfStatus: dnsStatusEnum.optional(),
	dnsOptions: z.record(z.string(), z.unknown()).optional(),
});

export const apiCreateDomain = createSchema
	.pick({
		host: true,
		path: true,
		port: true,
		customEntrypoint: true,
		https: true,
		applicationId: true,
		certificateType: true,
		customCertResolver: true,
		composeId: true,
		serviceName: true,
		domainType: true,
		previewDeploymentId: true,
		internalPath: true,
		stripPath: true,
		middlewares: true,
		forwardAuthEnabled: true,
		dnsProvider: true,
		dnsCredentialId: true,
		dnsZoneId: true,
		dnsZoneName: true,
		dnsRecordId: true,
		dnsStatus: true,
		dnsOptions: true,
		// Accepted for mid-flight UI compat; Wave 3 coerces CF proxy server-side
		cfProxied: true,
	})
	.partial({ cfProxied: true });

export const apiFindDomain = z.object({
	domainId: z.string().min(1),
});

export const apiFindDomainByApplication = createSchema.pick({
	applicationId: true,
});

export const apiCreateTraefikMeDomain = createSchema.pick({}).extend({
	appName: z.string().min(1),
});

export const apiFindDomainByCompose = createSchema.pick({
	composeId: true,
});

export const apiUpdateDomain = createSchema
	.pick({
		host: true,
		path: true,
		port: true,
		customEntrypoint: true,
		https: true,
		certificateType: true,
		customCertResolver: true,
		serviceName: true,
		domainType: true,
		internalPath: true,
		stripPath: true,
		middlewares: true,
		forwardAuthEnabled: true,
		dnsProvider: true,
		dnsCredentialId: true,
		dnsZoneId: true,
		dnsZoneName: true,
		dnsRecordId: true,
		dnsStatus: true,
		dnsOptions: true,
		// Accepted for mid-flight UI compat; Wave 3 coerces CF proxy server-side
		cfProxied: true,
	})
	.partial({ cfProxied: true })
	.merge(createSchema.pick({ domainId: true }).required());
