# Auto DNS concepts

## Auto DNS vs manual DNS vs Tunnel

| Mode | What it does |
|---|---|
| **Manual DNS** | Operator copies A/AAAA instructions; Dokploy only attaches Traefik routes |
| **Auto DNS** | Dokploy upserts the record at a connected provider, waits for public resolution, then attaches the domain |
| **Cloudflare Tunnel** | Separate publish path (cloudflared). Not an Auto DNS adapter. Do not clobber Tunnel CNAMEs |

## Happy path

1. Connect a DNS provider (Settings → Web Server → DNS providers, or Domains hub for Cloudflare).
2. Sync zones.
3. Enable Managed / Auto DNS on a hostname.
4. Dokploy upserts the record → waits for resolution → writes Traefik labels → observes ACME.

## Cloudflare policy

- Always **proxied** (orange cloud). No UI toggle.
- Always **DNS-01** (`letsencrypt-cloudflare`) because HTTP-01 through the proxy is unreliable for origin Traefik.
