import type {
	DnsCredentials,
	DnsProviderAdapter,
	DnsRecord,
	DnsZone,
	UpsertDnsRecordInput,
} from "../types";
import { DNS_PROVIDER_CAPABILITIES } from "../types";

/** Hetzner DNS Console API (dns.hetzner.com) — not the Hetzner Cloud token. */
const HETZNER_DNS_API = "https://dns.hetzner.com/api/v1";

type HzZone = {
	id: string;
	name: string;
	ttl: number;
	status?: string;
	paused?: boolean;
};
type HzRecord = {
	id: string;
	type: string;
	name: string;
	value: string;
	ttl: number;
	zone_id: string;
};

const hzFetch = async <T>(
	token: string,
	path: string,
	init?: { method?: string; body?: unknown },
): Promise<T> => {
	const res = await fetch(`${HETZNER_DNS_API}${path}`, {
		method: init?.method ?? "GET",
		headers: {
			"Auth-API-Token": token,
			Accept: "application/json",
			...(init?.body ? { "Content-Type": "application/json" } : {}),
		},
		body: init?.body ? JSON.stringify(init.body) : undefined,
		signal: AbortSignal.timeout(30_000),
	});
	if (res.status === 429) {
		throw new Error("Hetzner DNS rate limited (429)");
	}
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Hetzner DNS API ${res.status}: ${text.slice(0, 200) || res.statusText}`,
		);
	}
	if (res.status === 204) {
		return undefined as T;
	}
	return (await res.json()) as T;
};

const mapRecord = (r: HzRecord): DnsRecord => ({
	id: r.id,
	zoneId: r.zone_id,
	name: r.name,
	type: r.type,
	content: r.value,
	ttl: r.ttl,
});

export const hetznerDnsAdapter: DnsProviderAdapter = {
	id: "hetzner",
	capabilities: DNS_PROVIDER_CAPABILITIES.hetzner,

	async testCredentials(creds: DnsCredentials) {
		try {
			await hzFetch<{ zones: HzZone[] }>(creds.secret, "/zones?page=1&per_page=1");
			return { ok: true, detail: "Hetzner DNS token accepted" };
		} catch (e) {
			return {
				ok: false,
				detail: e instanceof Error ? e.message : "Token validation failed",
			};
		}
	},

	async listZones(creds: DnsCredentials): Promise<DnsZone[]> {
		const data = await hzFetch<{ zones: HzZone[] }>(
			creds.secret,
			"/zones?per_page=100",
		);
		return (data.zones ?? []).map((z) => ({
			id: z.id,
			name: z.name,
			status: z.status,
			paused: z.paused,
			meta: { ttl: z.ttl },
		}));
	},

	async listRecords(creds: DnsCredentials, zoneId: string): Promise<DnsRecord[]> {
		const data = await hzFetch<{ records: HzRecord[] }>(
			creds.secret,
			`/records?zone_id=${encodeURIComponent(zoneId)}&per_page=100`,
		);
		return (data.records ?? []).map(mapRecord);
	},

	async upsertRecord(
		creds: DnsCredentials,
		input: UpsertDnsRecordInput,
	): Promise<DnsRecord> {
		const type = String(input.type).toUpperCase();
		const ttl = input.ttl && input.ttl > 0 ? input.ttl : 86400;
		const name = input.name.trim().toLowerCase().replace(/\.$/, "");

		const existing = await hzFetch<{ records: HzRecord[] }>(
			creds.secret,
			`/records?zone_id=${encodeURIComponent(input.zoneId)}&per_page=100`,
		);
		const match = (existing.records ?? []).find(
			(r) =>
				r.type.toUpperCase() === type &&
				r.name.trim().toLowerCase().replace(/\.$/, "") === name,
		);

		const body = {
			value: input.content,
			ttl,
			type,
			name,
			zone_id: input.zoneId,
		};

		if (match) {
			const updated = await hzFetch<{ record: HzRecord }>(
				creds.secret,
				`/records/${match.id}`,
				{ method: "PUT", body },
			);
			return mapRecord(updated.record);
		}

		const created = await hzFetch<{ record: HzRecord }>(
			creds.secret,
			"/records",
			{ method: "POST", body },
		);
		return mapRecord(created.record);
	},

	async deleteRecord(
		creds: DnsCredentials,
		_zoneId: string,
		recordId: string,
	): Promise<void> {
		await hzFetch(creds.secret, `/records/${recordId}`, { method: "DELETE" });
	},
};
