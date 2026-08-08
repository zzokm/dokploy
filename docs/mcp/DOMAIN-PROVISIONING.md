# Recommended flow: HTTPS domain (Auto DNS)

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
    "https": true
  }
}
```

### What it does (in order)

1. Resolve target IP
2. **Upsert** DNS A record (idempotent)
3. **Wait** until public DNS resolves
4. Create/update Dokploy domain + Traefik labels
5. Observe ACME certificate status
6. HTTPS health check

Dry-run: `"dryRun": true`.

## Cloudflare policy (locked)

| Mode | Behavior |
|------|----------|
| Cloudflare Auto DNS | **Always proxied** + **DNS-01** (`letsencrypt-cloudflare`) |
| Other providers | HTTP-01 by default |

Do not pass `proxied: false` expecting DNS-only CF — the adapter coerces to proxied.

## MCP DNS tools

Prefer `dns.status`, `dns.listZones`, `dns.upsertRecord`, `dns.waitForResolution`.  
`cloudflare.*` names remain as aliases.
