import tls from "node:tls"

type CacheEntry = {
	ok: boolean
	expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 4000

const cache = new Map<string, CacheEntry>()

/**
 * Lightweight TLS handshake check: confirms a certificate is presented on 443.
 * Does not require a trusted CA chain (Cloudflare/origin edge cases). Cached briefly
 * so Domains inventory does not hammer hosts on every refetch.
 */
export const checkHostTlsCertificate = async (
	host: string,
	opts?: { timeoutMs?: number; bypassCache?: boolean },
): Promise<boolean> => {
	const normalized = host.trim().toLowerCase().replace(/\.$/, "")
	if (!normalized) return false

	const now = Date.now()
	if (!opts?.bypassCache) {
		const cached = cache.get(normalized)
		if (cached && cached.expiresAt > now) {
			return cached.ok
		}
	}

	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const ok = await new Promise<boolean>((resolve) => {
		let settled = false
		const finish = (value: boolean) => {
			if (settled) return
			settled = true
			resolve(value)
		}

		const socket = tls.connect(
			{
				host: normalized,
				port: 443,
				servername: normalized,
				rejectUnauthorized: false,
			},
			() => {
				const cert = socket.getPeerCertificate()
				const hasCert = !!cert && Object.keys(cert).length > 0
				socket.end()
				finish(hasCert)
			},
		)

		socket.setTimeout(timeoutMs)
		socket.once("timeout", () => {
			socket.destroy()
			finish(false)
		})
		socket.once("error", () => {
			finish(false)
		})
	})

	cache.set(normalized, { ok, expiresAt: now + CACHE_TTL_MS })
	return ok
}
