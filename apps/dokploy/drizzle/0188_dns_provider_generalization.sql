-- Multi-provider Auto DNS: sealed credential vault, generic zone/record mirrors,
-- and additive dns_* domain columns. Keeps cloudflare_* tables and cf_* columns.

DO $$ BEGIN
 CREATE TYPE "dnsProvider" AS ENUM('cloudflare', 'digitalocean', 'hetzner', 'route53', 'gcloud', 'ns1', 'akamai');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "dnsZoneStatus" AS ENUM('active', 'pending', 'disabled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "dnsRecordManagedBy" AS ENUM('app_domain', 'mail_stack', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "dnsDomainStatus" AS ENUM('synced', 'pending', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Expand domainDnsProvider enum (additive values)
DO $$ BEGIN
 ALTER TYPE "domainDnsProvider" ADD VALUE IF NOT EXISTS 'digitalocean';
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TYPE "domainDnsProvider" ADD VALUE IF NOT EXISTS 'hetzner';
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TYPE "domainDnsProvider" ADD VALUE IF NOT EXISTS 'route53';
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TYPE "domainDnsProvider" ADD VALUE IF NOT EXISTS 'gcloud';
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TYPE "domainDnsProvider" ADD VALUE IF NOT EXISTS 'ns1';
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TYPE "domainDnsProvider" ADD VALUE IF NOT EXISTS 'akamai';
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dns_provider_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "dnsProvider" NOT NULL,
	"label" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"secret_last4" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dns_provider_credential" ADD CONSTRAINT "dns_provider_credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dns_provider_credential_org_idx" ON "dns_provider_credential" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dns_provider_credential_org_provider_idx" ON "dns_provider_credential" USING btree ("organization_id","provider");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dns_provider_credential_org_provider_label_uq" ON "dns_provider_credential" USING btree ("organization_id","provider","label");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dns_zone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"credential_id" text,
	"provider" "dnsProvider" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "dnsZoneStatus" DEFAULT 'pending' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dns_zone" ADD CONSTRAINT "dns_zone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dns_zone" ADD CONSTRAINT "dns_zone_credential_id_dns_provider_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."dns_provider_credential"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dns_zone_org_idx" ON "dns_zone" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dns_zone_external_id_idx" ON "dns_zone" USING btree ("external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dns_zone_org_provider_external_id_uq" ON "dns_zone" USING btree ("organization_id","provider","external_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dns_record" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "dnsProvider" NOT NULL,
	"zone_external_id" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"ttl" integer DEFAULT 1 NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"managed_by" "dnsRecordManagedBy" DEFAULT 'manual' NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dns_record" ADD CONSTRAINT "dns_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dns_record_org_idx" ON "dns_record" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dns_record_zone_idx" ON "dns_record" USING btree ("zone_external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dns_record_external_id_idx" ON "dns_record" USING btree ("external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dns_record_org_provider_external_id_uq" ON "dns_record" USING btree ("organization_id","provider","external_id");
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "dns_credential_id" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "dns_zone_id" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "dns_zone_name" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "dns_record_id" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "dns_status" "dnsDomainStatus" DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "dns_options" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "domain" ADD CONSTRAINT "domain_dns_credential_id_dns_provider_credential_id_fk" FOREIGN KEY ("dns_credential_id") REFERENCES "public"."dns_provider_credential"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Backfill vault from legacy cloudflare_settings (sealed token already stored)
INSERT INTO "dns_provider_credential" (
	"id",
	"organization_id",
	"provider",
	"label",
	"secret_encrypted",
	"secret_last4",
	"meta",
	"created_at",
	"updated_at"
)
SELECT
	'dns-cf-' || "organization_id",
	"organization_id",
	'cloudflare'::"dnsProvider",
	'Cloudflare',
	"api_token_encrypted",
	"api_token_last4",
	'{}'::jsonb,
	"created_at",
	"updated_at"
FROM "cloudflare_settings"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Backfill generic zone mirrors from cloudflare_zone
INSERT INTO "dns_zone" (
	"id",
	"organization_id",
	"credential_id",
	"provider",
	"external_id",
	"name",
	"status",
	"paused",
	"meta",
	"last_synced_at",
	"created_at",
	"updated_at"
)
SELECT
	z."id",
	z."organization_id",
	'dns-cf-' || z."organization_id",
	'cloudflare'::"dnsProvider",
	z."cf_zone_id",
	z."name",
	CASE z."status"::text
		WHEN 'active' THEN 'active'::"dnsZoneStatus"
		WHEN 'disabled' THEN 'disabled'::"dnsZoneStatus"
		ELSE 'pending'::"dnsZoneStatus"
	END,
	z."paused",
	'{}'::jsonb,
	z."last_synced_at",
	z."created_at",
	z."updated_at"
FROM "cloudflare_zone" z
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Backfill generic record mirrors from cloudflare_dns_record
INSERT INTO "dns_record" (
	"id",
	"organization_id",
	"provider",
	"zone_external_id",
	"external_id",
	"type",
	"name",
	"content",
	"ttl",
	"options",
	"managed_by",
	"last_synced_at",
	"created_at",
	"updated_at"
)
SELECT
	r."id",
	r."organization_id",
	'cloudflare'::"dnsProvider",
	r."cf_zone_id",
	r."cf_record_id",
	r."type",
	r."name",
	r."content",
	r."ttl",
	jsonb_build_object(
		'proxied', COALESCE(r."proxied", false),
		'priority', r."priority"
	),
	CASE r."managed_by"::text
		WHEN 'app_domain' THEN 'app_domain'::"dnsRecordManagedBy"
		WHEN 'mail_stack' THEN 'mail_stack'::"dnsRecordManagedBy"
		ELSE 'manual'::"dnsRecordManagedBy"
	END,
	r."last_synced_at",
	r."created_at",
	r."updated_at"
FROM "cloudflare_dns_record" r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Backfill domain dns_* from cf_*
UPDATE "domain"
SET
	"dns_zone_id" = COALESCE("dns_zone_id", "cf_zone_id"),
	"dns_zone_name" = COALESCE("dns_zone_name", "cf_zone_name"),
	"dns_record_id" = COALESCE("dns_record_id", "cf_dns_record_id"),
	"dns_status" = COALESCE(
		"dns_status",
		CASE "cf_status"::text
			WHEN 'synced' THEN 'synced'::"dnsDomainStatus"
			WHEN 'error' THEN 'error'::"dnsDomainStatus"
			ELSE 'pending'::"dnsDomainStatus"
		END
	),
	"dns_options" = CASE
		WHEN "dnsProvider" = 'cloudflare' THEN jsonb_build_object('proxied', COALESCE("cf_proxied", true))
		ELSE COALESCE("dns_options", '{}'::jsonb)
	END,
	"dns_credential_id" = COALESCE(
		"dns_credential_id",
		CASE
			WHEN "dnsProvider" = 'cloudflare' THEN 'dns-cf-' || (
				SELECT cz."organization_id"
				FROM "cloudflare_zone" cz
				WHERE cz."cf_zone_id" = "domain"."cf_zone_id"
				LIMIT 1
			)
			ELSE NULL
		END
	)
WHERE "dnsProvider" <> 'none'
	OR "cf_zone_id" IS NOT NULL
	OR "cf_dns_record_id" IS NOT NULL;
