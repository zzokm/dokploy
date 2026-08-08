# Auto DNS architecture

## Layout

```
packages/server/src/services/dns/
  types.ts              # DnsProviderAdapter + capabilities
  registry.ts           # provider id → adapter
  credentials.ts        # sealed vault CRUD + dual-read CF settings
  orchestration.ts      # register adapters, ACME helper
  traefik-dns-env.ts    # env key map
  ensure-traefik-dns-token.ts
  adapters/             # cloudflare, digitalocean, hetzner, route53, gcloud
```

## Capability flags

Each adapter declares `forcesProxy`, `requiresDns01WhenManaged`, `legoProvider`, `traefikResolverName`, etc.

## Schema

- `dns_provider_credential` — sealed secrets (preferred)
- `dns_zone` / `dns_record` — generic mirrors
- `domain.dns_*` columns — additive; `cf_*` kept for dual-write

## Orchestration

Call adapters through the registry. Prefer `ensureTraefikDnsProviderToken` for DNS-01 env injection; Cloudflare still has a legacy fallback on `cloudflare_settings`.
