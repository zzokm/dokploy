DO $$ BEGIN
 CREATE TYPE "domainConnectionCheckStatus" AS ENUM('pending', 'checking', 'active', 'dns_mismatch', 'dns_no_answer', 'server_unreachable', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domain_connection_check" (
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
DO $$ BEGIN
 ALTER TABLE "domain_connection_check" ADD CONSTRAINT "domain_connection_check_domain_id_domain_domainId_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain"("domainId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "domain_connection_check" ADD CONSTRAINT "domain_connection_check_target_server_id_server_serverId_fk" FOREIGN KEY ("target_server_id") REFERENCES "public"."server"("serverId") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

