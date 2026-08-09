import { registerDnsProviderAdapter } from "../registry";
import { cloudflareDnsAdapter } from "./cloudflare";
import { digitaloceanDnsAdapter } from "./digitalocean";
import { gcloudDnsAdapter } from "./gcloud";
import { hetznerDnsAdapter } from "./hetzner";
import { route53DnsAdapter } from "./route53";

/** Register built-in Auto DNS adapters (P0–P2). NS1 deferred (P3). */
export const registerBuiltinDnsAdapters = () => {
	registerDnsProviderAdapter(cloudflareDnsAdapter);
	registerDnsProviderAdapter(digitaloceanDnsAdapter);
	registerDnsProviderAdapter(hetznerDnsAdapter);
	registerDnsProviderAdapter(route53DnsAdapter);
	registerDnsProviderAdapter(gcloudDnsAdapter);
};

export {
	cloudflareDnsAdapter,
	digitaloceanDnsAdapter,
	gcloudDnsAdapter,
	hetznerDnsAdapter,
	route53DnsAdapter,
};
