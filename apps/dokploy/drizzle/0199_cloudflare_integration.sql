CREATE TYPE "domainDnsProvider" AS ENUM ('none', 'cloudflare');

CREATE TYPE "cloudflareDnsRecordType" AS ENUM ('A', 'AAAA', 'CNAME');

CREATE TABLE "cloudflare_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"api_token_encrypted" text NOT NULL,
	"api_token_last4" text NOT NULL,
	"allowed_zone_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "cloudflare_integration"
	ADD CONSTRAINT "cloudflare_integration_organization_id_organization_id_fk"
	FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "domain" ADD COLUMN "dnsProvider" "domainDnsProvider" DEFAULT 'none' NOT NULL;
ALTER TABLE "domain" ADD COLUMN "cloudflare_integration_id" text;
ALTER TABLE "domain" ADD COLUMN "cloudflare_zone_id" text;
ALTER TABLE "domain" ADD COLUMN "cloudflare_record_id" text;
ALTER TABLE "domain" ADD COLUMN "cloudflare_proxied" boolean DEFAULT true NOT NULL;
ALTER TABLE "domain" ADD COLUMN "cloudflare_record_type" "cloudflareDnsRecordType";

ALTER TABLE "domain"
	ADD CONSTRAINT "domain_cloudflare_integration_id_cloudflare_integration_id_fk"
	FOREIGN KEY ("cloudflare_integration_id") REFERENCES "cloudflare_integration"("id") ON DELETE set null ON UPDATE no action;

