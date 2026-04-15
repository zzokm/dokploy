ALTER TABLE "hosted_domain"
ADD COLUMN IF NOT EXISTS "email_hosting" text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hosted_domain_email_hosting_check'
  ) THEN
    ALTER TABLE "hosted_domain"
    ADD CONSTRAINT hosted_domain_email_hosting_check
    CHECK ("email_hosting" IN ('dokploy', 'external', 'none'));
  END IF;
END $$;

ALTER TABLE "webServerSettings"
ADD COLUMN IF NOT EXISTS "disable_built_in_email_server" boolean NOT NULL DEFAULT false;

