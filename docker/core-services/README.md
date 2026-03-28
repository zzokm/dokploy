# Core services (BIND + optional mail stack)

This compose file brings up the **data-plane** containers referenced by the Domains / Emails settings (`internetsystemsconsortium/bind9`, `dovecot/dovecot`, `exim/exim4`, `roundcube/roundcubemail`). The control plane only **writes files** and calls **Docker** (e.g. `rndc reload`); it does not vendor GPL upstream sources.

## Prerequisites

- Docker Engine / Docker Desktop with Compose v2
- Repo root: run scripts so paths resolve (`docker/core-services/docker-compose.yml` uses paths relative to this file)

## Local development (recommended)

Bring up the data plane **before** or **with** the Next.js dev server so the panel’s Docker health checks find `core-services-bind`, `core-services-exim`, `core-services-dovecot`, and `core-services-roundcube` (same names as `serverPaths()` / deploy).

| Goal | Command (repo root) |
| ---- | --------------------- |
| Full app + BIND + mail stack | `pnpm dokploy:dev:data-plane` |
| One-shot DB/redis setup + mail stack | `pnpm dokploy:setup:with-data-plane` |
| Data plane only | `pnpm core-services:up:mail` (or `pnpm core-services:up` for DNS only) |

From `apps/dokploy`, use `pnpm dev:data-plane` for the same “stack then dev” flow.

**Dev Container:** `.devcontainer/devcontainer.json` runs `pnpm core-services:up:mail` on **postStart** (Docker-in-Docker), and forwards host ports **5353** (DNS), **3025/3587** (SMTP/submission), **3143/3993** (IMAP/IMAPS), **3080** (Roundcube HTTP) so the UI and CLI tests match the compose mappings below.

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

This runs `scripts/core-services-init.mjs` (creates `apps/dokploy/.docker/core-services/...`, copies `named.conf` template) and starts **`core-services-bind`** on host port **5353** → container **53** (avoids conflicting with host DNS on port 53).

### Apply DNS from the UI

After **Apply DNS**, test with:

```bash
dig @127.0.0.1 -p 5353 +short NS example.com
```

(Replace `example.com` with your zone.)

### Environment (optional)

Add to `apps/dokploy/.env` if you change mounts:

| Variable | Purpose |
| -------- | ------- |
| `PANEL_BIND_ZONE_FILE_ROOT` | Path inside BIND for zone `file` directives (default `/etc/bind`). Must match the compose mount. |
| `PANEL_SKIP_RNDC_RELOAD` | Set to `true` to write zones only (debug). |
| `PANEL_INFRA_BIND_DNS_PORT` | Host port mapped to BIND **53** (default `5353`). |
| `PANEL_CORE_SERVICES_NETWORK` | Docker network name for the stack (default `dokploy-network`, aligned with `mailNetworkName` in server-paths). |

Default **host → container** ports (avoid clashing with system DNS on 53 and local mail daemons): **5353→53**, **3025→25**, **3587→587**, **3143→143**, **3993→993**, **3080→80**.

## Mail profile (Dovecot + Exim + Roundcube)

```bash
pnpm core-services:up:mail
```

Uses Compose **`--profile mail`**. Images are started with **stock** configuration; volumes mount the same paths the panel writes under `apps/dokploy/.docker/core-services/mail/*`. You must align Dovecot/Exim **passdb** / router config with the generated `passwd` / `virtual` files (see runbook / image docs). Roundcube uses SQLite on a named volume path.

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

- **No** Exim/BIND/Roundcube **source** in the Dokploy app; only orchestration and generated text files.
- Third-party **image names** are listed in `packages/server/src/utils/docker/core-services.ts` and `THIRD_PARTY_LICENSES.md`.
