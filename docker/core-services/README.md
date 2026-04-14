# Core services (BIND + optional mail stack)

This compose file brings up the **data-plane** containers referenced by the Domains / Emails settings (`internetsystemsconsortium/bind9`, `mailserver/docker-mailserver`, `roundcube/roundcubemail`). The control plane only **writes files** and calls **Docker** (e.g. `rndc reload`, `docker exec` for the mail `setup` CLI); it does not vendor upstream mail or BIND source.

## Prerequisites

- Docker Engine / Docker Desktop with Compose v2
- Repo root: run scripts so paths resolve (`docker/core-services/docker-compose.yml` uses paths relative to this file)

## Local development (recommended)

Bring up the data plane **before** or **with** the Next.js dev server so the panel’s Docker health checks find `core-services-bind`, `dokploy-mailserver` (or `PANEL_MAILSERVER_CONTAINER`), and `core-services-roundcube` (aligned with `serverPaths()` / programmatic deploy).

| Goal | Command (repo root) |
| ---- | --------------------- |
| Full app + BIND + mail stack | `pnpm dokploy:dev:data-plane` |
| One-shot DB/redis setup + mail stack | `pnpm dokploy:setup:with-data-plane` |
| Data plane only | `pnpm core-services:up:mail` (or `pnpm core-services:up` for DNS only) |

From `apps/dokploy`, use `pnpm dev:data-plane` for the same “stack then dev” flow.

**Dev Container:** `.devcontainer/devcontainer.json` runs `pnpm core-services:up:mail` on **postStart** (Docker-in-Docker), and forwards host ports **1053** (DNS), **3025/3587/3465** (SMTP/submission/SMTPS), **3143/3993** (IMAP/IMAPS), **3080** (Roundcube HTTP) so the UI and CLI tests match the compose mappings below.

**VS Code:** Run task **Dokploy: Core services (data plane — BIND + mail)** or **Dokploy: Full stack** (includes setup → switch server → data plane → dev).

## Quick start (DNS only — fixes “no such container: core-services-bind”)

From the **repository root**:

```bash
pnpm core-services:up
```

Or from `apps/dokploy`:

```bash
pnpm core-services:up
```

This runs `scripts/core-services-init.mjs` (creates `apps/dokploy/.docker/core-services/...`, copies `named.conf` template) and starts **`core-services-bind`** on host port **1053** → container **53** (avoids privileged 53 and mDNS **5353**, which is often busy on Windows/macOS).

### Apply DNS from the UI

After **Apply DNS**, test with:

```bash
dig @127.0.0.1 -p 1053 +short NS example.com
```

(Replace `example.com` with your zone.)

### Environment (optional)

Add to `apps/dokploy/.env` if you change mounts:

| Variable | Purpose |
| -------- | ------- |
| `PANEL_BIND_ZONE_FILE_ROOT` | Path inside BIND for zone `file` directives (default `/etc/bind`). Must match the compose mount. |
| `PANEL_SKIP_RNDC_RELOAD` | Set to `true` to write zones only (debug). |
| `PANEL_INFRA_BIND_DNS_PORT` | Host port mapped to BIND **53** (default `1053`; avoid **5353** — mDNS). |
| `PANEL_CORE_SERVICES_NETWORK` | Docker network name for the stack (default `dokploy-network`, aligned with `mailNetworkName` in server-paths). The compose file uses this network as **external** (it is created by `pnpm dokploy:setup` or by `scripts/core-services-init.mjs` before `compose up`). |
| `PANEL_MAILSERVER_CONTAINER` | Mail container name (default `dokploy-mailserver`). |
| `PANEL_DMS_OVERRIDE_HOSTNAME` / `PANEL_DMS_POSTMASTER_ADDRESS` | docker-mailserver identity (see image docs). |

Default **host → container** ports (avoid clashing with system DNS on 53, mDNS on 5353, and local mail daemons): **1053→53**, **3025→25**, **3587→587**, **3465→465**, **3143→143**, **3993→993**, **3080→80**. Roundcube uses **STARTTLS** to the mail container on **143** (IMAP) and **587** (SMTP) on the Docker network.

**`SSL_TYPE=manual`:** Host files `mail/dms-config/ssl/cert.pem` and `key.pem` are mounted at `/tmp/docker-mailserver/ssl/`; compose sets `SSL_CERT_PATH` and `SSL_KEY_PATH` to those in-container paths (required by docker-mailserver). The panel’s programmatic deploy creates a short-lived self-signed pair if missing; for compose-only, generate once with `openssl req` (see `bootstrap-core-services.ts`) or use **Deploy core services** from the UI.

## Mail profile (docker-mailserver + Roundcube)

```bash
pnpm core-services:up:mail
```

Uses Compose **`--profile mail`**. Volumes mount the same paths the panel writes under `apps/dokploy/.docker/core-services/mail/*`. Accounts and aliases are provisioned via the container **`setup`** CLI from the control plane, not flat `passwd` files. Roundcube uses SQLite on a host-mounted path.

## Stop

```bash
pnpm core-services:down
```

Brings down all services defined in the project (including the `mail` profile).

## Logs

```bash
pnpm core-services:logs:bind
```

## Legal / architecture

- **No** BIND/Roundcube/docker-mailserver **source** in the Dokploy app; only orchestration and generated text files.
- Third-party **image names** are listed in `packages/server/src/utils/docker/core-services.ts` and `THIRD_PARTY_LICENSES.md`.

For architecture notes and optional **Rspamd / ClamAV** toggles inside the image, see [docs/mail-architecture.md](../../docs/mail-architecture.md).
