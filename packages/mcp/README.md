# @dokploy/operator-mcp

Operator-grade MCP server for this Dokploy fork. Prefer **`domain.provision`** over raw `domain.create` so DNS exists before Traefik/ACME.

## Auth

```json
{
  "mcpServers": {
    "dokploy-operator": {
      "command": "node",
      "args": ["D:/Yehia Uni/vpsredo/dokploy/packages/mcp/dist/index.js"],
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

See `docs/mcp/` for the full tool catalog and domain provisioning guide.
