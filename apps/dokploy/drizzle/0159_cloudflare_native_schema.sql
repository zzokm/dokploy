CREATE TYPE "cloudflareZoneStatus" AS ENUM ('active', 'pending', 'disabled');
CREATE TYPE "cloudflareDnsRecordManagedBy" AS ENUM ('app_domain', 'mail_stack', 'manual');
CREATE TYPE "cloudflareDomainStatus" AS ENUM ('synced', 'pending', 'error');

CREATE TABLE "cloudflare_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"api_token_encrypted" text NOT NULL,
	"api_token_last4" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "cloudflare_settings"
	ADD CONSTRAINT "cloudflare_settings_organization_id_organization_id_fk"
	FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "cloudflare_zone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"cf_zone_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "cloudflareZoneStatus" DEFAULT 'pending' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "cloudflare_zone"
	ADD CONSTRAINT "cloudflare_zone_organization_id_organization_id_fk"
	FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "cloudflare_zone_org_idx" ON "cloudflare_zone" ("organization_id");
CREATE INDEX "cloudflare_zone_cfZoneId_idx" ON "cloudflare_zone" ("cf_zone_id");
CREATE UNIQUE INDEX "cloudflare_zone_org_cfZoneId_uq" ON "cloudflare_zone" ("organization_id", "cf_zone_id");

CREATE TABLE "cloudflare_dns_record" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"cf_zone_id" text NOT NULL,
	"cf_record_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"ttl" integer DEFAULT 1 NOT NULL,
	"proxied" boolean DEFAULT false NOT NULL,
	"priority" integer,
	"managed_by" "cloudflareDnsRecordManagedBy" DEFAULT 'manual' NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "cloudflare_dns_record"
	ADD CONSTRAINT "cloudflare_dns_record_organization_id_organization_id_fk"
	FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "cloudflare_dns_record_org_idx" ON "cloudflare_dns_record" ("organization_id");
CREATE INDEX "cloudflare_dns_record_zone_idx" ON "cloudflare_dns_record" ("cf_zone_id");
CREATE INDEX "cloudflare_dns_record_cfRecordId_idx" ON "cloudflare_dns_record" ("cf_record_id");
CREATE UNIQUE INDEX "cloudflare_dns_record_org_cfRecordId_uq" ON "cloudflare_dns_record" ("organization_id", "cf_record_id");

ALTER TABLE "domain" ADD COLUMN "cf_zone_id" text;
ALTER TABLE "domain" ADD COLUMN "cf_zone_name" text;
ALTER TABLE "domain" ADD COLUMN "cf_dns_record_id" text;
ALTER TABLE "domain" ADD COLUMN "cf_proxied" boolean DEFAULT true NOT NULL;
ALTER TABLE "domain" ADD COLUMN "cf_status" "cloudflareDomainStatus" DEFAULT 'pending' NOT NULL;

