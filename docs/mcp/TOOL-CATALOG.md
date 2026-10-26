# Operator MCP Tool Catalog

Stable error codes: `unauthorized`, `dns_missing`, `dns_mismatch`, `cert_failed`, `cert_pending`, `backend_down`, `cloudflare_unconfigured`, `dns_provider_unconfigured`, `dns_rate_limited`, `dns_proxy_policy`, `zone_not_found`, `validation_error`, `not_found`, `timeout`, `internal`.

## Auth & Health

| Tool | Purpose |
|------|---------|
| `dokploy.ping` | Check API reachability and valid API key authentication. |
| `dokploy.whoami` | Return active user ID, email, role, and organization ID (no secrets). |

## DNS & Cloudflare Automation

| Preferred Tool | Alias (Deprecated) | Purpose |
|----------------|--------------------|---------|
| `dns.status` | `cloudflare.status` | Credential status for the active organization (last 4 characters only). |
| `dns.listZones` | `cloudflare.listZones` | List all DNS zones synchronized from the DNS provider. |
| `dns.listRecords` | `cloudflare.listDnsRecords` | List DNS records within a zone (`dnsZoneId` or `cfZoneId`). |
| `dns.upsertRecord` | `cloudflare.upsertDnsRecord` | Idempotent create/update of DNS records. Cloudflare policy forces `proxied: true`. |
| `dns.deleteRecord` | `cloudflare.deleteDnsRecord` | Delete a DNS record by zone and record ID. |
| `dns.waitForResolution` | — | Poll public DNS until hostname resolves to expected IP or anycast address. |
| `dns.provision` | — | Auto-match zone from FQDN, upsert A/CNAME record with proxy policy, and verify DNS propagation in one call. |

## Domains (Application & Compose)

| Tool | Purpose |
|------|---------|
| `domain.list` | List domain bindings for an application, compose stack, or server (`includeServerDomain: true`). |
| `domain.get` | Retrieve detailed domain configuration by `domainId` (or `'server'`) or by `host`. |
| `domain.create` | Full domain creation primitive supporting advanced routing: `port`, `autoPort`, `path`, `internalPath`, `stripPath`, `customCertResolver`, `useCustomEntrypoint`, `customEntrypoint`, `middlewares`, `certificateType`, `https`, and `dnsProvider`. Also supports `domainType: "server"`. |
| `domain.update` | Update any domain configuration property or routing rule on an existing domain. |
| `domain.delete` | Delete a domain routing rule (or reset server domain when `domainId: "server"`). |
| `domain.provision` | **Ordered, zero-downtime provision workflow**: DNS upsert → resolution wait → domain attachment → certificate observation → HTTPS health check. Prevents NXDOMAIN and ACME failure races. |

## Main Dokploy Instance (Server Domain)

Manage the primary Dokploy web dashboard domain and its Cloudflare DNS:

| Tool | Purpose |
|------|---------|
| `serverDomain.get` | Get current web server domain settings (`host`, `serverIp`, `https`, `certificateType`, `letsEncryptEmail`) and live Cloudflare DNS status. |
| `serverDomain.set` | Assign or update the main Dokploy domain, configure HTTPS, and update Server Traefik router. |
| `serverDomain.previewDns` | Preview Cloudflare DNS target IP, matched zone, drift status, and current remote record for the server domain. |
| `serverDomain.applyDns` | Synchronize Cloudflare DNS A-record to the server IP and configure Traefik for DNS-01 (`letsencrypt-cloudflare`). |
| `serverDomain.provision` | Complete automated provisioning of the main Dokploy domain: upserts Cloudflare DNS, waits for resolution, assigns server settings, applies Traefik rules, observes Let's Encrypt certificate, and runs an HTTPS health probe. |

## Certificates & Traefik Diagnostics

| Tool | Purpose |
|------|---------|
| `cert.status` | Check ACME certificate status (`issued`, `pending`, `failed`, `missing`) and Traefik error details. |
| `cert.retry` | Purge stored certificate cache and trigger Traefik ACME renewal for a host. |
| `traefik.acmeErrors` | Stream recent Traefik ACME logs for a hostname with automatic secret redaction. |

## Workloads & Deployments

| Tool | Purpose |
|------|---------|
| `project.list` | List all projects in the active organization. |
| `environment.list` | List environments (optionally filter by `projectId`). |
| `application.list` | List applications (optionally filter by `environmentId`). |
| `compose.list` | List compose stacks (optionally filter by `environmentId`). |
| `service.status` | Check operational and deployment status for an application or compose service. |
| `service.logs` | Tail live container logs with automatic secret redaction. |
| `application.deploy` / `application.redeploy` / `application.reload` | Deploy, redeploy, or restart an application. |
| `compose.deploy` / `compose.redeploy` | Deploy or redeploy a docker compose stack. |
| `url.health` | Public HTTPS reachability check with error categorization (`ok`, `dns_missing`, `cert_error`, `backend_down`). |
