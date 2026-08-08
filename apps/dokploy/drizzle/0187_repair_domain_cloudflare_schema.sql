-- Repair production databases where an older 0185 left both legacy cloudflare_*
-- columns and the new cf_* columns in place after the migration was recorded.

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
				"cf_dns_record_id" = COALESCE("cf_dns_record_id", "cloudflare_record_id"),
				"cf_proxied" = COALESCE("cf_proxied", "cloudflare_proxied")
			WHERE "cloudflare_zone_id" IS NOT NULL
				OR "cloudflare_record_id" IS NOT NULL
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
