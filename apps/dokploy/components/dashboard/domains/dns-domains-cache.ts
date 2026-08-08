/**
 * Browser cache for Domains hub DNS Domains (zones) + inventory.
 * Org-scoped so multi-org sessions do not leak lists across tenants.
 */

export const DNS_DOMAINS_CACHE_VERSION = 1 as const;

export type CachedDnsZone = {
	key: string;
	provider: string;
	zoneExternalId: string;
	cfZoneId: string;
	name: string;
	status: "active" | "pending" | "disabled";
	paused: boolean;
	lastSyncedAt: string | null;
	credentialId: string | null;
};

export type DnsDomainsCachePayload = {
	v: typeof DNS_DOMAINS_CACHE_VERSION;
	orgId: string;
	savedAt: string;
	hasProvider: boolean;
	zones: CachedDnsZone[];
	/** null means inventory has not been cached yet */
	inventory: unknown[] | null;
};

const STATUS_SET = new Set(["active", "pending", "disabled"]);

export function dnsDomainsCacheKey(orgId: string): string {
	return `dokploy:dns-domains:v${DNS_DOMAINS_CACHE_VERSION}:${orgId}`;
}

function isCachedDnsZone(value: unknown): value is CachedDnsZone {
	if (!value || typeof value !== "object") return false;
	const z = value as Record<string, unknown>;
	return (
		typeof z.key === "string" &&
		typeof z.provider === "string" &&
		typeof z.zoneExternalId === "string" &&
		typeof z.cfZoneId === "string" &&
		typeof z.name === "string" &&
		typeof z.status === "string" &&
		STATUS_SET.has(z.status) &&
		typeof z.paused === "boolean" &&
		(z.lastSyncedAt === null || typeof z.lastSyncedAt === "string") &&
		(z.credentialId === null || typeof z.credentialId === "string")
	);
}

function parsePayload(
	raw: unknown,
	orgId: string,
): DnsDomainsCachePayload | null {
	if (!raw || typeof raw !== "object") return null;
	const p = raw as Record<string, unknown>;
	if (p.v !== DNS_DOMAINS_CACHE_VERSION) return null;
	if (p.orgId !== orgId) return null;
	if (typeof p.savedAt !== "string") return null;
	if (typeof p.hasProvider !== "boolean") return null;
	if (!Array.isArray(p.zones) || !p.zones.every(isCachedDnsZone)) return null;
	if (p.inventory !== null && !Array.isArray(p.inventory)) return null;
	return {
		v: DNS_DOMAINS_CACHE_VERSION,
		orgId,
		savedAt: p.savedAt,
		hasProvider: p.hasProvider,
		zones: p.zones,
		inventory: p.inventory as unknown[] | null,
	};
}

export function readDnsDomainsCache(
	orgId: string,
): DnsDomainsCachePayload | null {
	if (typeof window === "undefined" || !orgId) return null;
	try {
		const raw = window.localStorage.getItem(dnsDomainsCacheKey(orgId));
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		const payload = parsePayload(parsed, orgId);
		if (!payload) {
			window.localStorage.removeItem(dnsDomainsCacheKey(orgId));
			return null;
		}
		return payload;
	} catch {
		try {
			window.localStorage.removeItem(dnsDomainsCacheKey(orgId));
		} catch {
			/* ignore */
		}
		return null;
	}
}

export function zonesFingerprint(zones: CachedDnsZone[]): string {
	return zones
		.map(
			(z) =>
				`${z.key}|${z.name}|${z.status}|${z.paused ? 1 : 0}|${z.lastSyncedAt ?? ""}|${z.credentialId ?? ""}`,
		)
		.join(";");
}

export function inventoryFingerprint(inventory: unknown[] | null): string {
	if (!inventory) return "";
	try {
		return JSON.stringify(inventory);
	} catch {
		return "";
	}
}

export function serializeHubZones(
	zones: Array<{
		key: string;
		provider: string;
		zoneExternalId: string;
		cfZoneId: string;
		name: string;
		status: "active" | "pending" | "disabled";
		paused: boolean;
		lastSyncedAt: Date | string | null;
		credentialId: string | null;
	}>,
): CachedDnsZone[] {
	return zones.map((z) => ({
		key: z.key,
		provider: z.provider,
		zoneExternalId: z.zoneExternalId,
		cfZoneId: z.cfZoneId,
		name: z.name,
		status: z.status,
		paused: z.paused,
		lastSyncedAt: z.lastSyncedAt
			? z.lastSyncedAt instanceof Date
				? z.lastSyncedAt.toISOString()
				: String(z.lastSyncedAt)
			: null,
		credentialId: z.credentialId,
	}));
}

/**
 * Merge-patch the org cache. Returns the new payload when localStorage was
 * updated, or null when unchanged / unavailable (avoids React state thrash).
 */
export function writeDnsDomainsCache(
	orgId: string,
	patch: {
		hasProvider?: boolean;
		zones?: CachedDnsZone[];
		inventory?: unknown[] | null;
	},
): DnsDomainsCachePayload | null {
	if (typeof window === "undefined" || !orgId) return null;

	const existing = readDnsDomainsCache(orgId);
	const next: DnsDomainsCachePayload = {
		v: DNS_DOMAINS_CACHE_VERSION,
		orgId,
		savedAt: new Date().toISOString(),
		hasProvider: patch.hasProvider ?? existing?.hasProvider ?? false,
		zones: patch.zones ?? existing?.zones ?? [],
		inventory:
			patch.inventory !== undefined
				? patch.inventory
				: (existing?.inventory ?? null),
	};

	if (
		existing &&
		existing.hasProvider === next.hasProvider &&
		zonesFingerprint(existing.zones) === zonesFingerprint(next.zones) &&
		inventoryFingerprint(existing.inventory) ===
			inventoryFingerprint(next.inventory)
	) {
		return null;
	}

	try {
		window.localStorage.setItem(
			dnsDomainsCacheKey(orgId),
			JSON.stringify(next),
		);
		return next;
	} catch {
		return null;
	}
}
