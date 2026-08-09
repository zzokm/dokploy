import { registerDnsProviderAdapter } from "../registry";
import { cloudflareDnsAdapter } from "./cloudflare";
import { digitaloceanDnsAdapter } from "./digitalocean";
import { gcloudDnsAdapter } from "./gcloud";
import { hetznerDnsAdapter } from "./hetzner";
import { ns1DnsAdapter } from "./ns1";
import { route53DnsAdapter } from "./route53";

/** Register built-in Auto DNS adapters. */
export const registerBuiltinDnsAdapters = () => {
	registerDnsProviderAdapter(cloudflareDnsAdapter);
	registerDnsProviderAdapter(digitaloceanDnsAdapter);
	registerDnsProviderAdapter(hetznerDnsAdapter);
	registerDnsProviderAdapter(route53DnsAdapter);
	registerDnsProviderAdapter(gcloudDnsAdapter);
	registerDnsProviderAdapter(ns1DnsAdapter);
};

export {
	cloudflareDnsAdapter,
	digitaloceanDnsAdapter,
	gcloudDnsAdapter,
	hetznerDnsAdapter,
	ns1DnsAdapter,
	route53DnsAdapter,
};
