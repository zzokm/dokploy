import type {
	DnsCredentials,
	DnsProviderAdapter,
	DnsRecord,
	DnsZone,
	UpsertDnsRecordInput,
} from "../types";
import { DNS_PROVIDER_CAPABILITIES } from "../types";

/** NS1 (IBM NS1 Connect) REST API v1 — https://api.nsone.net/v1 */
const NS1_API = "https://api.nsone.net/v1";

type Ns1ZoneSummary = {
	id?: string;
	zone: string;
	ttl?: number;
	dns_servers?: string[];
	link?: string | null;
};

type Ns1ZoneRecordSummary = {
	id?: string;
	domain: string;
	type: string;
	ttl?: number;
	short_answers?: string[];
	link?: string | null;
};

type Ns1ZoneDetail = Ns1ZoneSummary & {
	records?: Ns1ZoneRecordSummary[];
};

type Ns1Answer = {
	answer?: Array<string | number>;
};

type Ns1RecordDetail = {
	id?: string;
	zone?: string;
	domain: string;
	type: string;
	ttl?: number;
	answers?: Ns1Answer[];
	short_answers?: string[];
};

/** Encode domain+type so deleteRecord can rebuild the NS1 path. */
export const encodeNs1RecordId = (domain: string, type: string) =>
	`${domain.trim().toLowerCase().replace(/\.$/, "")}/${String(type).toUpperCase()}`;

export const decodeNs1RecordId = (
	recordId: string,
): { domain: string; type: string } => {
	const slash = recordId.lastIndexOf("/");
	if (slash <= 0 || slash === recordId.length - 1) {
		throw new Error(`Invalid NS1 record id: ${recordId}`);
	}
	return {
		domain: recordId.slice(0, slash),
		type: recordId.slice(slash + 1).toUpperCase(),
	};
};

const toFqdn = (name: string, zoneName: string) => {
	const host = name.trim().toLowerCase().replace(/\.$/, "");
	const zone = zoneName.trim().toLowerCase().replace(/\.$/, "");
	if (!host || host === "@") return zone;
	if (host === zone || host.endsWith(`.${zone}`)) return host;
	return `${host}.${zone}`;
};

const contentFromAnswers = (
	type: string,
	answers: Ns1Answer[] | undefined,
	shortAnswers: string[] | undefined,
): string => {
	if (shortAnswers?.length) {
		return shortAnswers[0] ?? "";
	}
	const first = answers?.[0]?.answer;
	if (!first?.length) return "";
	if (type.toUpperCase() === "MX" && first.length >= 2) {
		return `${first[0]} ${first[1]}`;
	}
	return String(first[0] ?? "");
};

const buildAnswers = (
	type: string,
	content: string,
	priority?: number,
): Ns1Answer[] => {
	const upper = type.toUpperCase();
	if (upper === "MX") {
		const parts = content.trim().split(/\s+/);
		const pri =
			priority !== undefined
				? priority
				: parts.length >= 2 && /^\d+$/.test(parts[0]!)
					? Number(parts[0])
					: 10;
		const host =
			parts.length >= 2 && /^\d+$/.test(parts[0]!)
				? parts.slice(1).join(" ")
				: content.trim();
		return [{ answer: [pri, host] }];
	}
	return [{ answer: [content] }];
};

const mapRecord = (
	zoneId: string,
	r: Ns1ZoneRecordSummary | Ns1RecordDetail,
): DnsRecord => {
	const type = String(r.type).toUpperCase();
	const domain = r.domain.trim().toLowerCase().replace(/\.$/, "");
	const detail = r as Ns1RecordDetail;
	return {
		id: encodeNs1RecordId(domain, type),
		zoneId,
		name: domain,
		type,
		content: contentFromAnswers(type, detail.answers, r.short_answers),
		ttl: r.ttl,
	};
};

const ns1Fetch = async <T>(
	apiKey: string,
	path: string,
	init?: { method?: string; body?: unknown; allowNotFound?: boolean },
): Promise<T | null> => {
	const res = await fetch(`${NS1_API}${path}`, {
		method: init?.method ?? "GET",
		headers: {
			"X-NSONE-Key": apiKey,
			Accept: "application/json",
			...(init?.body ? { "Content-Type": "application/json" } : {}),
		},
		body: init?.body ? JSON.stringify(init.body) : undefined,
		signal: AbortSignal.timeout(30_000),
	});
	if (res.status === 404 && init?.allowNotFound) {
		return null;
	}
	if (res.status === 429) {
		throw new Error("NS1 DNS rate limited (429)");
	}
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`NS1 API ${res.status}: ${text.slice(0, 200) || res.statusText}`,
		);
	}
	if (res.status === 204) {
		return undefined as T;
	}
	const text = await res.text().catch(() => "");
	if (!text) {
		return undefined as T;
	}
	return JSON.parse(text) as T;
};

export const ns1DnsAdapter: DnsProviderAdapter = {
	id: "ns1",
	capabilities: DNS_PROVIDER_CAPABILITIES.ns1,

	async testCredentials(creds: DnsCredentials) {
		try {
			await ns1Fetch<Ns1ZoneSummary[]>(creds.secret, "/zones");
			return { ok: true, detail: "NS1 API key accepted" };
		} catch (e) {
			return {
				ok: false,
				detail: e instanceof Error ? e.message : "API key validation failed",
			};
		}
	},

	async listZones(creds: DnsCredentials): Promise<DnsZone[]> {
		const data = await ns1Fetch<Ns1ZoneSummary[]>(creds.secret, "/zones");
		return (data ?? []).map((z) => ({
			id: z.zone,
			name: z.zone,
			status: z.link ? "linked" : "active",
			meta: {
				ttl: z.ttl,
				ns1Id: z.id,
				dnsServers: z.dns_servers,
			},
		}));
	},

	async listRecords(
		creds: DnsCredentials,
		zoneId: string,
	): Promise<DnsRecord[]> {
		const zone = await ns1Fetch<Ns1ZoneDetail>(
			creds.secret,
			`/zones/${encodeURIComponent(zoneId)}`,
		);
		return (zone?.records ?? [])
			.filter((r) => !r.link)
			.map((r) => mapRecord(zoneId, r));
	},

	async upsertRecord(
		creds: DnsCredentials,
		input: UpsertDnsRecordInput,
	): Promise<DnsRecord> {
		const zoneName = input.zoneId.trim().toLowerCase().replace(/\.$/, "");
		const domain = toFqdn(input.name, zoneName);
		const type = String(input.type).toUpperCase();
		const ttl = input.ttl && input.ttl > 0 ? input.ttl : 3600;
		const priority =
			typeof input.options?.priority === "number"
				? input.options.priority
				: undefined;

		const path = `/zones/${encodeURIComponent(zoneName)}/${encodeURIComponent(domain)}/${encodeURIComponent(type)}`;
		const existing = await ns1Fetch<Ns1RecordDetail>(creds.secret, path, {
			allowNotFound: true,
		});

		const body = {
			zone: zoneName,
			domain,
			type,
			ttl,
			answers: buildAnswers(type, input.content, priority),
		};

		const method = existing ? "POST" : "PUT";
		const saved = await ns1Fetch<Ns1RecordDetail>(creds.secret, path, {
			method,
			body,
		});
		if (!saved) {
			throw new Error("NS1 upsert returned empty response");
		}
		return mapRecord(zoneName, saved);
	},

	async deleteRecord(
		creds: DnsCredentials,
		zoneId: string,
		recordId: string,
	): Promise<void> {
		const { domain, type } = decodeNs1RecordId(recordId);
		await ns1Fetch(
			creds.secret,
			`/zones/${encodeURIComponent(zoneId)}/${encodeURIComponent(domain)}/${encodeURIComponent(type)}`,
			{ method: "DELETE" },
		);
	},
};
