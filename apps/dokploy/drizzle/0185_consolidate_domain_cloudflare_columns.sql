-- Ensure Cloudflare domain columns exist (production may be missing 0182/0183 domain ALTERs)
-- and consolidate onto a single cf_* column set (drop legacy cloudflare_* / integration).

DO $$ BEGIN
 CREATE TYPE "domainDnsProvider" AS ENUM('none', 'cloudflare');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "cloudflareDomainStatus" AS ENUM('synced', 'pending', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "dnsProvider" "domainDnsProvider" DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cf_zone_id" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cf_zone_name" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cf_dns_record_id" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cf_proxied" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cf_status" "cloudflareDomainStatus" DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'domain'
			AND column_name = 'cloudflare_zone_id'
	) THEN
		EXECUTE $sql$
			UPDATE "domain"
			SET
				"cf_zone_id" = COALESCE("cf_zone_id", "cloudflare_zone_id"),
				"cf_dns_record_id" = COALESCE("cf_dns_record_id", "cloudflare_record_id")
			WHERE "cloudflare_zone_id" IS NOT NULL
				OR "cloudflare_record_id" IS NOT NULL
		$sql$;

		EXECUTE $sql$
			UPDATE "domain"
			SET "cf_proxied" = "cloudflare_proxied"
			WHERE "cf_dns_record_id" IS NULL
				AND "cloudflare_record_id" IS NOT NULL
		$sql$;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "domain" DROP CONSTRAINT IF EXISTS "domain_cloudflare_integration_id_cloudflare_integration_id_fk";
--> statement-breakpoint
ALTER TABLE "domain" DROP COLUMN IF EXISTS "cloudflare_integration_id";
--> statement-breakpoint
ALTER TABLE "domain" DROP COLUMN IF EXISTS "cloudflare_zone_id";
--> statement-breakpoint
ALTER TABLE "domain" DROP COLUMN IF EXISTS "cloudflare_record_id";
--> statement-breakpoint
ALTER TABLE "domain" DROP COLUMN IF EXISTS "cloudflare_proxied";
--> statement-breakpoint
ALTER TABLE "domain" DROP COLUMN IF EXISTS "cloudflare_record_type";
--> statement-breakpoint
DROP TABLE IF EXISTS "cloudflare_integration";
--> statement-breakpoint
DROP TYPE IF EXISTS "cloudflareDnsRecordType";
