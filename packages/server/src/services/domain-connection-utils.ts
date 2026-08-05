export type ConnectionCloudflareState = {
	/** Cloudflare owns this hostname (domain flag or a mirrored DNS record). */
	managed: boolean
	/** Managed and the record is known to exist in Cloudflare. */
	synced: boolean
	zoneName: string | null
	proxied: boolean | null
	lastSyncedAt: string | null
	status: "synced" | "pending" | "error" | null
}

const ADDRESS_RECORD_TYPES = new Set(["A", "AAAA", "CNAME"])

export type MirroredDnsRecord = {
	type: string
	proxied: boolean
	lastSyncedAt: string | null
}

const latestIso = (values: Array<string | null>) => {
	let latest: number | null = null
	for (const value of values) {
		if (!value) continue
		const ms = new Date(value).getTime()
		if (Number.isNaN(ms)) continue
		if (latest === null || ms > latest) latest = ms
	}
	return latest === null ? null : new Date(latest).toISOString()
}

/**
 * Cloudflare management for a single hostname, derived from the domain's own
 * `cf_*` columns plus the mirrored `cloudflare_dns_record` rows matching it.
 * The mirror is authoritative for "the record exists": `cf_status` can stay
 * `pending` on domains whose provider flag was set after the record was synced.
 */
export const deriveConnectionCloudflareState = (input: {
	dnsProvider: "none" | "cloudflare"
	cfZoneName: string | null
	cfProxied: boolean | null
	cfStatus: "synced" | "pending" | "error" | null
	mirroredRecords: MirroredDnsRecord[]
}): ConnectionCloudflareState => {
	const isCloudflareProvider = input.dnsProvider === "cloudflare"
	const records = input.mirroredRecords.filter((record) =>
		ADDRESS_RECORD_TYPES.has(record.type.trim().toUpperCase()),
	)
	const managed = isCloudflareProvider || records.length > 0

	if (!managed) {
		return {
			managed: false,
			synced: false,
			zoneName: null,
			proxied: null,
			lastSyncedAt: null,
			status: null,
		}
	}

	const status = isCloudflareProvider
		? input.cfStatus
		: records.length
			? "synced"
			: null

	return {
		managed: true,
		synced:
			status === "synced" || (records.length > 0 && status !== "error"),
		zoneName: input.cfZoneName,
		proxied: records.length
			? records.some((record) => record.proxied)
			: isCloudflareProvider
				? input.cfProxied
				: null,
		lastSyncedAt: latestIso(records.map((record) => record.lastSyncedAt)),
		status,
	}
}
