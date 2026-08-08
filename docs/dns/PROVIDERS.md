# Provider token scopes

| Provider | Auth | Least privilege |
|---|---|---|
| Cloudflare | API token | Zone → Zone → Read; Zone → DNS → Edit (+ Account Read if listing needs it) |
| DigitalOcean | PAT | `domain` scope |
| Hetzner DNS | DNS Console token | Token from dns.hetzner.com (**not** Hetzner Cloud token) |
| Route 53 | IAM access key | `route53:ChangeResourceRecordSets`, `ListHostedZones`, … (public zones only in v1) |
| Google Cloud DNS | Service account JSON | `dns.admin` or narrower + project id |

Never commit live tokens. Prefer sealed storage (`DOKPLOY_ENCRYPTION_KEY`).
