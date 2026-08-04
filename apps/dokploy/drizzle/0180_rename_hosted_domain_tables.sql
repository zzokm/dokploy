ALTER TABLE "infra_domain" RENAME TO "hosted_domain";--> statement-breakpoint
ALTER TABLE "infra_dns_record" RENAME TO "dns_record";--> statement-breakpoint
ALTER TABLE "infra_mailbox" RENAME TO "mailbox";--> statement-breakpoint
ALTER TABLE "infra_mail_alias" RENAME TO "mail_alias";--> statement-breakpoint
ALTER INDEX "infra_domain_org_name_uidx" RENAME TO "hosted_domain_org_name_uidx";--> statement-breakpoint
ALTER INDEX "infra_domain_organization_id_idx" RENAME TO "hosted_domain_organization_id_idx";--> statement-breakpoint
ALTER INDEX "infra_dns_record_domain_id_idx" RENAME TO "dns_record_domain_id_idx";--> statement-breakpoint
ALTER INDEX "infra_mailbox_domain_local_uidx" RENAME TO "mailbox_domain_local_uidx";--> statement-breakpoint
ALTER INDEX "infra_mail_alias_domain_source_uidx" RENAME TO "mail_alias_domain_source_uidx";--> statement-breakpoint
ALTER TABLE "hosted_domain" RENAME CONSTRAINT "infra_domain_organization_id_organization_id_fk" TO "hosted_domain_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "hosted_domain" RENAME CONSTRAINT "infra_domain_server_id_server_serverId_fk" TO "hosted_domain_server_id_server_serverId_fk";--> statement-breakpoint
ALTER TABLE "dns_record" RENAME CONSTRAINT "infra_dns_record_domain_id_infra_domain_id_fk" TO "dns_record_domain_id_hosted_domain_id_fk";--> statement-breakpoint
ALTER TABLE "mailbox" RENAME CONSTRAINT "infra_mailbox_domain_id_infra_domain_id_fk" TO "mailbox_domain_id_hosted_domain_id_fk";--> statement-breakpoint
ALTER TABLE "mail_alias" RENAME CONSTRAINT "infra_mail_alias_domain_id_infra_domain_id_fk" TO "mail_alias_domain_id_hosted_domain_id_fk";
