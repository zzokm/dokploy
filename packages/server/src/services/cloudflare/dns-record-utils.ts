export type CloudflareDnsRecordType = "A" | "AAAA" | "CNAME" | "TXT" | "MX"

export type CloudflareDnsRecord = {
	id: string
	type: CloudflareDnsRecordType
	name: string
	content: string
	ttl: number
	proxied?: boolean
	priority?: number
}

export const normalizeDnsName = (name: string) =>
	name.trim().toLowerCase().replace(/\.$/, "")

/** Prefer a stored Cloudflare record id, then name/type match. */
export const pickCloudflareDnsRecord = (
	existing: CloudflareDnsRecord[],
	opts: { recordId?: string | null; name?: string; type?: CloudflareDnsRecordType },
): CloudflareDnsRecord | null => {
	if (opts.recordId) {
		const byId = existing.find((r) => r.id === opts.recordId)
		if (byId) return byId
	}
	if (opts.name) {
		const want = normalizeDnsName(opts.name)
		const byName = existing.find((r) => {
			if (normalizeDnsName(r.name) !== want) return false
			if (opts.type && r.type !== opts.type) return false
			return true
		})
		if (byName) return byName
	}
	return existing[0] ?? null
}
