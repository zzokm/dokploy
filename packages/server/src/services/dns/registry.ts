import type { DnsProviderAdapter, DnsProviderId } from "./types";

/**
 * Hardcoded in-repo adapter registry (not a plugin marketplace in v1).
 * Wave 2 registers adapters; orchestration looks them up by provider id.
 */
const adapters = new Map<DnsProviderId, DnsProviderAdapter>();

export const registerDnsProviderAdapter = (adapter: DnsProviderAdapter) => {
	adapters.set(adapter.id, adapter);
};

export const getDnsProviderAdapter = (
	id: DnsProviderId,
): DnsProviderAdapter | undefined => adapters.get(id);

export const requireDnsProviderAdapter = (
	id: DnsProviderId,
): DnsProviderAdapter => {
	const adapter = adapters.get(id);
	if (!adapter) {
		throw new Error(`DNS provider adapter not registered: ${id}`);
	}
	return adapter;
};

export const listRegisteredDnsProviders = (): DnsProviderId[] =>
	[...adapters.keys()];

/** Test helper — clears registry between suites. */
export const clearDnsProviderRegistry = () => {
	adapters.clear();
};
