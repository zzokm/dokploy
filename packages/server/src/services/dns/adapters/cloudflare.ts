import { cloudflareFetch } from "../../cloudflare/client";
import {
	deleteCloudflareDnsRecord,
	listCloudflareDnsRecordsByName,
	upsertCloudflareDnsRecord,
} from "../../cloudflare/dns-records";
import type { CloudflareDnsRecordType } from "../../cloudflare/dns-record-utils";
import { normalizeDnsName } from "../../cloudflare/dns-record-utils";
import { validateCloudflareApiToken } from "../../cloudflare/token-validation";
import { listCloudflareZones } from "../../cloudflare/zones";
import type {
	DnsCredentials,
	DnsProviderAdapter,
	DnsRecord,
	DnsZone,
	UpsertDnsRecordInput,
} from "../types";
import { DNS_PROVIDER_CAPABILITIES } from "../types";

const mapCfRecord = (
	zoneId: string,
	r: {
		id: string;
		type: string;
		name: string;
		content: string;
		ttl: number;
		proxied?: boolean;
		priority?: number;
	},
): DnsRecord => ({
	id: r.id,
	zoneId,
	name: r.name,
	type: r.type,
	content: r.content,
	ttl: r.ttl,
	options: {
		proxied: r.proxied ?? true,
		...(r.priority !== undefined ? { priority: r.priority } : {}),
	},
});

const asRecordType = (type: string): CloudflareDnsRecordType => {
	const t = type.toUpperCase();
	if (t === "A" || t === "AAAA" || t === "CNAME" || t === "TXT" || t === "MX") {
		return t;
	}
	throw new Error(`Cloudflare adapter does not support record type: ${type}`);
};

/**
 * Cloudflare Auto DNS adapter.
 * Policy: always upsert with proxied:true (orange cloud). Caller options are ignored.
 */
export const cloudflareDnsAdapter: DnsProviderAdapter = {
	id: "cloudflare",
	capabilities: DNS_PROVIDER_CAPABILITIES.cloudflare,

	async testCredentials(creds: DnsCredentials) {
		const result = await validateCloudflareApiToken(creds.secret);
		return { ok: result.ok, detail: result.message };
	},

	async listZones(creds: DnsCredentials): Promise<DnsZone[]> {
		const zones = await listCloudflareZones({ token: creds.secret });
		return zones.map((z) => ({
			id: z.id,
			name: z.name,
			status: z.status,
			paused: z.paused,
			meta: { type: z.type },
		}));
	},

	async listRecords(creds: DnsCredentials, zoneId: string): Promise<DnsRecord[]> {
		const rows = await cloudflareFetch<
			Array<{
				id: string;
				type: string;
				name: string;
				content: string;
				ttl: number;
				proxied?: boolean;
				priority?: number;
			}>
		>({
			token: creds.secret,
			method: "GET",
			path: `/zones/${zoneId}/dns_records`,
			query: { per_page: 100 },
		});
		return rows.map((r) => mapCfRecord(zoneId, r));
	},

	async upsertRecord(
		creds: DnsCredentials,
		input: UpsertDnsRecordInput,
	): Promise<DnsRecord> {
		// Locked policy: always proxied — ignore options.proxied === false
		const proxied = true;
		const type = asRecordType(input.type);
		const ttl =
			typeof input.ttl === "number" && input.ttl > 0 ? input.ttl : 1;
		const priority =
			typeof input.options?.priority === "number"
				? input.options.priority
				: undefined;

		const record = await upsertCloudflareDnsRecord({
			token: creds.secret,
			zoneId: input.zoneId,
			type,
			name: normalizeDnsName(input.name),
			content: input.content,
			ttl,
			proxied,
			priority,
		});

		return mapCfRecord(input.zoneId, record);
	},

	async deleteRecord(
		creds: DnsCredentials,
		zoneId: string,
		recordId: string,
	): Promise<void> {
		await deleteCloudflareDnsRecord({
			token: creds.secret,
			zoneId,
			recordId,
		});
	},
};

/** Test helper: force-proxied flag used by adapter upserts. */
export const cloudflareAlwaysProxied = true;

export const listMatchingCloudflareRecords = listCloudflareDnsRecordsByName;
