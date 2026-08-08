# Recommended flow: add an HTTPS domain (Cloudflare + Dokploy)

## Prefer one tool

```json
{
  "tool": "domain.provision",
  "input": {
    "host": "app.example.com",
    "domainType": "compose",
    "composeId": "<composeId>",
    "serviceName": "web",
    "port": 3000,
    "https": true,
    "proxied": false
  }
}
```

For applications, use `"domainType": "application"` + `applicationId` (no `serviceName`).

### What it does (in order)

1. Resolve target IP (service server IP or `targetIp`)
2. **Upsert** Cloudflare A record (idempotent)
3. **Wait** until public DNS resolves (exact IP match when DNS-only)
4. Create/update Dokploy domain binding + Traefik labels
5. Observe ACME certificate status
6. HTTPS health check (`ok` / `dns_missing` / `cert_error` / `backend_down`)

Dry-run (DNS only): `"dryRun": true`.

## Proxied vs DNS-only (important)

| Mode | `proxied` | ACME challenge | Traefik resolver |
|------|-----------|----------------|------------------|
| **DNS-only (default)** | `false` | **HTTP-01** | `letsencrypt` |
| Orange-cloud | `true` | **DNS-01** | `letsencrypt-cloudflare` (needs CF token in Traefik) |

This fork’s Traefik config:

- `letsencrypt` → HTTP-01 on entrypoint `web` (requires DNS pointing at the VPS, **not** Cloudflare proxied)
- `letsencrypt-cloudflare` → DNS-01 via `CF_DNS_API_TOKEN`

**Default for `domain.provision` is DNS-only** so HTTP-01 works without extra Traefik token wiring. Set `proxied: true` only when you intentionally terminate TLS at Cloudflare / use DNS-01.

## Primitive fallback (manual)

Only if you cannot use `domain.provision`:

1. `cloudflare.status` — confirm credential healthy
2. `cloudflare.listZones`
3. `cloudflare.upsertDnsRecord` — A → VPS IP, `proxied: false`
4. `dns.waitForResolution` — `expectedIp` = VPS IP
5. `domain.create` / compose redeploy as needed
6. `cert.status` → if failed after DNS fix, `cert.retry`
7. `url.health`

Calling `domain.create` **before** DNS is what caused NXDOMAIN ACME failures historically — avoid it.

## After DNS was fixed late

If a domain already failed ACME:

1. Confirm DNS: `dns.waitForResolution` / `url.health`
2. `cert.retry` with the hostname
3. Re-check `cert.status` and `url.health`
