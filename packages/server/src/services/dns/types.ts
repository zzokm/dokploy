/**
 * Provider-agnostic Auto DNS types.
 * Cloudflare is adapter #1 — not the product surface.
 * CF policy: always proxied + DNS-01 when managed (see DNS_PROVIDER_CAPABILITIES).
 */

export type DnsProviderId =
	| "cloudflare"
	| "digitalocean"
	| "hetzner"
	| "route53"
	| "gcloud"
	| "ns1"
	| "akamai";

export type DnsRecordType =
	| "A"
	| "AAAA"
	| "CNAME"
	| "TXT"
	| "MX"
	| "NS"
	| "ALIAS";

export type DnsAuthKind =
	| "api_token"
	| "api_key"
	| "access_key"
	| "service_account_json"
	| "oauth"
	| "edgegrid";

export type DnsCapability = {
	supportsProxy: boolean;
	/** When true, adapter always upserts proxied=true (CF orange cloud). UI must not expose a toggle. */
	forcesProxy: boolean;
	supportsDns01: boolean;
	/** When true, Traefik must use DNS-01 for managed domains (CF because forcesProxy). */
	requiresDns01WhenManaged: boolean;
	supportsAliasApex: boolean;
	auth: DnsAuthKind;
	recordTypes: DnsRecordType[];
	legoProvider?: string;
	traefikResolverName?: string;
};

export type DnsCredentials = {
	/** Unsealed secret material for the adapter (token, access key, SA JSON, etc.). */
	secret: string;
	/** Optional provider-specific non-secret metadata (account id, project, region, EdgeGrid host). */
	meta?: Record<string, unknown>;
};

export type DnsZone = {
	id: string;
	name: string;
	status?: string;
	paused?: boolean;
	meta?: Record<string, unknown>;
};

export type DnsRecord = {
	id: string;
	zoneId: string;
	name: string;
	type: DnsRecordType | string;
	content: string;
	ttl?: number;
	/** Provider-specific options. CF mirrors `{ proxied: true }` — not a user preference. */
	options?: Record<string, unknown>;
};

export type UpsertDnsRecordInput = {
	zoneId: string;
	name: string;
	type: DnsRecordType | string;
	content: string;
	ttl?: number;
	/**
	 * Provider options. Cloudflare adapter IGNORES caller proxied=false and always sets proxied:true.
	 */
	options?: Record<string, unknown>;
};

export interface DnsProviderAdapter {
	id: DnsProviderId;
	capabilities: DnsCapability;

	testCredentials(
		creds: DnsCredentials,
	): Promise<{ ok: boolean; detail?: string }>;
	listZones(creds: DnsCredentials): Promise<DnsZone[]>;
	listRecords(creds: DnsCredentials, zoneId: string): Promise<DnsRecord[]>;
	upsertRecord(
		creds: DnsCredentials,
		input: UpsertDnsRecordInput,
	): Promise<DnsRecord>;
	deleteRecord(
		creds: DnsCredentials,
		zoneId: string,
		recordId: string,
	): Promise<void>;
}

const STANDARD_RECORDS: DnsRecordType[] = [
	"A",
	"AAAA",
	"CNAME",
	"TXT",
	"MX",
	"NS",
];

export const DNS_PROVIDER_CAPABILITIES: Record<DnsProviderId, DnsCapability> = {
	cloudflare: {
		supportsProxy: true,
		forcesProxy: true,
		supportsDns01: true,
		requiresDns01WhenManaged: true,
		supportsAliasApex: false,
		auth: "api_token",
		recordTypes: [...STANDARD_RECORDS],
		legoProvider: "cloudflare",
		traefikResolverName: "letsencrypt-cloudflare",
	},
	digitalocean: {
		supportsProxy: false,
		forcesProxy: false,
		supportsDns01: true,
		requiresDns01WhenManaged: false,
		supportsAliasApex: false,
		auth: "api_token",
		recordTypes: [...STANDARD_RECORDS],
		legoProvider: "digitalocean",
		traefikResolverName: "letsencrypt-digitalocean",
	},
	hetzner: {
		supportsProxy: false,
		forcesProxy: false,
		supportsDns01: true,
		requiresDns01WhenManaged: false,
		supportsAliasApex: false,
		auth: "api_token",
		recordTypes: [...STANDARD_RECORDS],
		legoProvider: "hetzner",
		traefikResolverName: "letsencrypt-hetzner",
	},
	route53: {
		supportsProxy: false,
		forcesProxy: false,
		supportsDns01: true,
		requiresDns01WhenManaged: false,
		supportsAliasApex: false,
		auth: "access_key",
		recordTypes: [...STANDARD_RECORDS, "ALIAS"],
		legoProvider: "route53",
		traefikResolverName: "letsencrypt-route53",
	},
	gcloud: {
		supportsProxy: false,
		forcesProxy: false,
		supportsDns01: true,
		requiresDns01WhenManaged: false,
		supportsAliasApex: false,
		auth: "service_account_json",
		recordTypes: [...STANDARD_RECORDS],
		legoProvider: "gcloud",
		traefikResolverName: "letsencrypt-gcloud",
	},
	ns1: {
		supportsProxy: false,
		forcesProxy: false,
		supportsDns01: true,
		requiresDns01WhenManaged: false,
		supportsAliasApex: false,
		auth: "api_key",
		recordTypes: [...STANDARD_RECORDS],
		legoProvider: "ns1",
		traefikResolverName: "letsencrypt-ns1",
	},
	akamai: {
		supportsProxy: false,
		forcesProxy: false,
		supportsDns01: false,
		requiresDns01WhenManaged: false,
		supportsAliasApex: false,
		auth: "edgegrid",
		recordTypes: [...STANDARD_RECORDS],
	},
};

export const DNS_PROVIDER_IDS = Object.keys(
	DNS_PROVIDER_CAPABILITIES,
) as DnsProviderId[];

export const getDnsProviderCapabilities = (
	id: DnsProviderId,
): DnsCapability => DNS_PROVIDER_CAPABILITIES[id];
