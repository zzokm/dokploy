import { createSign } from "node:crypto";
import type {
	DnsCredentials,
	DnsProviderAdapter,
	DnsRecord,
	DnsZone,
	UpsertDnsRecordInput,
} from "../types";
import { DNS_PROVIDER_CAPABILITIES } from "../types";

/**
 * Google Cloud DNS adapter.
 * creds.secret = service account JSON string
 * meta.projectId optional override (else SA project_id)
 */

type ServiceAccount = {
	client_email: string;
	private_key: string;
	project_id?: string;
	token_uri?: string;
};

const GCS_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DNS_API = "https://dns.googleapis.com/dns/v1";

const b64url = (input: Buffer | string) =>
	Buffer.from(input)
		.toString("base64")
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");

const parseSa = (creds: DnsCredentials): { sa: ServiceAccount; projectId: string } => {
	const sa = JSON.parse(creds.secret) as ServiceAccount;
	if (!sa.client_email || !sa.private_key) {
		throw new Error("GCloud secret must be a service account JSON with client_email and private_key");
	}
	const projectId =
		(typeof creds.meta?.projectId === "string" && creds.meta.projectId) ||
		sa.project_id;
	if (!projectId) {
		throw new Error("GCloud requires project id (meta.projectId or SA project_id)");
	}
	return { sa, projectId };
};

const getAccessToken = async (sa: ServiceAccount): Promise<string> => {
	const now = Math.floor(Date.now() / 1000);
	const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const claim = b64url(
		JSON.stringify({
			iss: sa.client_email,
			scope: "https://www.googleapis.com/auth/ndev.clouddns.readwrite",
			aud: sa.token_uri || GCS_TOKEN_URI,
			iat: now,
			exp: now + 3600,
		}),
	);
	const unsigned = `${header}.${claim}`;
	const signer = createSign("RSA-SHA256");
	signer.update(unsigned);
	signer.end();
	const signature = b64url(signer.sign(sa.private_key));
	const assertion = `${unsigned}.${signature}`;

	const res = await fetch(sa.token_uri || GCS_TOKEN_URI, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion,
		}),
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`GCloud token exchange failed: ${res.status} ${text.slice(0, 200)}`);
	}
	const json = (await res.json()) as { access_token?: string };
	if (!json.access_token) {
		throw new Error("GCloud token exchange returned no access_token");
	}
	return json.access_token;
};

const gcloudFetch = async <T>(
	token: string,
	path: string,
	init?: { method?: string; body?: unknown },
): Promise<T> => {
	const res = await fetch(`${DNS_API}${path}`, {
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
		throw new Error("Google Cloud DNS rate limited (429)");
	}
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`GCloud DNS API ${res.status}: ${text.slice(0, 200) || res.statusText}`,
		);
	}
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
};

const ensureDot = (name: string) => {
	const n = name.trim().toLowerCase();
	return n.endsWith(".") ? n : `${n}.`;
};

const stripDot = (name: string) => name.replace(/\.$/, "");

type GZone = { name: string; dnsName: string; visibility?: string };
type GRrset = {
	name: string;
	type: string;
	ttl?: number;
	rrdatas?: string[];
};

export const gcloudDnsAdapter: DnsProviderAdapter = {
	id: "gcloud",
	capabilities: DNS_PROVIDER_CAPABILITIES.gcloud,

	async testCredentials(creds: DnsCredentials) {
		try {
			const { sa, projectId } = parseSa(creds);
			const token = await getAccessToken(sa);
			await gcloudFetch<{ managedZones: GZone[] }>(
				token,
				`/projects/${projectId}/managedZones?maxResults=1`,
			);
			return { ok: true, detail: "GCloud DNS credentials accepted" };
		} catch (e) {
			return {
				ok: false,
				detail: e instanceof Error ? e.message : "Credential validation failed",
			};
		}
	},

	async listZones(creds: DnsCredentials): Promise<DnsZone[]> {
		const { sa, projectId } = parseSa(creds);
		const token = await getAccessToken(sa);
		const data = await gcloudFetch<{ managedZones: GZone[] }>(
			token,
			`/projects/${projectId}/managedZones`,
		);
		return (data.managedZones ?? [])
			.filter((z) => (z.visibility ?? "public") === "public")
			.map((z) => ({
				id: z.name,
				name: stripDot(z.dnsName),
				status: "active",
				meta: { projectId, visibility: z.visibility ?? "public" },
			}));
	},

	async listRecords(creds: DnsCredentials, zoneId: string): Promise<DnsRecord[]> {
		const { sa, projectId } = parseSa(creds);
		const token = await getAccessToken(sa);
		const data = await gcloudFetch<{ rrsets: GRrset[] }>(
			token,
			`/projects/${projectId}/managedZones/${encodeURIComponent(zoneId)}/rrsets`,
		);
		const out: DnsRecord[] = [];
		for (const set of data.rrsets ?? []) {
			if (set.type === "NS" || set.type === "SOA") continue;
			for (const rr of set.rrdatas ?? []) {
				out.push({
					id: `${set.name}|${set.type}`,
					zoneId,
					name: stripDot(set.name),
					type: set.type,
					content: rr.replace(/^"|"$/g, ""),
					ttl: set.ttl,
				});
			}
		}
		return out;
	},

	async upsertRecord(
		creds: DnsCredentials,
		input: UpsertDnsRecordInput,
	): Promise<DnsRecord> {
		const { sa, projectId } = parseSa(creds);
		const token = await getAccessToken(sa);
		const type = String(input.type).toUpperCase();
		const name = ensureDot(input.name);
		const ttl = input.ttl && input.ttl > 0 ? input.ttl : 300;
		const rrdata =
			type === "TXT" && !input.content.startsWith('"')
				? `"${input.content}"`
				: input.content;

		const list = await gcloudFetch<{ rrsets: GRrset[] }>(
			token,
			`/projects/${projectId}/managedZones/${encodeURIComponent(input.zoneId)}/rrsets?name=${encodeURIComponent(name)}&type=${type}`,
		);
		const existing = (list.rrsets ?? [])[0];

		if (existing) {
			await gcloudFetch(
				token,
				`/projects/${projectId}/managedZones/${encodeURIComponent(input.zoneId)}/rrsets/${encodeURIComponent(name)}/${type}`,
				{
					method: "PATCH",
					body: { ttl, rrdatas: [rrdata] },
				},
			);
		} else {
			await gcloudFetch(
				token,
				`/projects/${projectId}/managedZones/${encodeURIComponent(input.zoneId)}/rrsets`,
				{
					method: "POST",
					body: { name, type, ttl, rrdatas: [rrdata] },
				},
			);
		}

		return {
			id: `${name}|${type}`,
			zoneId: input.zoneId,
			name: stripDot(name),
			type,
			content: input.content,
			ttl,
		};
	},

	async deleteRecord(
		creds: DnsCredentials,
		zoneId: string,
		recordId: string,
	): Promise<void> {
		const { sa, projectId } = parseSa(creds);
		const token = await getAccessToken(sa);
		const [nameRaw, type] = recordId.split("|");
		if (!nameRaw || !type) {
			throw new Error("GCloud recordId must be name|type");
		}
		const name = ensureDot(nameRaw);
		await gcloudFetch(
			token,
			`/projects/${projectId}/managedZones/${encodeURIComponent(zoneId)}/rrsets/${encodeURIComponent(name)}/${type}`,
			{ method: "DELETE" },
		);
	},
};
