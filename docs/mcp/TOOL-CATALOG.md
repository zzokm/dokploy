# Operator MCP Tool Catalog

Stable error codes: `unauthorized`, `dns_missing`, `dns_mismatch`, `cert_failed`, `cert_pending`, `backend_down`, `cloudflare_unconfigured`, `dns_provider_unconfigured`, `dns_rate_limited`, `dns_proxy_policy`, `zone_not_found`, `validation_error`, `not_found`, `timeout`, `internal`.

## Auth & Health

| Tool | Purpose |
|------|---------|
| `dokploy.ping` | Check API reachability and valid API key authentication. |
| `dokploy.whoami` | Return active user ID, email, role, and organization ID (no secrets). |

## DNS & Multi-Provider Automation

Dokploy supports generalized DNS provider automation across all supported upstream providers: **Cloudflare**, **AWS Route53**, **Porkbun**, **Infomaniak**, and **OVH**. The unified management interface is located at `/dashboard/settings/dns` (with tabbed access to DNS Providers and All Domains).

| Tool | Purpose |
|------|---------|
| `dns.status` | Safe credential and connectivity status for configured DNS providers (last 4 characters only). |
| `dns.listZones` | List all DNS zones across configured DNS providers (`dnsProvider` table and mirrored zones). |
| `dns.listRecords` | List DNS records within a zone across configured providers (`dnsZoneId`). |
| `dns.upsertRecord` | Idempotent create/update of DNS records (A/AAAA/CNAME/TXT/MX). Proxying supported when Cloudflare provider is used. |
| `dns.deleteRecord` | Delete a DNS record by zone and record ID across any supported provider. |
| `dns.waitForResolution` | Poll public DNS until hostname resolves to expected IP or anycast address. |
| `dns.provision` | Auto-match zone from FQDN or explicit provider/zone, upsert A/CNAME record, and verify DNS propagation in one call. |

## Domains (Application & Compose)

Manage application, compose, and server domains. All domains are cataloged under the unified `/dashboard/settings/dns?tab=domains` dashboard.

| Tool | Purpose |
|------|---------|
| `domain.list` | List domain bindings for an application, compose stack, or server (`includeServerDomain: true`). |
| `domain.get` | Retrieve detailed domain configuration by `domainId` (or `'server'`) or by `host`. |
| `domain.create` | Full domain creation primitive supporting advanced routing: `port`, `autoPort`, `path`, `internalPath`, `stripPath`, `customCertResolver`, `useCustomEntrypoint`, `customEntrypoint`, `middlewares`, `certificateType`, `https`, and `dnsProvider` (`cloudflare`, `route53`, `porkbun`, `infomaniak`, `ovh`, `digitalocean`, `hetzner`, `gcloud`). Also supports `domainType: "server"`. |
| `domain.update` | Update any domain configuration property or routing rule on an existing domain. |
| `domain.delete` | Delete a domain routing rule (or reset server domain when `domainId: "server"`). |
| `domain.provision` | **Ordered, zero-downtime provision workflow**: DNS upsert → resolution wait → domain attachment → certificate observation → HTTPS health check. Prevents NXDOMAIN and ACME failure races across all supported DNS providers. |

## Main Dokploy Instance (Server Domain)

Manage the primary Dokploy web dashboard domain and its DNS provider records:

| Tool | Purpose |
|------|---------|
| `serverDomain.get` | Get current web server domain settings (`host`, `serverIp`, `https`, `certificateType`, `letsEncryptEmail`) and live DNS preview. |
| `serverDomain.set` | Assign or update the main Dokploy domain, configure HTTPS, and update Server Traefik router. |
| `serverDomain.previewDns` | Preview DNS target IP, matched zone, drift status, and current remote record across configured DNS providers for the server domain. |
| `serverDomain.applyDns` | Synchronize DNS A-record to the server IP and configure Traefik for ACME (`letsencrypt-cloudflare` or `letsencrypt`). |
| `serverDomain.provision` | Complete automated provisioning of the main Dokploy domain: upserts DNS, waits for resolution, assigns server settings, applies Traefik rules, observes Let's Encrypt certificate, and runs an HTTPS health probe. |

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
