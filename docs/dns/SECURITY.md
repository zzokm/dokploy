# Auto DNS security

- Secrets sealed with AES-256-GCM (`v1:iv:cipher:tag`) via `sealString` / `unsealString`.
- Fail closed if encryption key missing when saving credentials.
- tRPC/MCP responses: **last4 only** — never raw secrets.
- `redact.ts` covers `CF_DNS_API_TOKEN`, `DO_AUTH_TOKEN`, `HETZNER_API_KEY`, AWS keys, Bearer tokens.
- All credential/zone/record queries filter by `organization_id`.
- Provider API base URLs are hardcoded in adapters (no user-supplied endpoints in v1).
