import type {
	DnsCredentials,
	DnsProviderAdapter,
	DnsRecord,
	DnsZone,
	UpsertDnsRecordInput,
} from "../types";
import { DNS_PROVIDER_CAPABILITIES } from "../types";

const DO_API = "https://api.digitalocean.com/v2";

type DoDomain = { name: string; ttl: number };
type DoRecord = {
	id: number;
	type: string;
	name: string;
	data: string;
	ttl: number;
	priority?: number | null;
};

const doFetch = async <T>(
	token: string,
	path: string,
	init?: { method?: string; body?: unknown },
): Promise<T> => {
	const res = await fetch(`${DO_API}${path}`, {
		method: init?.method ?? "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			...(init?.body ? { "Content-Type": "application/json" } : {}),
		},
		body: init?.body ? JSON.stringify(init.body) : undefined,
		signal: AbortSignal.timeout(30_000),
	});
	if (res.status === 429) {
		throw new Error("DigitalOcean DNS rate limited (429)");
	}
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`DigitalOcean API ${res.status}: ${text.slice(0, 200) || res.statusText}`,
		);
	}
	if (res.status === 204) {
		return undefined as T;
	}
	return (await res.json()) as T;
};

const relativeName = (fqdn: string, zoneName: string) => {
	const host = fqdn.trim().toLowerCase().replace(/\.$/, "");
	const zone = zoneName.trim().toLowerCase().replace(/\.$/, "");
	if (host === zone) return "@";
	if (host.endsWith(`.${zone}`)) {
		return host.slice(0, -(zone.length + 1));
	}
	return host;
};

const toFqdn = (name: string, zoneName: string) => {
	if (name === "@" || name === "") return zoneName;
	if (name.endsWith(`.${zoneName}`) || name === zoneName) return name;
	return `${name}.${zoneName}`;
};

const mapRecord = (zoneId: string, zoneName: string, r: DoRecord): DnsRecord => ({
	id: String(r.id),
	zoneId,
	name: toFqdn(r.name, zoneName),
	type: r.type,
	content: r.data,
	ttl: r.ttl,
	options:
		r.priority !== undefined && r.priority !== null
			? { priority: r.priority }
			: undefined,
});

export const digitaloceanDnsAdapter: DnsProviderAdapter = {
	id: "digitalocean",
	capabilities: DNS_PROVIDER_CAPABILITIES.digitalocean,

	async testCredentials(creds: DnsCredentials) {
		try {
			await doFetch<{ account: { status: string } }>(
				creds.secret,
				"/account",
			);
			return { ok: true, detail: "DigitalOcean token accepted" };
		} catch (e) {
			return {
				ok: false,
				detail: e instanceof Error ? e.message : "Token validation failed",
			};
		}
	},

	async listZones(creds: DnsCredentials): Promise<DnsZone[]> {
		const data = await doFetch<{ domains: DoDomain[] }>(
			creds.secret,
			"/domains?per_page=200",
		);
		return (data.domains ?? []).map((d) => ({
			id: d.name,
			name: d.name,
			status: "active",
			meta: { ttl: d.ttl },
		}));
	},

	async listRecords(creds: DnsCredentials, zoneId: string): Promise<DnsRecord[]> {
		const data = await doFetch<{ domain_records: DoRecord[] }>(
			creds.secret,
			`/domains/${encodeURIComponent(zoneId)}/records?per_page=200`,
		);
		return (data.domain_records ?? []).map((r) =>
			mapRecord(zoneId, zoneId, r),
		);
	},

	async upsertRecord(
		creds: DnsCredentials,
		input: UpsertDnsRecordInput,
	): Promise<DnsRecord> {
		const zoneName = input.zoneId;
		const rel = relativeName(input.name, zoneName);
		const type = String(input.type).toUpperCase();
		const ttl = input.ttl && input.ttl > 0 ? input.ttl : 3600;
		const priority =
			typeof input.options?.priority === "number"
				? input.options.priority
				: undefined;

		const existing = await doFetch<{ domain_records: DoRecord[] }>(
			creds.secret,
			`/domains/${encodeURIComponent(zoneName)}/records?per_page=200`,
		);
		const match = (existing.domain_records ?? []).find(
			(r) =>
				r.type.toUpperCase() === type &&
				(r.name === rel ||
					r.name === input.name ||
					toFqdn(r.name, zoneName) ===
						input.name.trim().toLowerCase().replace(/\.$/, "")),
		);

		const body: Record<string, unknown> = {
			type,
			name: rel,
			data: input.content,
			ttl,
		};
		if (priority !== undefined) body.priority = priority;

		if (match) {
			const updated = await doFetch<{ domain_record: DoRecord }>(
				creds.secret,
				`/domains/${encodeURIComponent(zoneName)}/records/${match.id}`,
				{ method: "PUT", body },
			);
			return mapRecord(zoneName, zoneName, updated.domain_record);
		}

		const created = await doFetch<{ domain_record: DoRecord }>(
			creds.secret,
			`/domains/${encodeURIComponent(zoneName)}/records`,
			{ method: "POST", body },
		);
		return mapRecord(zoneName, zoneName, created.domain_record);
	},

	async deleteRecord(
		creds: DnsCredentials,
		zoneId: string,
		recordId: string,
	): Promise<void> {
		await doFetch(
			creds.secret,
			`/domains/${encodeURIComponent(zoneId)}/records/${recordId}`,
			{ method: "DELETE" },
		);
	},
};
