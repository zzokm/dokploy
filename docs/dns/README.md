# Dokploy Auto DNS

Provider-agnostic DNS automation for Dokploy.

## Docs

| Doc | Audience |
|---|---|
| [CONCEPTS.md](./CONCEPTS.md) | Operators + contributors |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Contributors |
| [ACME.md](./ACME.md) | Operators (HTTP-01 vs DNS-01) |
| [PROVIDERS.md](./PROVIDERS.md) | Token scopes per provider |
| [SECURITY.md](./SECURITY.md) | Sealed credentials, redaction |
| [RUNBOOK.md](./RUNBOOK.md) | Ops troubleshooting |

## Quick rules

- Product surface is **Auto DNS**, not Cloudflare.
- Cloudflare adapter always upserts with `proxied: true` and requires DNS-01.
- Non-proxy providers (DigitalOcean, Hetzner, …) default to HTTP-01.
- Credentials are sealed at rest (`sealString`); APIs/MCP return last4 only.
- Provision ordering: upsert DNS → wait resolve → attach domain → ACME → health.
