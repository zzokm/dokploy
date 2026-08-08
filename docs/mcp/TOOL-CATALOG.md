# Operator MCP tool catalog

Stable error codes returned in tool JSON: `unauthorized`, `dns_missing`, `dns_mismatch`, `cert_failed`, `cert_pending`, `backend_down`, `cloudflare_unconfigured`, `zone_not_found`, `validation_error`, `not_found`, `timeout`, `internal`.

## Auth / health

| Tool | Purpose | Params | Common errors |
|------|---------|--------|---------------|
| `dokploy.ping` | API reachable + authenticated | — | `unauthorized` |
| `dokploy.whoami` | User/org identity (no secrets) | — | `unauthorized` |

Example: `dokploy.ping` → `{}`

## Cloudflare / DNS

| Tool | Purpose | Params | Common errors |
|------|---------|--------|---------------|
| `cloudflare.status` | Credential configured/healthy; `apiTokenLast4` only | — | — |
| `cloudflare.listZones` | Zones for org | — | `cloudflare_unconfigured` |
| `cloudflare.listDnsRecords` | Records in zone | `cfZoneId` | `zone_not_found` |
| `cloudflare.upsertDnsRecord` | Idempotent A/AAAA/CNAME/TXT/MX | `name`, `type`, `content`, optional `cfZoneId`, `proxied` (default false), `ttl`, `priority` | `cloudflare_unconfigured`, `zone_not_found` |
| `cloudflare.deleteDnsRecord` | Delete by CF ids | `cfZoneId`, `cfRecordId` | `not_found` |
| `dns.waitForResolution` | Poll until resolve [/ expected IP] | `host`, optional `expectedIp`, `timeoutMs`, `intervalMs` | `dns_missing`, `dns_mismatch`, `timeout` |

Example upsert:

```json
{
  "name": "app.example.com",
  "type": "A",
  "content": "23.94.107.153",
  "proxied": false
}
```

## Domains

| Tool | Purpose | Params | Common errors |
|------|---------|--------|---------------|
| `domain.list` | Bindings for app/compose | `applicationId` **or** `composeId` | `validation_error` |
| `domain.create` | Primitive create (**no DNS wait**) | host, domainType, ids, port, https… | Prefer `domain.provision` |
| `domain.update` | Update binding | `domainId` + fields | `not_found` |
| `domain.delete` | Remove binding | `domainId` | `not_found` |
| `domain.provision` | **Ordered** DNS→wait→domain→cert→health | see below | `dns_*`, `cloudflare_*`, `cert_failed` |

### `domain.provision` input

| Field | Required | Notes |
|-------|----------|-------|
| `host` | yes | FQDN |
| `domainType` | yes | `application` \| `compose` |
| `applicationId` | if application | |
| `composeId` | if compose | |
| `serviceName` | if compose | Traefik service name |
| `port` | no | default 3000 |
| `path` | no | default `/` |
| `https` | no | default true |
| `proxied` | no | **default false** (HTTP-01) |
| `targetIp` | no | else from server / web settings |
| `waitDnsTimeoutMs` | no | default 180000 |
| `skipHealthCheck` | no | |
| `dryRun` | no | stop after DNS wait |

## Certificates / Traefik

| Tool | Purpose | Params | Common errors |
|------|---------|--------|---------------|
| `cert.status` | issued/pending/failed/missing | `host` | — |
| `cert.retry` | Drop ACME entry + restart Traefik | `host` | — |
| `traefik.acmeErrors` | Recent ACME logs (redacted) | optional `host`, `tail` | — |

## Services

| Tool | Purpose | Params |
|------|---------|--------|
| `project.list` | Projects | — |
| `environment.list` | Environments | optional `projectId` |
| `application.list` | Applications | optional `environmentId` |
| `compose.list` | Compose services | optional `environmentId` |
| `service.status` | Status + last deploy | `applicationId` or `composeId` |
| `service.logs` | Tail logs (redacted) | `appName`, optional `tail`, `search`, `serverId` |
| `application.deploy` / `application.redeploy` / `application.reload` | Deploy/restart app | see schema |
| `compose.deploy` / `compose.redeploy` | Deploy compose | `composeId` |
| `url.health` | DNS + HTTPS class | `host`, optional `expectedIp`, `path` |
