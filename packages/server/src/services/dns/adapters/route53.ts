import { createHmac, createHash } from "node:crypto";
import type {
	DnsCredentials,
	DnsProviderAdapter,
	DnsRecord,
	DnsZone,
	UpsertDnsRecordInput,
} from "../types";
import { DNS_PROVIDER_CAPABILITIES } from "../types";

/**
 * Route 53 adapter (public hosted zones only).
 * Credentials:
 * - creds.secret = JSON `{"accessKeyId":"...","secretAccessKey":"..."}`
 * - OR secret = secretAccessKey and meta.accessKeyId
 */

const R53_HOST = "route53.amazonaws.com";
const R53_SERVICE = "route53";
const R53_REGION = "us-east-1";

type AwsKeys = { accessKeyId: string; secretAccessKey: string };

const parseKeys = (creds: DnsCredentials): AwsKeys => {
	const trimmed = creds.secret.trim();
	if (trimmed.startsWith("{")) {
		const parsed = JSON.parse(trimmed) as {
			accessKeyId?: string;
			secretAccessKey?: string;
		};
		if (!parsed.accessKeyId || !parsed.secretAccessKey) {
			throw new Error("Route53 secret JSON must include accessKeyId and secretAccessKey");
		}
		return {
			accessKeyId: parsed.accessKeyId,
			secretAccessKey: parsed.secretAccessKey,
		};
	}
	const accessKeyId = creds.meta?.accessKeyId;
	if (typeof accessKeyId !== "string" || !accessKeyId) {
		throw new Error(
			"Route53 requires meta.accessKeyId when secret is the secret access key",
		);
	}
	return { accessKeyId, secretAccessKey: trimmed };
};

const sha256 = (data: string) =>
	createHash("sha256").update(data, "utf8").digest("hex");

const hmac = (key: Buffer | string, data: string) =>
	createHmac("sha256", key).update(data, "utf8").digest();

const signRequest = (input: {
	keys: AwsKeys;
	method: string;
	path: string;
	query: string;
	payload: string;
	amzDate: string;
	dateStamp: string;
}) => {
	const canonicalHeaders = `host:${R53_HOST}\nx-amz-date:${input.amzDate}\n`;
	const signedHeaders = "host;x-amz-date";
	const canonicalRequest = [
		input.method,
		input.path,
		input.query,
		canonicalHeaders,
		signedHeaders,
		sha256(input.payload),
	].join("\n");

	const credentialScope = `${input.dateStamp}/${R53_REGION}/${R53_SERVICE}/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		input.amzDate,
		credentialScope,
		sha256(canonicalRequest),
	].join("\n");

	const kDate = hmac(`AWS4${input.keys.secretAccessKey}`, input.dateStamp);
	const kRegion = hmac(kDate, R53_REGION);
	const kService = hmac(kRegion, R53_SERVICE);
	const kSigning = hmac(kService, "aws4_request");
	const signature = createHmac("sha256", kSigning)
		.update(stringToSign, "utf8")
		.digest("hex");

	return `AWS4-HMAC-SHA256 Credential=${input.keys.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
};

const r53Request = async (input: {
	keys: AwsKeys;
	method: string;
	path: string;
	query?: string;
	body?: string;
}): Promise<string> => {
	const now = new Date();
	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
	const dateStamp = amzDate.slice(0, 8);
	const payload = input.body ?? "";
	const query = input.query ?? "";
	const authorization = signRequest({
		keys: input.keys,
		method: input.method,
		path: input.path,
		query,
		payload,
		amzDate,
		dateStamp,
	});

	const url = `https://${R53_HOST}${input.path}${query ? `?${query}` : ""}`;
	const res = await fetch(url, {
		method: input.method,
		headers: {
			Authorization: authorization,
			"X-Amz-Date": amzDate,
			...(payload
				? { "Content-Type": "application/xml", "Content-Length": String(Buffer.byteLength(payload)) }
				: {}),
		},
		body: payload || undefined,
		signal: AbortSignal.timeout(30_000),
	});

	const text = await res.text();
	if (res.status === 429 || /Throttling/i.test(text)) {
		throw new Error("Route53 rate limited (429)");
	}
	if (!res.ok) {
		throw new Error(`Route53 API ${res.status}: ${text.slice(0, 300)}`);
	}
	return text;
};

const xmlText = (xml: string, tag: string): string[] => {
	const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, "g");
	const out: string[] = [];
	for (const m of xml.matchAll(re)) {
		if (m[1] !== undefined) out.push(m[1]);
	}
	return out;
};

const ensureDot = (name: string) => {
	const n = name.trim().toLowerCase();
	return n.endsWith(".") ? n : `${n}.`;
};

const stripDot = (name: string) => name.replace(/\.$/, "");

export const route53DnsAdapter: DnsProviderAdapter = {
	id: "route53",
	capabilities: DNS_PROVIDER_CAPABILITIES.route53,

	async testCredentials(creds: DnsCredentials) {
		try {
			const keys = parseKeys(creds);
			await r53Request({
				keys,
				method: "GET",
				path: "/2013-04-01/hostedzone",
				query: "maxitems=1",
			});
			return { ok: true, detail: "Route53 credentials accepted" };
		} catch (e) {
			return {
				ok: false,
				detail: e instanceof Error ? e.message : "Credential validation failed",
			};
		}
	},

	async listZones(creds: DnsCredentials): Promise<DnsZone[]> {
		const keys = parseKeys(creds);
		const xml = await r53Request({
			keys,
			method: "GET",
			path: "/2013-04-01/hostedzone",
		});
		const ids = xmlText(xml, "Id");
		const names = xmlText(xml, "Name");
		const privates = xmlText(xml, "PrivateZone");
		const zones: DnsZone[] = [];
		for (let i = 0; i < ids.length; i++) {
			if (privates[i] === "true") continue;
			const rawId = ids[i] ?? "";
			const id = rawId.replace("/hostedzone/", "");
			zones.push({
				id,
				name: stripDot(names[i] ?? ""),
				status: "active",
				meta: { private: false },
			});
		}
		return zones;
	},

	async listRecords(creds: DnsCredentials, zoneId: string): Promise<DnsRecord[]> {
		const keys = parseKeys(creds);
		const xml = await r53Request({
			keys,
			method: "GET",
			path: `/2013-04-01/hostedzone/${zoneId}/rrset`,
		});
		const names = xmlText(xml, "Name");
		const types = xmlText(xml, "Type");
		const ttls = xmlText(xml, "TTL");
		const values = xmlText(xml, "Value");
		const records: DnsRecord[] = [];
		const n = Math.min(names.length, types.length);
		for (let i = 0; i < n; i++) {
			const type = types[i] ?? "";
			if (type === "NS" || type === "SOA") continue;
			records.push({
				id: `${names[i]}|${type}`,
				zoneId,
				name: stripDot(names[i] ?? ""),
				type,
				content: (values[i] ?? "").replace(/^"|"$/g, ""),
				ttl: Number(ttls[i] ?? 300),
			});
		}
		return records;
	},

	async upsertRecord(
		creds: DnsCredentials,
		input: UpsertDnsRecordInput,
	): Promise<DnsRecord> {
		const keys = parseKeys(creds);
		const type = String(input.type).toUpperCase();
		const name = ensureDot(input.name);
		const ttl = input.ttl && input.ttl > 0 ? input.ttl : 300;
		const value =
			type === "TXT" && !input.content.startsWith('"')
				? `"${input.content}"`
				: input.content;

		const body = `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch>
    <Changes>
      <Change>
        <Action>UPSERT</Action>
        <ResourceRecordSet>
          <Name>${name}</Name>
          <Type>${type}</Type>
          <TTL>${ttl}</TTL>
          <ResourceRecords>
            <ResourceRecord><Value>${value}</Value></ResourceRecord>
          </ResourceRecords>
        </ResourceRecordSet>
      </Change>
    </Changes>
  </ChangeBatch>
</ChangeResourceRecordSetsRequest>`;

		await r53Request({
			keys,
			method: "POST",
			path: `/2013-04-01/hostedzone/${input.zoneId}/rrset`,
			body,
		});

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
		const keys = parseKeys(creds);
		const [nameRaw, type] = recordId.split("|");
		if (!nameRaw || !type) {
			throw new Error("Route53 recordId must be name|type");
		}
		const name = ensureDot(nameRaw);
		// Need current value for DELETE — list then delete matching
		const existing = await route53DnsAdapter.listRecords(creds, zoneId);
		const match = existing.find(
			(r) => ensureDot(r.name) === name && r.type === type,
		);
		if (!match) return;
		const value =
			type === "TXT" && !match.content.startsWith('"')
				? `"${match.content}"`
				: match.content;
		const body = `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch>
    <Changes>
      <Change>
        <Action>DELETE</Action>
        <ResourceRecordSet>
          <Name>${name}</Name>
          <Type>${type}</Type>
          <TTL>${match.ttl ?? 300}</TTL>
          <ResourceRecords>
            <ResourceRecord><Value>${value}</Value></ResourceRecord>
          </ResourceRecords>
        </ResourceRecordSet>
      </Change>
    </Changes>
  </ChangeBatch>
</ChangeResourceRecordSetsRequest>`;
		await r53Request({
			keys,
			method: "POST",
			path: `/2013-04-01/hostedzone/${zoneId}/rrset`,
			body,
		});
	},
};
