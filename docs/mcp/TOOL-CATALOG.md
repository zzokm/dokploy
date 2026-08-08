# Operator MCP tool catalog

Stable error codes: `unauthorized`, `dns_missing`, `dns_mismatch`, `cert_failed`, `cert_pending`, `backend_down`, `cloudflare_unconfigured`, `dns_provider_unconfigured`, `dns_rate_limited`, `dns_proxy_policy`, `zone_not_found`, `validation_error`, `not_found`, `timeout`, `internal`.

## Auth / health

| Tool | Purpose |
|------|---------|
| `dokploy.ping` | API reachable + authenticated |
| `dokploy.whoami` | User/org identity (no secrets) |

## DNS (preferred) + Cloudflare aliases

| Preferred | Alias (deprecated) | Purpose |
|-----------|--------------------|---------|
| `dns.status` | `cloudflare.status` | Credential status; last4 only |
| `dns.listZones` | `cloudflare.listZones` | List zones |
| `dns.listRecords` | `cloudflare.listDnsRecords` | List records (`dnsZoneId` or `cfZoneId`) |
| `dns.upsertRecord` | `cloudflare.upsertDnsRecord` | Upsert; **CF always proxied=true** |
| `dns.deleteRecord` | `cloudflare.deleteDnsRecord` | Delete |
| `dns.waitForResolution` | — | Poll until resolve |

## Domains

| Tool | Purpose |
|------|---------|
| `domain.list` / `domain.create` / `domain.update` / `domain.delete` | Primitives |
| `domain.provision` | **Ordered** DNS→wait→domain→cert→health |

### `domain.provision`

Cloudflare Auto DNS **always** forces `proxied=true` + DNS-01 (`letsencrypt-cloudflare`). The `proxied` input is ignored for CF.

```json
{
  "host": "app.example.com",
  "domainType": "compose",
  "composeId": "...",
  "serviceName": "web",
  "port": 3000,
  "https": true
}
```

Never returns raw secrets. See `docs/dns/` for ACME and provider scopes.
