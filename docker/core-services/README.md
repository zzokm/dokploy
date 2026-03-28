# Core services (BIND + optional mail stack)

This compose file brings up the **data-plane** containers referenced by the Domains / Emails settings (`internetsystemsconsortium/bind9`, `dovecot/dovecot`, `exim/exim4`, `roundcube/roundcubemail`). The control plane only **writes files** and calls **Docker** (e.g. `rndc reload`); it does not vendor GPL upstream sources.

## Prerequisites

- Docker Engine / Docker Desktop with Compose v2
- Repo root: run scripts so paths resolve (`docker/core-services/docker-compose.yml` uses paths relative to this file)

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
