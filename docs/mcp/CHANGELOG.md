# Changelog — Operator MCP / domain DNS race

## 2026-10-26 — Upstream v0.30.10 Merge & Full Domain/DNS/Server Domain MCP Suite

### Upstream Sync
- Merged upstream Dokploy latest stable release **`v0.30.10`** (`073713f0b863eca4285ad24db00550af1b39397a`) cleanly into `feat/infrastructure-panel`.
- Resolved monorepo relation typing discrepancies in `project.ts` and Zod v4 resolver typings.

### Full Domain Creation & Configuration
- **Advanced routing options in `domain.create` & `domain.update`**: Added `port`, `autoPort`, `path`, `internalPath`, `stripPath`, `customCertResolver`, `customEntrypoint`, `middlewares`, `certificateType`, `https`, `provider`, and optional `syncDns`.
- **Domain Inspection**: Added `domain.get` tool supporting lookup by `domainId` or `host`.
- **Multi-domain list**: Upgraded `domain.list` to support `includeServerDomain: true`.

### Integrated Cloudflare DNS Provisioning
- **`dns.provision`**: One-call DNS automation that auto-detects zone from FQDN, upserts A/AAAA/CNAME record with `proxied: true` enforced, and verifies public propagation.

### Main Dokploy Instance (Server Domain) Support
- **First-class server domain lifecycle**:
  - `serverDomain.get`: Inspect active web server host, server IP, HTTPS setting, certificate resolver, and Cloudflare DNS status.
  - `serverDomain.previewDns`: Preview Cloudflare DNS drift, remote record, and target server IP before making changes.
  - `serverDomain.set`: Assign host, configure HTTPS, and update the main Dokploy Traefik router (`dokploy-service-app`).
  - `serverDomain.applyDns`: Sync Cloudflare DNS A-record and configure Traefik DNS-01 (`letsencrypt-cloudflare`).
  - `serverDomain.provision`: Complete zero-downtime provisioning (DNS upsert -> resolution wait -> server assignment -> Traefik reload -> ACME observation -> HTTPS health check).
  - `domain.provision`: Also supports `domainType: "server"` seamlessly.


- Prefer `dns.*` tools; keep `cloudflare.*` as aliases
- Cloudflare Auto DNS always forces proxied + DNS-01 in upsert/provision
- Docs aligned with `docs/dns/`

## 2026-08-08 — Operator MCP + `domain.provision`

### Why

When attaching domains such as `hydro.hiy.me` and `jelly.hiy.me`, Dokploy created Traefik routers and started Let's Encrypt **before** Cloudflare DNS records existed. ACME failed with **NXDOMAIN**; clients saw **ENOTFOUND**. Containers were healthy — the failure mode was **DNS + cert ordering**, not the application.

The stock `@dokploy/mcp` package also lacked first-class Cloudflare zone/DNS tools for this fork and made auth failures opaque.

### What shipped

- Server `operator.*` API: Cloudflare status/zones/DNS upsert/delete, DNS wait, domain CRUD, **`domainProvision`**, cert status/retry, Traefik ACME errors, project/app/compose listing, service status/logs, URL health
- Stable error codes: `dns_missing`, `dns_mismatch`, `cert_failed`, `backend_down`, `unauthorized`, …
- Curated MCP package `@dokploy/operator-mcp` (`packages/mcp`) with opinionated tool names
- Docs under `docs/mcp/` (catalog, auth, provisioning guide)
- Cloudflare Auto DNS: always proxied + DNS-01

### Race prevention

`domain.provision` / `operator.domainProvision` **always** upserts DNS and waits for public resolution **before** creating the Dokploy/Traefik domain binding.
