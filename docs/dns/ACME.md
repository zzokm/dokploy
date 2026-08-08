# ACME and Auto DNS

| Mode | When | Traefik resolver |
|---|---|---|
| HTTP-01 | DNS-only providers (DO, Hetzner, R53 A/AAAA to origin) | `letsencrypt` |
| DNS-01 | **All Cloudflare Auto DNS** (always proxied); optional later for other providers | `letsencrypt-cloudflare` (+ future `letsencrypt-<provider>`) |

## Cloudflare

Orange-cloud proxy terminates TLS at Cloudflare. Let’s Encrypt HTTP-01 against Traefik-on-origin is unreliable. Therefore CF managed domains always:

1. Upsert with `proxied: true`
2. Set `customCertResolver = letsencrypt-cloudflare`
3. Inject `CF_DNS_API_TOKEN` into Traefik

Token must allow Zone DNS Edit for ACME TXT records.

## Other providers

Default HTTP-01. Optional DNS-01 env injection exists for DO (`DO_AUTH_TOKEN`) and Hetzner (`HETZNER_API_KEY`) when `forceDns01` is set.
