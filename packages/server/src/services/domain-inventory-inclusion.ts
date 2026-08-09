/**
 * Pure helpers for Domains inventory inclusion.
 * Product rule: every service domain binding is always visible; no
 * internal/backend/hidden inventory filter.
 */

const HOSTNAME_RECORD_TYPES = new Set(["A", "AAAA", "CNAME"]);

export const normalizeInventoryHost = (host: string): string =>
	host.trim().toLowerCase().replace(/\.$/, "");

/** Domain table bindings are never hidden from inventory. */
export const shouldIncludeDomainBindingInInventory = (_input?: {
	domainType?: string | null;
	dnsProvider?: string | null;
	https?: boolean | null;
	port?: number | null;
	serviceName?: string | null;
}): boolean => true;

export const isInventoryHostnameRecordType = (type: string): boolean =>
	HOSTNAME_RECORD_TYPES.has(type.trim().toUpperCase());

/**
 * Unbound DNS A/AAAA/CNAME hostnames (e.g. host-published DB endpoints like
 * `devdb.hiy.me`) appear in inventory when not already covered by a binding.
 * Legacy mail_stack mirrors stay out.
 */
export const shouldIncludeDnsHostnameInInventory = (input: {
	type: string;
	managedBy?: string | null;
	host: string;
	existingHosts: ReadonlySet<string>;
}): boolean => {
	if (!isInventoryHostnameRecordType(input.type)) return false;
	if (input.managedBy === "mail_stack") return false;
	const host = normalizeInventoryHost(input.host);
	if (!host) return false;
	return !input.existingHosts.has(host);
};
