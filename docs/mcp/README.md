# Dokploy Operator MCP

Operator-grade MCP tools for day-2 domains, Cloudflare DNS, Traefik/ACME, and service health on this Dokploy fork.

## Why this exists

Production failures on hosts like `hydro.hiy.me` / `jelly.hiy.me` were **not** app crashes: Dokploy attached Traefik routers and started Let's Encrypt **before** Cloudflare DNS existed. ACME saw **NXDOMAIN**; browsers got **ENOTFOUND**. Containers were healthy.

`domain.provision` makes that race **impossible by default**: DNS upsert → wait for resolution → attach domain → observe cert → HTTPS health.

## Docs in this folder

| Doc | Contents |
|-----|----------|
| [TOOL-CATALOG.md](./TOOL-CATALOG.md) | Tool names, params, examples, error codes |
| [DOMAIN-PROVISIONING.md](./DOMAIN-PROVISIONING.md) | Recommended HTTPS domain flow + proxied vs DNS-only |
| [AUTH.md](./AUTH.md) | Cursor / MCP client auth setup |
| [CHANGELOG.md](./CHANGELOG.md) | Why + what shipped |

## Package

Source: `packages/mcp` (`@dokploy/operator-mcp`)

```bash
corepack pnpm --filter @dokploy/operator-mcp build
```

Server API surface: `operator.*` tRPC / OpenAPI routes in the Dokploy app (also usable without MCP via `x-api-key`).
