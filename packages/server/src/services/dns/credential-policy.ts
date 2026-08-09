import type { DnsProviderMeta } from "@dokploy/server/db/schema";

export type DnsCredentialPickCandidate = {
	id: string;
	label: string;
	createdAt: Date;
	meta: DnsProviderMeta;
};

/**
 * Traefik DNS-01 injects one env var per provider (e.g. CF_DNS_API_TOKEN).
 * When multiple vault credentials exist for that provider, pick:
 * 1. meta.isDefault === true
 * 2. label "Default" (case-insensitive)
 * 3. oldest by createdAt
 *
 * Per-domain / per-zone operations should pass credentialId from the zone
 * instead of relying on this default.
 */
export function pickDefaultDnsCredential<T extends DnsCredentialPickCandidate>(
	rows: T[],
): T | null {
	if (rows.length === 0) return null;
	const marked = rows.find((r) => r.meta?.isDefault === true);
	if (marked) return marked;
	const labeled = rows.find(
		(r) => r.label.trim().toLowerCase() === "default",
	);
	if (labeled) return labeled;
	return (
		[...rows].sort(
			(a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
		)[0] ?? null
	);
}

export function isPostgresUniqueViolation(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const code = (error as { code?: string }).code;
	if (code === "23505") return true;
	const cause = (error as { cause?: unknown }).cause;
	if (cause && cause !== error) {
		return isPostgresUniqueViolation(cause);
	}
	return false;
}

/** Zone list/cache key that disambiguates multi-account mirrors. */
export function dnsZoneMirrorKey(input: {
	provider: string;
	credentialId: string | null | undefined;
	externalId: string;
}): string {
	return `${input.provider}:${input.credentialId ?? "none"}:${input.externalId}`;
}
