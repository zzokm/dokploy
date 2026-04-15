# Domains + Emails (Cloudflare-only DNS) — technical implementation

This document describes how Dokploy’s **Domains** and **Emails** features work end-to-end in this repo, with an emphasis on the current **Cloudflare-only DNS automation** approach and the **docker-mailserver + Roundcube** data plane.

It is intentionally implementation-centric: it links the major **DB schema**, **services**, **tRPC routers**, **UI components**, and the **core-services (Docker) stack** that the panel orchestrates.

> Related: `docs/mail-architecture.md` focuses specifically on the mail stack history/choices; this document is the “umbrella” view across both domains and emails.

---

## 1) High-level architecture and boundaries

### 1.1 Control plane vs data plane

- **Control plane** (Next.js + Node + tRPC + Drizzle/Postgres):
  - Stores configuration and metadata (domains, Cloudflare settings, mail domains, mailboxes, aliases).
  - Calls Cloudflare APIs to **sync zones** and **upsert DNS records**.
  - Orchestrates core services (mailserver + Roundcube) by Docker APIs or Compose (dev).

- **Data plane** (Docker containers):
  - **`mailserver/docker-mailserver`**: Postfix + Dovecot (and optional features).
  - **`roundcube/roundcubemail`**: webmail UI.
  - These run on a shared Docker network (default `dokploy-network`).

### 1.2 DNS strategy: Cloudflare-only

This repo is structured so Dokploy is **not authoritative DNS**. DNS record creation and updates are done via **Cloudflare APIs**.

- **Cloudflare token storage** is org-wide (single source of truth): `cloudflare_settings` table.
- **Zones are synced** and stored in DB (`cloudflare_zone` table; see service below).
- **App/Compose domain A-record automation** is opt-in per domain via `domain.dnsProvider = "cloudflare"`.
- **Mail DNS provisioning** is run per zone (MX/SPF/DMARC/DKIM + A records for `mail.` and `webmail.`).

---

## 2) Data model (Drizzle schema)

### 2.1 Application/Compose/Preview domains table

File: `packages/server/src/db/schema/domain.ts`

Key fields used by Cloudflare automation:

- **`dnsProvider`**: enum `"none" | "cloudflare"` (default `"none"`)
- **Cloudflare linkage (newer fields)**:
  - `cfZoneId`, `cfZoneName`
  - `cfDnsRecordId`
  - `cfProxied` (orange-cloud preference; default `true`)
  - `cfStatus` (`"pending" | "synced" | "error"`)
- **Legacy Cloudflare columns** exist (`cloudflareZoneId`, `cloudflareRecordId`, `cloudflareProxied`, `cloudflareRecordType`) but the active automation uses the **`cf*`** fields.

API input schema includes Cloudflare toggles:

- File: `packages/server/src/db/schema/domain.ts`
- Object: `apiCreateDomain` includes `dnsProvider`, `cfProxied`, `cloudflareProxied`

### 2.2 Organization-wide Cloudflare settings

File: `packages/server/src/db/schema/cloudflare-settings.ts`

Table: `cloudflare_settings`

- `organizationId` (PK)
- `apiTokenEncrypted` (AES-256-GCM sealed string)
- `apiTokenLast4` (for UI display)
- `createdAt`, `updatedAt`

### 2.3 Mail: hosted domains, mailboxes, aliases

File: `packages/server/src/db/schema/hosted-domain.ts`

The **mail domain** concept is represented by `hosted_domain` (not the `domain` table).

- `hosted_domain`:
  - `name` (apex like `example.com`)
  - `isMailManaged` (true → included in Emails UI)
  - `isDnsManaged` (historical; in the Cloudflare-only model it is treated as false)
  - DKIM metadata fields (selector, key path) and catch-all local part
- `mailbox`:
  - `localPart`, `passwordHash`, quota, `isActive`
- `mail_alias`:
  - `sourceLocalPart` and `destination`

The “mail provisioning” workflow ensures that a `hosted_domain` row exists and flips `isMailManaged = true`.

---

## 3) Secret handling: `DOKPLOY_ENCRYPTION_KEY` and token sealing

File: `packages/server/src/utils/crypto/seal.ts`

Cloudflare API tokens are stored encrypted using **AES-256-GCM**:

- `DOKPLOY_ENCRYPTION_KEY` must be **base64 of 32 bytes**.
- `sealString()` produces `v1:<iv_b64>:<cipher_b64>:<tag_b64>`.
- `unsealString()` validates the format and decrypts.

This is enforced at the API layer:

- `apps/dokploy/server/api/routers/cloudflare-settings.ts`
  - `setToken`: refuses to store token unless encryption is configured and token validates against Cloudflare.
  - `syncZones` and `syncDns`: refuse to proceed if token can’t be decrypted (usually wrong/missing key).

---

## 4) Cloudflare: backend services (packages/server)

### 4.1 Sync zones (org → DB)

File: `packages/server/src/services/cloudflare/sync-zones.ts`

Flow:

1. Load `cloudflare_settings` row for org.
2. `unsealString(apiTokenEncrypted)` → token.
3. Call Cloudflare API to list zones (`listCloudflareZones()`; wrapper lives under `services/cloudflare/zones`).
4. Upsert `cloudflare_zone` rows for each zone.
5. Mark missing zones as `"disabled"` in DB.

Output: `{ synced: number }`

### 4.2 Best-match zone resolution for a host

File: `packages/server/src/services/cloudflare/app-domain-automation.ts`

Function: `findBestZoneMatch(organizationId, host)`

- Loads all zones for org ordered by descending `length(zone.name)` so the most-specific suffix matches first.
- Returns the first zone where:
  - `host === zone.name` OR `host.endsWith("." + zone.name)`

This is used by both preview and apply flows.

### 4.3 Preview app DNS drift vs desired state

File: `packages/server/src/services/cloudflare/dns-preview.ts`

Concept: for every domain whose `dnsProvider === "cloudflare"`, compute:

- Desired A record:
  - `resolveDomainTargetById(domainId)` → expected IP
- Desired proxied:
  - `domains.cfProxied ?? domains.cloudflareProxied ?? true`
- Current record (from Cloudflare):
  - List existing records for `A` + `name=host` in the best-match zone.
  - Prefer the stored `cfDnsRecordId` if present; otherwise take the first match.

States returned per domain:

- `ok`: IP and proxied match desired.
- `missing`: no A record.
- `drift`: record exists but differs.
- `no_zone`: no matching zone synced for this host.
- `no_target`: Dokploy cannot determine the expected public IP.
- `error`: Cloudflare API list failed.

This is used by:

- org-wide Sync DNS button (preview → auto-apply where safe)
- per-domain Sync DNS dialog (preview → auto-apply)

### 4.4 Apply app DNS selections (bulk)

File: `packages/server/src/services/cloudflare/dns-preview.ts`

Function: `applyCloudflareDnsSelectionsForOrg({ organizationId, selections })`

- Iterates the selected domain IDs
- For each `apply=true`, calls `ensureCloudflareAppDnsForDomain()`

### 4.5 Ensure Cloudflare A record exists/updated for a domain

File: `packages/server/src/services/cloudflare/app-domain-automation.ts`

Function: `ensureCloudflareAppDnsForDomain({ organizationId, domainId, proxiedDefault })`

Core behavior:

1. Decrypt org token.
2. Load domain row.
3. Find matching zone for `domain.host`.
4. Determine proxied preference (domain → default).
5. Call `upsertAppDnsRecord()` (Cloudflare API wrapper) to upsert the A record.
6. Update the `domain` row:
   - `cfZoneId`, `cfZoneName`, `cfDnsRecordId`, `cfProxied`, `cfStatus="synced"`
   - force `https=true`, `certificateType="letsencrypt"`
   - set `customCertResolver` to `"letsencrypt-cloudflare"` if proxied, else `null`
7. Upsert tracking record into `cloudflare_dns_record` (managedBy `"app_domain"`)

Delete path:

- `deleteCloudflareAppDnsForDomain()` attempts to delete the Cloudflare record using stored IDs, then clears `cfDnsRecordId` and sets `cfStatus="pending"`.

---

## 5) Cloudflare: mail DNS provisioning (packages/server)

### 5.1 Provision mail DNS for a zone

File: `packages/server/src/services/cloudflare/mail-dns.ts`

Function: `provisionMailDnsForZone({ organizationId, cfZoneId })`

Inputs:

- Org + specific Cloudflare zone ID.

Behavior:

1. Decrypt org token.
2. Load zone name (`zone.name`) from DB.
3. Load panel/server IP from Web Server settings:
   - `getWebServerSettings()` → `serverIp` (must be set)
4. Ensure `hosted_domain` exists for the zone apex and mark it mail-managed:
   - `ensureMailHostedDomain()`:
     - Upserts `hosted_domain` and sets `isMailManaged=true`
5. Ensure DKIM exists:
   - `ensureDkimForMailDomain(db, hostedDomainId)`
6. Read DKIM TXT:
   - Prefer DMS-generated `mail.txt` mounted under `mailDmsConfigDir/opendkim/keys/<apex>/mail.txt`
     - Parse via `parseDkimTxtFromMailDotTxt()`
   - Fallback to public PEM conversion if needed
7. Upsert Cloudflare DNS records (typical set):
   - `A mail.<apex> → serverIp` (proxied false)
   - `A webmail.<apex> → serverIp` (proxied true)
   - `MX <apex> → mail.<apex>` (priority 10)
   - `TXT <apex>` SPF: `v=spf1 mx a ip4:<serverIp> ~all`
   - `TXT _dmarc.<apex>`: `v=DMARC1; p=quarantine; rua=mailto:postmaster@<apex>`
   - `TXT mail._domainkey.<apex>`: DKIM TXT value
8. Best-effort TLS sync for `mail.<apex>` from Traefik ACME storage:
   - `syncMailTlsFromTraefikForApex()`
9. Apply mail configurations so DMS sees the domain/mailboxes:
   - `applyMailConfigurations(db, { organizationId, serverId })`

Output: `{ ok: true, hostedDomainId }`

---

## 6) tRPC routers (apps/dokploy)

### 6.1 Cloudflare settings router (org-wide)

File: `apps/dokploy/server/api/routers/cloudflare-settings.ts`

Procedures:

- `get`: returns `{ connected, apiTokenLast4, updatedAt }`
- `setToken({ apiToken })`:
  - validates encryption key
  - validates token by calling Cloudflare list-zones
  - upserts `cloudflare_settings`
  - triggers zone sync (`syncCloudflareZonesForOrg`)
  - best-effort injects `CF_DNS_API_TOKEN` into Traefik env (for DNS-01) via `writeTraefikSetup`
- `syncZones()`:
  - asserts token decryptable, then `syncCloudflareZonesForOrg`
- `listZones()`:
  - reads `cloudflare_zone` rows for UI grid
- `previewAppDns()` / `previewAppDnsForDomain({ domainId })`:
  - returns drift/preview items (see service section)
- `applyAppDnsSelections({ selections })`:
  - permission checks and bulk apply
- `syncDns()` (**main “one button” automation**):
  - sync zones
  - preview + auto-apply app A-record changes (where safe)
  - for each enabled zone: `provisionMailDnsForZone()`
  - returns `{ ok, appDns, mail }`

### 6.2 Domain router (create/update/delete + connection checks)

File: `apps/dokploy/server/api/routers/domain.ts`

Highlights:

- `create(input: apiCreateDomain)`:
  - creates the domain record and writes Traefik/labels via `manageDomain(...)`
  - if `dnsProvider === "cloudflare"`:
    - calls `ensureCloudflareAppDnsForDomain(...)`
    - if Cloudflare setup fails, it **rolls back** by removing the domain and throws a user-friendly error
- `update(input: apiUpdateDomain)`:
  - updates the DB record + re-renders Traefik config
  - best-effort re-syncs Cloudflare if the domain is Cloudflare-managed
- `delete({ domainId })`:
  - best-effort deletes Cloudflare A record
  - removes domain config
- `getConnectionInstructions({ domainId })` / `getConnectionStatus({ domainId })` / `verifyConnection({ domainId })`:
  - non-Cloudflare path: generates “set an A record to this IP” instructions and verifies public DNS + reachability
  - implementation details are in `packages/server/src/services/domain-connection.ts`
- `setDnsProviderCloudflare({ domainId, proxied })`:
  - flips a domain into Cloudflare-managed mode and persists proxied preference (used by per-domain controls UI)

### 6.3 Mail router (mail domains + mailboxes + DNS validation)

File: `apps/dokploy/server/api/routers/mail.ts`

Capabilities:

- `stackReference` and `stackStatus`:
  - returns image references and live container running state (mailserver + roundcube)
- `listMailDomains()`:
  - lists `hosted_domain` rows where mail is enabled (server-side service)
- `updateDomain({ id, isMailManaged?, catchAllLocalPart? })`:
  - toggles mail and updates catch-all
- `listMailboxes({ domainId })`, `createMailbox(...)`
- `listAliases({ domainId })`, `createAlias(...)`
- `checkDnsPropagation({ domainId })`:
  - performs public DNS lookups for:
    - `A` of `mail.<apex>` and `webmail.<apex>`
    - `MX` on apex
    - SPF TXT on apex
    - DMARC TXT on `_dmarc.<apex>`
    - DKIM TXT on `mail._domainkey.<apex>`
  - returns structured results for the UI “Validate DNS” button

---

## 7) UI implementation (apps/dokploy/components)

### 7.1 Domains (Cloudflare)

#### 7.1.1 Domains page: connect token, sync zones, sync DNS

File: `apps/dokploy/components/dashboard/domains/cloudflare-zones-grid.tsx`

Two states:

- **Disconnected**:
  - token input + “Connect Cloudflare”
  - calls `cloudflareSettings.setToken`
- **Connected**:
  - “Sync DNS”:
    - calls `cloudflareSettings.syncDns`
    - this triggers org-wide app A-record reconciliation and mail DNS provisioning per zone
  - “Sync zones”:
    - calls `cloudflareSettings.syncZones`
  - zone table:
    - reads `cloudflareSettings.listZones`

#### 7.1.2 Settings page card

File: `apps/dokploy/components/dashboard/settings/dns-providers/cloudflare-settings-card.tsx`

This mirrors the same org-wide settings:

- shows token last4
- can “Sync zones”
- can replace token (calls `cloudflareSettings.setToken`)

#### 7.1.3 Per-domain controls (proxy toggle + sync)

Files:

- `apps/dokploy/components/dashboard/application/domains/cloudflare-domain-controls.tsx`
- `apps/dokploy/components/dashboard/application/domains/cloudflare-domain-sync-dialog.tsx`

Behavior:

- Shows a Cloudflare “card” in the domain view.
- Proxy toggle:
  - updates the domain record via `domain.setDnsProviderCloudflare({ proxied })`
  - (when connected) persists preference used by Cloudflare record upserts
- “Sync DNS” button:
  - opens dialog
  - dialog loads preview (`cloudflareSettings.previewAppDnsForDomain`)
  - auto-applies changes by calling `cloudflareSettings.applyAppDnsSelections` when actionable

#### 7.1.4 Adding a domain with Cloudflare zone mode

File: `apps/dokploy/components/dashboard/application/domains/handle-domain.tsx`

The “Add domain” dialog supports:

- Manual host input (“Custom hostname”)
- Cloudflare zone mode:
  - reads `cloudflareSettings.get` and `cloudflareSettings.listZones`
  - builds a hostname from:
    - selected zone + optional subdomain label
  - on submit it sets:
    - `dnsProvider="cloudflare"`
    - `cfProxied` based on UI switch
    - forces https + letsencrypt options for Cloudflare-managed domains

### 7.2 Emails UI

#### 7.2.1 Emails overview page

File: `apps/dokploy/components/dashboard/emails/manage-emails.tsx`

- Shows:
  - `EmailsStackCard` (image references)
  - `MailDomainsListCard` (mail-enabled domains list)

#### 7.2.2 Mail domains list → dedicated domain page

File: `apps/dokploy/components/dashboard/emails/mail-domains-list-card.tsx`

- The “Manage” action navigates to:
  - `/dashboard/emails/[domainId]`

Page:

- `apps/dokploy/pages/dashboard/emails/[domainId].tsx`
  - SSR authentication + renders `MailDomainPage`

#### 7.2.3 Mail domain detail page

File: `apps/dokploy/components/dashboard/emails/mail-domain-page.tsx`

Key features:

- Status badges:
  - `mail.stackStatus` for mailserver + roundcube running state
  - DKIM selector from `hosted_domain`
- “Validate DNS” button:
  - calls `mail.checkDnsPropagation`
- Embedded management cards:
  - catch-all
  - mailboxes (create + connection settings + “Open webmail”)
  - aliases

#### 7.2.4 Open webmail behavior

File: `apps/dokploy/components/dashboard/emails/mail-mailboxes-card.tsx`

- “Open webmail” opens:
  - `https://webmail.<apex>/?_task=login&_user=<email>`
- It **does not** attempt to POST credentials from the panel.

---

## 8) Core services (mailserver + Roundcube) orchestration

There are two main orchestration paths:

1. **Compose-based** (dev/local) using `docker/core-services/docker-compose.yml`
2. **Docker API-based** (server reconcile) using `packages/server/src/services/docker/*`

### 8.1 Compose stack (dev/local)

File: `docker/core-services/docker-compose.yml`

Services (mail profile):

- `dokploy-mailserver`:
  - ports mapped to host dev ports (25/587/465/143/993)
  - `SSL_TYPE=manual` and reads PEMs from `/tmp/docker-mailserver/ssl/*`
  - mounts `apps/dokploy/.docker/core-services/mail/*`
- `core-services-roundcube`:
  - Roundcube listens on 80
  - IMAP points at `ssl://dokploy-mailserver:993`
  - mounts `mail/roundcube-config` to `/var/roundcube/config`

### 8.2 Core services init script (dev/local)

File: `scripts/core-services-init.mjs`

- Ensures the external docker network exists (`dokploy-network` by default).
- Ensures mail data/config directories exist under `apps/dokploy/.docker/core-services/mail/*`.
- Attempts to generate placeholder PEMs for DMS if `openssl` is available (otherwise prints a warning).

### 8.3 Server-side reconcile + bootstrap (Docker API)

Files:

- `packages/server/src/services/docker/core-services-reconcile.ts`
- `packages/server/src/services/docker/bootstrap-core-services.ts`

Behavior:

- `reconcileCoreServices()`:
  - ensures network exists (overlay if swarm active, otherwise bridge)
  - ensures containers exist and are connected to the network
  - if missing or start fails → `deployCoreServices()` redeploys the stack

- `deployCoreServices()`:
  - creates mailserver + roundcube containers with:
    - host binds aligned with `serverPaths()`
    - Roundcube configured for IMAPS + SMTP submission
  - removes legacy containers if present

### 8.4 Roundcube TLS relaxation for internal hop

Files:

- `apps/dokploy/.docker/core-services/mail/roundcube-config/zz-dokploy-internal-tls.inc.php`
- also written by bootstrap to the server’s roundcube config bind mount

Purpose:

- Roundcube connects to docker-mailserver using a **Docker DNS name** (container name).
- The mailserver’s certificate is typically issued for a **public hostname** (OVERRIDE_HOSTNAME / `mail.<apex>`).
- That mismatch causes IMAP TLS verification failures; the snippet disables peer verification **only for internal container-to-container traffic**.

---

## 9) Operational runbooks / expected flows

### 9.1 Typical “bring up” sequence (fresh org)

1. Set `DOKPLOY_ENCRYPTION_KEY` (base64 of 32 bytes) and restart.
2. In **Domains (Cloudflare)**:
   - paste API token and connect
   - zones are synced automatically
3. Click **Sync DNS**:
   - app domains with `dnsProvider="cloudflare"` are reconciled
   - mail DNS is provisioned for each enabled zone:
     - `mail.<apex>`, `webmail.<apex>`, MX/SPF/DMARC/DKIM
4. In **Emails**:
   - mail domains list populates (because zones become mail-managed)
   - open a domain page to create mailboxes/aliases
   - use **Validate DNS** to verify propagation

### 9.2 Failure modes to expect

- **Cloudflare token decryption errors**:
  - `DOKPLOY_ENCRYPTION_KEY` missing/wrong → Cloudflare features error until fixed and the app restarted.
- **No zone match** for a host:
  - The domain host is not under any synced zone in this org.
- **No server IP configured** for mail DNS provisioning:
  - Mail DNS requires `serverIp` from Web Server settings.
- **TLS verification errors (Roundcube → DMS)**:
  - addressed by the internal TLS relaxation snippet + using `ssl://` IMAP in Roundcube env.

---

## 10) File map (quick index)

### Cloudflare (DB + services)

- `packages/server/src/db/schema/cloudflare-settings.ts`
- `packages/server/src/services/cloudflare/settings.ts`
- `packages/server/src/services/cloudflare/sync-zones.ts`
- `packages/server/src/services/cloudflare/dns-preview.ts`
- `packages/server/src/services/cloudflare/app-domain-automation.ts`
- `packages/server/src/services/cloudflare/mail-dns.ts`

### Cloudflare (tRPC + UI)

- `apps/dokploy/server/api/routers/cloudflare-settings.ts`
- `apps/dokploy/components/dashboard/domains/cloudflare-zones-grid.tsx`
- `apps/dokploy/components/dashboard/settings/dns-providers/cloudflare-settings-card.tsx`
- `apps/dokploy/components/dashboard/application/domains/cloudflare-domain-controls.tsx`
- `apps/dokploy/components/dashboard/application/domains/cloudflare-domain-sync-dialog.tsx`
- `apps/dokploy/components/dashboard/application/domains/handle-domain.tsx`

### Domains (DB + router + connection checks)

- `packages/server/src/db/schema/domain.ts`
- `apps/dokploy/server/api/routers/domain.ts`
- `packages/server/src/services/domain-connection.ts`
- `apps/dokploy/components/dashboard/application/domains/domain-connection-panel.tsx`

### Mail (DB + router + UI)

- `packages/server/src/db/schema/hosted-domain.ts`
- `packages/server/src/services/hosted-domain/index.ts`
- `apps/dokploy/server/api/routers/mail.ts`
- `apps/dokploy/components/dashboard/emails/manage-emails.tsx`
- `apps/dokploy/components/dashboard/emails/mail-domains-list-card.tsx`
- `apps/dokploy/pages/dashboard/emails/[domainId].tsx`
- `apps/dokploy/components/dashboard/emails/mail-domain-page.tsx`
- `apps/dokploy/components/dashboard/emails/mail-mailboxes-card.tsx`

### Core services / data plane

- `docker/core-services/docker-compose.yml`
- `scripts/core-services-init.mjs`
- `packages/server/src/services/docker/bootstrap-core-services.ts`
- `packages/server/src/services/docker/core-services-reconcile.ts`
- `apps/dokploy/.docker/core-services/mail/roundcube-config/zz-dokploy-internal-tls.inc.php`

