# @dokploy/operator-mcp

Operator-grade MCP server for this Dokploy fork. Prefer **`domain.provision`** over raw `domain.create` so DNS exists before Traefik/ACME.

## Core Capabilities

- **Zero-Downtime Domain Provisioning (`domain.provision`)**: DNS upsert → propagation wait → Traefik routing → ACME cert observation → HTTPS health verification. Prevents NXDOMAIN and TLS failure races.
- **Full Domain Routing (`domain.create` & `domain.update`)**: Supports `port`, `autoPort`, `path`, `internalPath`, `stripPath`, `customCertResolver`, `customEntrypoint`, `middlewares`, `certificateType`, and `syncDns`.
- **Integrated Cloudflare DNS Provisioning (`dns.provision`)**: Automatically identifies parent zone from FQDN, creates/updates proxied DNS records, and confirms propagation.
- **Main Dokploy Instance (Server Domain) Lifecycle**: Complete automation for the primary Dokploy dashboard domain via `serverDomain.get`, `serverDomain.set`, `serverDomain.previewDns`, `serverDomain.applyDns`, and `serverDomain.provision`.

## Auth

```json
{
  "mcpServers": {
    "dokploy-operator": {
      "command": "node",
      "args": ["d:/Yehias Uni files/dokploy/packages/mcp/dist/index.js"],
      "env": {
        "DOKPLOY_URL": "https://dokploy.hiy.me",
        "DOKPLOY_API_KEY": "<api-key-from-dokploy-settings>"
      }
    }
  }
}
```

Or after `corepack pnpm --filter @dokploy/operator-mcp build`, use the `dokploy-operator-mcp` bin.

Env:
- `DOKPLOY_URL` — instance origin (no trailing `/api`)
- `DOKPLOY_API_KEY` — Settings → Profile → API Keys (`x-api-key`)
- `DOKPLOY_TIMEOUT` — optional ms (default 120000 for DNS waits)

Never put Cloudflare tokens in MCP env — Dokploy stores them sealed server-side.

## Build

```bash
corepack pnpm --filter @dokploy/operator-mcp build
```

See `docs/mcp/` for:
- [TOOL-CATALOG.md](../../docs/mcp/TOOL-CATALOG.md) — Comprehensive tool list, inputs, examples, and error codes
- [DOMAIN-PROVISIONING.md](../../docs/mcp/DOMAIN-PROVISIONING.md) — Zero-downtime domain & DNS provisioning guide
- [AUTH.md](../../docs/mcp/AUTH.md) — Authentication setup guide

