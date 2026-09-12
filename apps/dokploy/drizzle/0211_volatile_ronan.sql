DO $$ BEGIN
 CREATE TYPE "public"."cloudflareDnsRecordManagedBy" AS ENUM('app_domain', 'mail_stack', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cloudflareZoneStatus" AS ENUM('active', 'pending', 'disabled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."dnsProvider" AS ENUM('cloudflare', 'digitalocean', 'hetzner', 'route53', 'gcloud', 'ns1', 'akamai');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."dnsRecordManagedBy" AS ENUM('app_domain', 'mail_stack', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."dnsZoneStatus" AS ENUM('active', 'pending', 'disabled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."domainConnectionCheckStatus" AS ENUM('pending', 'checking', 'active', 'dns_mismatch', 'dns_no_answer', 'server_unreachable', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cloudflareDomainStatus" AS ENUM('synced', 'pending', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."dnsDomainStatus" AS ENUM('synced', 'pending', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."domainDnsProvider" AS ENUM('none', 'cloudflare', 'digitalocean', 'hetzner', 'route53', 'gcloud', 'ns1', 'akamai');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "cloudflare_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"api_token_encrypted" text NOT NULL,
	"api_token_last4" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "dns_provider_credential" (
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
CREATE TABLE "dns_record" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"credential_id" text,
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
CREATE TABLE "dns_zone" (
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
CREATE TABLE "domain_connection_check" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"target_server_id" text,
	"expected_a" text,
	"expected_aaaa" text,
	"status" "domainConnectionCheckStatus" DEFAULT 'pending' NOT NULL,
	"last_checked_at" text,
	"last_verified_at" text,
	"last_dns_result" jsonb,
	"last_reachability_result" jsonb,
	"message" text
);
--> statement-breakpoint
ALTER TABLE "webServerSettings" ALTER COLUMN "whitelabelingConfig" SET DEFAULT '{"appName":null,"appDescription":null,"logoUrl":null,"faviconUrl":null,"customCss":null,"loginLogoUrl":null,"supportUrl":null,"docsUrl":null,"errorPageTitle":null,"errorPageDescription":null,"footerText":null,"ogImageUrl":null}'::jsonb;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "pullImages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "autoPort" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "dnsProvider" "domainDnsProvider" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "dns_credential_id" text;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "dns_zone_id" text;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "dns_zone_name" text;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "dns_record_id" text;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "dns_status" "dnsDomainStatus" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "dns_options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "cf_zone_id" text;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "cf_zone_name" text;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "cf_dns_record_id" text;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "cf_proxied" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "cf_status" "cloudflareDomainStatus" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "cloudflare_dns_record" ADD CONSTRAINT "cloudflare_dns_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloudflare_settings" ADD CONSTRAINT "cloudflare_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloudflare_zone" ADD CONSTRAINT "cloudflare_zone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_provider_credential" ADD CONSTRAINT "dns_provider_credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_record" ADD CONSTRAINT "dns_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_record" ADD CONSTRAINT "dns_record_credential_id_dns_provider_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."dns_provider_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_zone" ADD CONSTRAINT "dns_zone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_zone" ADD CONSTRAINT "dns_zone_credential_id_dns_provider_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."dns_provider_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_connection_check" ADD CONSTRAINT "domain_connection_check_domain_id_domain_domainId_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain"("domainId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_connection_check" ADD CONSTRAINT "domain_connection_check_target_server_id_server_serverId_fk" FOREIGN KEY ("target_server_id") REFERENCES "public"."server"("serverId") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloudflare_dns_record_org_idx" ON "cloudflare_dns_record" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cloudflare_dns_record_zone_idx" ON "cloudflare_dns_record" USING btree ("cf_zone_id");--> statement-breakpoint
CREATE INDEX "cloudflare_dns_record_cfRecordId_idx" ON "cloudflare_dns_record" USING btree ("cf_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cloudflare_dns_record_org_cfRecordId_uq" ON "cloudflare_dns_record" USING btree ("organization_id","cf_record_id");--> statement-breakpoint
CREATE INDEX "cloudflare_zone_org_idx" ON "cloudflare_zone" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cloudflare_zone_cfZoneId_idx" ON "cloudflare_zone" USING btree ("cf_zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cloudflare_zone_org_cfZoneId_uq" ON "cloudflare_zone" USING btree ("organization_id","cf_zone_id");--> statement-breakpoint
CREATE INDEX "dns_provider_credential_org_idx" ON "dns_provider_credential" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dns_provider_credential_org_provider_idx" ON "dns_provider_credential" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "dns_provider_credential_org_provider_label_uq" ON "dns_provider_credential" USING btree ("organization_id","provider","label");--> statement-breakpoint
CREATE INDEX "dns_record_org_idx" ON "dns_record" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dns_record_zone_idx" ON "dns_record" USING btree ("zone_external_id");--> statement-breakpoint
CREATE INDEX "dns_record_external_id_idx" ON "dns_record" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "dns_record_credential_id_idx" ON "dns_record" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dns_record_org_provider_credential_external_id_uq" ON "dns_record" USING btree ("organization_id","provider","credential_id","external_id");--> statement-breakpoint
CREATE INDEX "dns_zone_org_idx" ON "dns_zone" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dns_zone_external_id_idx" ON "dns_zone" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dns_zone_org_provider_credential_external_id_uq" ON "dns_zone" USING btree ("organization_id","provider","credential_id","external_id");--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_dns_credential_id_dns_provider_credential_id_fk" FOREIGN KEY ("dns_credential_id") REFERENCES "public"."dns_provider_credential"("id") ON DELETE set null ON UPDATE no action;