-- Multi-account DNS: zone/record uniqueness includes credential_id so the same
-- provider external_id can exist under two accounts in one organization.
-- Guarded for DBs where 0188 has not created dns_zone yet (drizzle only applies
-- migrations with journal `when` greater than the latest applied created_at).

DO $$ BEGIN
	IF to_regclass('public.dns_zone') IS NULL THEN
		RAISE EXCEPTION 'dns_zone missing: apply 0188_dns_provider_generalization before 0189';
	END IF;
END $$;
--> statement-breakpoint
-- Backfill null zone credential_id from deterministic vault CF id when present
UPDATE "dns_zone" AS z
SET "credential_id" = 'dns-cf-' || z."organization_id"
WHERE z."credential_id" IS NULL
	AND z."provider" = 'cloudflare'
	AND EXISTS (
		SELECT 1
		FROM "dns_provider_credential" AS c
		WHERE c."id" = 'dns-cf-' || z."organization_id"
	);
--> statement-breakpoint
DROP INDEX IF EXISTS "dns_zone_org_provider_external_id_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dns_zone_org_provider_credential_external_id_uq"
	ON "dns_zone" ("organization_id", "provider", "credential_id", "external_id");
--> statement-breakpoint
ALTER TABLE "dns_record" ADD COLUMN IF NOT EXISTS "credential_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dns_record" ADD CONSTRAINT "dns_record_credential_id_dns_provider_credential_id_fk"
	FOREIGN KEY ("credential_id") REFERENCES "public"."dns_provider_credential"("id")
	ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
UPDATE "dns_record" AS r
SET "credential_id" = z."credential_id"
FROM "dns_zone" AS z
WHERE r."credential_id" IS NULL
	AND z."credential_id" IS NOT NULL
	AND r."organization_id" = z."organization_id"
	AND r."provider" = z."provider"
	AND r."zone_external_id" = z."external_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "dns_record_org_provider_external_id_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dns_record_org_provider_credential_external_id_uq"
	ON "dns_record" ("organization_id", "provider", "credential_id", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dns_record_credential_id_idx" ON "dns_record" ("credential_id");
