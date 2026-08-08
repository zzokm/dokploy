import { registerBuiltinDnsAdapters } from "./adapters";
import {
	getDnsProviderAdapter,
	requireDnsProviderAdapter,
} from "./registry";
import type { DnsProviderId } from "./types";
import { DNS_PROVIDER_CAPABILITIES } from "./types";

let initialized = false;

/** Idempotent registration of built-in adapters. Call from server boot / first use. */
export const ensureDnsAdaptersRegistered = () => {
	if (initialized) return;
	registerBuiltinDnsAdapters();
	initialized = true;
};

export const resolveAcmeForProvider = (provider: DnsProviderId) => {
	const caps = DNS_PROVIDER_CAPABILITIES[provider];
	if (caps.requiresDns01WhenManaged) {
		return {
			challenge: "dns-01" as const,
			resolver: caps.traefikResolverName ?? null,
		};
	}
	return { challenge: "http-01" as const, resolver: null };
};

export const getRegisteredAdapter = (provider: DnsProviderId) => {
	ensureDnsAdaptersRegistered();
	return getDnsProviderAdapter(provider);
};

export const requireRegisteredAdapter = (provider: DnsProviderId) => {
	ensureDnsAdaptersRegistered();
	return requireDnsProviderAdapter(provider);
};
