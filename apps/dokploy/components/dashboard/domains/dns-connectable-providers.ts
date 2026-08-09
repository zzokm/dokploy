/**
 * Shared connectable DNS providers for Domains onboarding and Web Server settings.
 */

export type ConnectableDnsProviderId =
	| "cloudflare"
	| "digitalocean"
	| "hetzner"
	| "route53"
	| "gcloud"
	| "ns1";

export type DnsProviderOptionId = ConnectableDnsProviderId;

export type DnsProviderOption = {
	id: DnsProviderOptionId;
	name: string;
	ready: boolean;
	comingSoonLabel?: string;
};

export const DNS_PROVIDER_LABELS: Record<ConnectableDnsProviderId, string> = {
	cloudflare: "Cloudflare",
	digitalocean: "DigitalOcean",
	hetzner: "Hetzner DNS",
	route53: "Amazon Route 53",
	gcloud: "Google Cloud DNS",
	ns1: "NS1",
};

/** Every provider with a real adapter (connectable). */
export const CONNECTABLE_DNS_PROVIDERS: ConnectableDnsProviderId[] = [
	"cloudflare",
	"digitalocean",
	"hetzner",
	"route53",
	"gcloud",
	"ns1",
];

/** Picker list for onboarding and settings. */
export const DNS_PROVIDER_OPTIONS: DnsProviderOption[] = [
	{ id: "cloudflare", name: "Cloudflare", ready: true },
	{ id: "digitalocean", name: "DigitalOcean", ready: true },
	{ id: "hetzner", name: "Hetzner DNS", ready: true },
	{ id: "route53", name: "Amazon Route 53", ready: true },
	{ id: "gcloud", name: "Google Cloud DNS", ready: true },
	{ id: "ns1", name: "NS1", ready: true },
];

export const isConnectableDnsProvider = (
	id: string,
): id is ConnectableDnsProviderId =>
	(CONNECTABLE_DNS_PROVIDERS as string[]).includes(id);

export const dnsProviderScopeHint = (
	provider: ConnectableDnsProviderId,
): string => {
	switch (provider) {
		case "cloudflare":
			return "Zone → Zone → Read and Zone → DNS → Edit. Always proxied + DNS-01.";
		case "digitalocean":
			return "Personal access token with domain scope. HTTP-01 ACME by default.";
		case "hetzner":
			return "Hetzner DNS Console token (dns.hetzner.com), not the Cloud token.";
		case "route53":
			return "IAM access key JSON with Route 53 hosted zone read/write, or use the fields below.";
		case "gcloud":
			return "Paste a Google Cloud service account JSON key with Cloud DNS access.";
		case "ns1":
			return "NS1 API key with zones and records read/write. HTTP-01 ACME by default.";
		default:
			return "Paste the provider API secret. Tokens are sealed at rest.";
	}
};
