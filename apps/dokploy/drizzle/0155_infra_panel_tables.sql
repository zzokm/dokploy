CREATE TABLE "infra_dns_record" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"type" text NOT NULL,
	"record_name" text NOT NULL,
	"content" text NOT NULL,
	"ttl" integer DEFAULT 3600 NOT NULL,
	"priority" integer,
	"srv_weight" integer,
	"srv_port" integer,
	"srv_target" text
);
--> statement-breakpoint
CREATE TABLE "infra_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"server_id" text,
	"name" text NOT NULL,
	"is_dns_managed" boolean DEFAULT true NOT NULL,
	"is_mail_managed" boolean DEFAULT false NOT NULL,
	"catch_all_local_part" text,
	"dkim_selector" text,
	"dkim_private_key_path" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra_mail_alias" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"source_local_part" text NOT NULL,
	"destination" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra_mailbox" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"local_part" text NOT NULL,
	"password_hash" text NOT NULL,
	"quota_bytes" bigint DEFAULT 5368709120 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "infra_dns_record" ADD CONSTRAINT "infra_dns_record_domain_id_infra_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."infra_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra_domain" ADD CONSTRAINT "infra_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra_domain" ADD CONSTRAINT "infra_domain_server_id_server_serverId_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("serverId") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra_mail_alias" ADD CONSTRAINT "infra_mail_alias_domain_id_infra_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."infra_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra_mailbox" ADD CONSTRAINT "infra_mailbox_domain_id_infra_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."infra_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "infra_dns_record_domain_id_idx" ON "infra_dns_record" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_domain_org_name_uidx" ON "infra_domain" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "infra_domain_organization_id_idx" ON "infra_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_mail_alias_domain_source_uidx" ON "infra_mail_alias" USING btree ("domain_id","source_local_part");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_mailbox_domain_local_uidx" ON "infra_mailbox" USING btree ("domain_id","local_part");