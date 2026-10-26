# Recommended flow: HTTPS domain (Auto DNS)

## Prefer one tool

For application or compose domains, prefer **`domain.provision`**:

```json
{
  "tool": "domain.provision",
  "input": {
    "host": "app.example.com",
    "domainType": "compose",
    "composeId": "<composeId>",
    "serviceName": "web",
    "port": 3000,
    "autoPort": false,
    "path": "/",
    "internalPath": "/api",
    "stripPath": true,
    "customCertResolver": "letsencrypt-cloudflare",
    "customEntrypoint": "websecure",
    "middlewares": ["auth-middleware@file"],
    "https": true
  }
}
```

For the **primary Dokploy web server instance domain**, use either `domain.provision` with `"domainType": "server"` or `serverDomain.provision`:

```json
{
  "tool": "serverDomain.provision",
  "input": {
    "host": "dokploy.example.com",
    "https": true,
    "certificateType": "letsencrypt-cloudflare",
    "letsEncryptEmail": "ops@example.com"
  }
}
```

Or via `domain.provision`:

```json
{
  "tool": "domain.provision",
  "input": {
    "host": "dokploy.example.com",
    "domainType": "server",
    "https": true,
    "certificateType": "letsencrypt-cloudflare",
    "letsEncryptEmail": "ops@example.com"
  }
}
```

---

## What `domain.provision` does (in order)

1. **Resolve target IP**: Resolves public IP of server or cluster worker.
2. **Upsert DNS A record**: Idempotently creates or updates the DNS record via the integrated DNS provider (e.g. Cloudflare) with `proxied: true`.
3. **Wait for DNS propagation**: Continuously verifies that public DNS resolves to the target or proxy edge.
4. **Create / Update Dokploy domain**:
   - For `application` / `compose`: Creates or updates domain row, binds routing rules (`port`, `autoPort`, `internalPath`, `stripPath`, `customCertResolver`, `customEntrypoint`, `middlewares`), and configures Traefik dynamic labels.
   - For `server`: Updates `webServerSettings`, reconfigures Traefik's `dokploy-service-app` router with the resolver, and updates the `cloudflareDnsRecord` mirror.
5. **Observe ACME certificate**: Monitors Traefik ACME challenge verification until `issued`.
6. **HTTPS health check**: Verifies end-to-end TLS handshake and HTTP response.

Supports dry-run testing via `"dryRun": true`.

---

## Standalone DNS Provisioning (`dns.provision`)

When you only need to provision DNS ahead of time or for external services:

```json
{
  "tool": "dns.provision",
  "input": {
    "host": "api.example.com",
    "targetIp": "198.51.100.1",
    "recordType": "A",
    "ttl": 1,
    "waitForDns": true,
    "timeoutMs": 60000
  }
}
```

This will automatically:
1. Identify the parent zone from the hostname (e.g., `example.com`).
2. Create or update the A/AAAA/CNAME record with policy enforced (`proxied: true` for Cloudflare).
3. Poll public resolvers until the record propagates.

---

## Main Dokploy Server Domain Workflow

Dokploy stores the main instance domain in `webServerSettings`. Dedicated MCP tools are available:

| Tool | Purpose | Example Input |
|------|---------|---------------|
| `serverDomain.get` | Inspect current server domain, IP, HTTPS, and Cloudflare DNS status | `{}` |
| `serverDomain.previewDns` | Check matched CF zone, drift status, and remote record before applying | `{ "host": "dokploy.example.com" }` |
| `serverDomain.set` | Update server domain host and HTTPS in Dokploy settings & Traefik | `{ "host": "dokploy.example.com", "https": true }` |
| `serverDomain.applyDns` | Upsert Cloudflare DNS A-record to server IP & enable Traefik DNS-01 | `{ "host": "dokploy.example.com" }` |
| `serverDomain.provision` | Full end-to-end DNS + Traefik + ACME + Health check | `{ "host": "dokploy.example.com", "https": true }` |

---

## Cloudflare policy (locked)

| Mode | Behavior |
|------|----------|
| Cloudflare Auto DNS | **Always proxied** (`proxied: true`) + **DNS-01** (`letsencrypt-cloudflare`) |
| Other providers | HTTP-01 by default (`letsencrypt`) |

> [!NOTE]
> The Cloudflare DNS-01 resolver enables automatic SSL generation even behind Cloudflare Proxy without triggering HTTP challenge blocks.

---

## Full Domain Creation Options (`domain.create` & `domain.update`)

When you need granular control without auto-provisioning:

| Parameter | Type | Description |
|-----------|------|-------------|
| `host` | `string` | Fully-qualified domain name (e.g., `app.domain.com`) |
| `domainType` | `"application" \| "compose" \| "server"` | Workload type |
| `applicationId` / `composeId` | `string` | Target workload ID |
| `serviceName` | `string` | Service name (required for compose) |
| `port` | `number` | Internal target port |
| `autoPort` | `boolean` | Auto-detect container port from exposed ports |
| `path` | `string` | Host routing path (default: `/`) |
| `internalPath` | `string` | Path prefix forwarded to upstream service |
| `stripPath` | `boolean` | Strip the routing prefix before proxying |
| `customCertResolver` | `string` | Custom Traefik cert resolver (e.g. `letsencrypt-cloudflare`) |
| `customEntrypoint` | `string` | Custom Traefik entrypoint (e.g. `websecure`) |
| `middlewares` | `string[]` | Array of Traefik middleware names |
| `certificateType` | `"none" \| "letsencrypt" \| "letsencrypt-cloudflare"` | Certificate strategy |
| `https` | `boolean` | Enable HTTPS / redirect HTTP |
| `syncDns` | `boolean` | Synchronize Cloudflare DNS A-record automatically |

