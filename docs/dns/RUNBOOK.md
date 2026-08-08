# Auto DNS runbook

## Bad token

- UI/MCP returns validation error; last4 unchanged.
- Re-connect with a scoped token (see PROVIDERS.md).

## Zone missing

- Sync zones after connecting.
- Confirm hostname is under an imported zone (longest-suffix match).

## Cert pending / failed (Cloudflare)

- Confirm Traefik has `CF_DNS_API_TOKEN`.
- Confirm token can create TXT `_acme-challenge`.
- Confirm domain uses `letsencrypt-cloudflare` (DNS-01), not HTTP-01.

## Rate limit

- Operator code `dns_rate_limited` / provider 429 — backoff and retry.

## DNS before domain

- Prefer `domain.provision` (MCP) or UI enable flows that upsert DNS before attaching Traefik routers to avoid NXDOMAIN races.
