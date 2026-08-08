# MCP auth setup

## Credentials

| Env | Required | Notes |
|-----|----------|--------|
| `DOKPLOY_URL` | yes | Origin only, e.g. `https://dokploy.hiy.me` (no `/api` suffix) |
| `DOKPLOY_API_KEY` | yes | Dokploy → Settings → Profile → API Keys |
| `DOKPLOY_TIMEOUT` | no | ms; default `120000` (DNS waits can be slow) |

Auth header sent by the MCP client: `x-api-key: <DOKPLOY_API_KEY>`.

**Do not** put Cloudflare API tokens, DB passwords, or `DOKPLOY_ENCRYPTION_KEY` in MCP env. Cloudflare is configured once in the Dokploy UI; the operator tools use the sealed org credential server-side and only return `apiTokenLast4`.

## Cursor (`mcp.json`)

Prefer the operator MCP (curated tools + `domain.provision`) over the stock `@dokploy/mcp` 500-tool dump:

```json
{
  "mcpServers": {
    "dokploy-operator": {
      "command": "node",
      "args": [
        "D:/Yehia Uni/vpsredo/dokploy/packages/mcp/dist/index.js"
      ],
      "env": {
        "DOKPLOY_URL": "https://dokploy.hiy.me",
        "DOKPLOY_API_KEY": "<your-key>"
      }
    }
  }
}
```

After pulling this branch, rebuild the package once:

```bash
corepack pnpm --filter @dokploy/operator-mcp build
```

If you keep the legacy `dokploy-mcp` / `user-dokploy-mcp` entry that runs `npx @dokploy/mcp`, it will **not** include `domain.provision` until that npm package is regenerated from this fork’s OpenAPI. Use `dokploy-operator` for DNS/domain day-2 ops.

## Smoke checks

1. `dokploy.ping` → `{ ok: true }`
2. `dokploy.whoami` → user email + org id (no secrets)
3. Wrong/missing API key → `{ ok: false, code: "unauthorized" }`
4. `cloudflare.status` → `{ configured, healthy, apiTokenLast4 }` (never full token)

## Server must be rebuilt

Operator routes live in the Dokploy image. After merging, run the VPS rebuild (`rebuild` / `dokploy-rebuild.sh`) so `/api/operator.*` exists. The MCP process is local to Cursor and only needs a rebuild when `packages/mcp` changes.
