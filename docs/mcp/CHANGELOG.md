# Changelog — Operator MCP / domain DNS race

## 2026-08-08 — Operator MCP + `domain.provision`

### Why

When attaching domains such as `hydro.hiy.me` and `jelly.hiy.me`, Dokploy created Traefik routers and started Let's Encrypt **before** Cloudflare DNS records existed. ACME failed with **NXDOMAIN**; clients saw **ENOTFOUND**. Containers were healthy — the failure mode was **DNS + cert ordering**, not the application.

The stock `@dokploy/mcp` package also lacked first-class Cloudflare zone/DNS tools for this fork and made auth failures opaque.

### What shipped

- Server `operator.*` API: Cloudflare status/zones/DNS upsert/delete, DNS wait, domain CRUD, **`domainProvision`**, cert status/retry, Traefik ACME errors, project/app/compose listing, service status/logs, URL health
- Stable error codes: `dns_missing`, `dns_mismatch`, `cert_failed`, `backend_down`, `unauthorized`, …
- Curated MCP package `@dokploy/operator-mcp` (`packages/mcp`) with opinionated tool names
- Docs under `docs/mcp/` (catalog, auth, provisioning guide)
- Default **DNS-only** (`proxied: false`) so Traefik **HTTP-01** works; document DNS-01 path for orange-cloud

### Race prevention

`domain.provision` / `operator.domainProvision` **always** upserts Cloudflare DNS and waits for public resolution **before** creating the Dokploy/Traefik domain binding. That ordering is the product fix for the NXDOMAIN-before-DNS failure mode.
