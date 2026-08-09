import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "@dokploy/server/db";
import {
	applications,
	cloudflareDnsRecord,
	cloudflareZone,
	compose,
	deployments,
	dnsRecord,
	domains,
	environments,
	ports,
	previewDeployments,
	projects,
	server,
} from "@dokploy/server/db/schema";
import { listZoneDnsRecords } from "./cloudflare/zone-dns-records";
import {
	normalizeInventoryHost,
	shouldIncludeDnsHostnameInInventory,
	shouldIncludeDomainBindingInInventory,
} from "./domain-inventory-inclusion";
import {
	extractComposeMatchHints,
	type InventoryServiceCandidate,
	matchDnsHostnameToService,
} from "./domain-inventory-link";
import { checkHostTlsCertificate } from "./tls-check";
import { getWebServerSettings } from "./web-server-settings";

const LIVE_CF_ZONE_TIMEOUT_MS = 6_000;
const LIVE_CF_TOTAL_TIMEOUT_MS = 12_000;

const withTimeout = async <T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${label} timed out after ${ms}ms`)),
					ms,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};

export type DomainInventoryKind =
	| "application"
	| "compose"
	| "preview"
	| "web-server"
	| "dns-hostname";

export type DomainInventoryItem = {
	domainId: string;
	host: string;
	kind: DomainInventoryKind;
	serviceName: string;
	serviceId: string | null;
	applicationId: string | null;
	composeId: string | null;
	previewDeploymentId: string | null;
	projectId: string | null;
	environmentId: string | null;
	appName: string | null;
	serverId: string | null;
	uniqueConfigKey: number | null;
	certificateType: "none" | "letsencrypt" | "custom";
	https: boolean;
	/** Traefik container listen port for this domain. */
	port: number | null;
	/**
	 * True when domain.port matches a host-mode publishedPort on the linked
	 * application (likely confused with container targetPort).
	 */
	portLooksLikeHostPublish: boolean;
	dnsProvider:
		| "none"
		| "cloudflare"
		| "digitalocean"
		| "hetzner"
		| "route53"
		| "gcloud"
		| "ns1"
		| "akamai";
	cfProxied: boolean | null;
	cfStatus: "synced" | "pending" | "error" | null;
	cfZoneName: string | null;
	cfDnsRecordId: string | null;
	createdAt: string;
	lastSyncedAt: string | null;
	expectedServerIp: string | null;
	/** Latest successful deploy finishedAt/createdAt for the linked service. */
	lastSuccessfulDeployAt: string | null;
	/**
	 * Live TLS probe for hosts where we check it (web-server).
	 * null = not probed; true/false = handshake presented a certificate.
	 */
	tlsReachable: boolean | null;
	/**
	 * For dns-hostname rows: best-effort compose service key to prefill when
	 * attaching a Traefik domain. Null when unmatched or application target.
	 */
	suggestedServiceName: string | null;
};

export type ListDomainsInventoryOptions = {
	/**
	 * When true, also scan live Cloudflare zones for unmirrored hostnames.
	 * Default false — mirrors only so first paint is not blocked on CF API.
	 */
	includeLive?: boolean;
	/** Per-zone live fetch timeout (ms). */
	liveZoneTimeoutMs?: number;
	/** Cap for the whole live scan (ms). */
	liveTotalTimeoutMs?: number;
};

const mapSyncIso = (value: Date | string | null | undefined) => {
	if (!value) return null;
	if (value instanceof Date) return value.toISOString();
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const loadLastSuccessfulDeployMap = async (
	applicationIds: string[],
	composeIds: string[],
) => {
	const map = new Map<string, string>();

	if (applicationIds.length) {
		const rows = await db
			.select({
				applicationId: deployments.applicationId,
				createdAt: deployments.createdAt,
				finishedAt: deployments.finishedAt,
			})
			.from(deployments)
			.where(
				and(
					inArray(deployments.applicationId, applicationIds),
					eq(deployments.status, "done"),
				),
			)
			.orderBy(desc(deployments.createdAt));

		for (const row of rows) {
			if (!row.applicationId || map.has(`app:${row.applicationId}`)) continue;
			map.set(`app:${row.applicationId}`, row.finishedAt || row.createdAt);
		}
	}

	if (composeIds.length) {
		const rows = await db
			.select({
				composeId: deployments.composeId,
				createdAt: deployments.createdAt,
				finishedAt: deployments.finishedAt,
			})
			.from(deployments)
			.where(
				and(
					inArray(deployments.composeId, composeIds),
					eq(deployments.status, "done"),
				),
			)
			.orderBy(desc(deployments.createdAt));

		for (const row of rows) {
			if (!row.composeId || map.has(`compose:${row.composeId}`)) continue;
			map.set(`compose:${row.composeId}`, row.finishedAt || row.createdAt);
		}
	}

	return map;
};

const loadDnsSyncMap = async (
	organizationId: string,
	cfRecordIds: string[],
) => {
	const map = new Map<string, string>();
	if (!cfRecordIds.length) return map;

	const rows = await db
		.select({
			cfRecordId: cloudflareDnsRecord.cfRecordId,
			lastSyncedAt: cloudflareDnsRecord.lastSyncedAt,
		})
		.from(cloudflareDnsRecord)
		.where(
			and(
				eq(cloudflareDnsRecord.organizationId, organizationId),
				inArray(cloudflareDnsRecord.cfRecordId, cfRecordIds),
			),
		);

	for (const row of rows) {
		const iso = mapSyncIso(row.lastSyncedAt);
		if (iso) map.set(row.cfRecordId, iso);
	}
	return map;
};

const loadHostPublishedPortsMap = async (applicationIds: string[]) => {
	const map = new Map<string, Set<number>>();
	if (!applicationIds.length) return map;

	const rows = await db
		.select({
			applicationId: ports.applicationId,
			publishedPort: ports.publishedPort,
			targetPort: ports.targetPort,
			publishMode: ports.publishMode,
		})
		.from(ports)
		.where(inArray(ports.applicationId, applicationIds));

	for (const row of rows) {
		if (row.publishMode !== "host") continue;
		// Domain port should be the container listen/target port. Matching the
		// host published port (especially when it differs from target) is a
		// common misconfiguration.
		if (row.publishedPort === row.targetPort) continue;
		const set = map.get(row.applicationId) ?? new Set<number>();
		set.add(row.publishedPort);
		map.set(row.applicationId, set);
	}
	return map;
};

/**
 * Org-scoped inventory of every provisioned hostname (apps, compose, previews)
 * plus the Dokploy web-server domain when configured. Uses column-selected joins
 * only — avoids relational `with: true` / Postgres 100-arg limits.
 *
 * Default path reads DNS mirrors only. Pass `{ includeLive: true }` for an
 * optional background refresh that scans live Cloudflare zones with timeouts.
 */
export const listDomainsInventory = async (
	organizationId: string,
	options: ListDomainsInventoryOptions = {},
): Promise<DomainInventoryItem[]> => {
	const includeLive = options.includeLive === true;
	const liveZoneTimeoutMs =
		options.liveZoneTimeoutMs ?? LIVE_CF_ZONE_TIMEOUT_MS;
	const liveTotalTimeoutMs =
		options.liveTotalTimeoutMs ?? LIVE_CF_TOTAL_TIMEOUT_MS;
	const appRows = await db
		.select({
			domainId: domains.domainId,
			host: domains.host,
			certificateType: domains.certificateType,
			https: domains.https,
			port: domains.port,
			dnsProvider: domains.dnsProvider,
			cfProxied: domains.cfProxied,
			cfStatus: domains.cfStatus,
			cfZoneName: domains.cfZoneName,
			cfDnsRecordId: domains.cfDnsRecordId,
			createdAt: domains.createdAt,
			uniqueConfigKey: domains.uniqueConfigKey,
			serviceNameLabel: domains.serviceName,
			applicationId: applications.applicationId,
			projectId: projects.projectId,
			environmentId: environments.environmentId,
			appName: applications.appName,
			displayName: applications.name,
			serverId: applications.serverId,
			serverIp: server.ipAddress,
		})
		.from(domains)
		.innerJoin(
			applications,
			eq(domains.applicationId, applications.applicationId),
		)
		.innerJoin(
			environments,
			eq(applications.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.leftJoin(server, eq(applications.serverId, server.serverId))
		.where(eq(projects.organizationId, organizationId));

	const composeRows = await db
		.select({
			domainId: domains.domainId,
			host: domains.host,
			certificateType: domains.certificateType,
			https: domains.https,
			port: domains.port,
			dnsProvider: domains.dnsProvider,
			cfProxied: domains.cfProxied,
			cfStatus: domains.cfStatus,
			cfZoneName: domains.cfZoneName,
			cfDnsRecordId: domains.cfDnsRecordId,
			createdAt: domains.createdAt,
			uniqueConfigKey: domains.uniqueConfigKey,
			serviceNameLabel: domains.serviceName,
			composeId: compose.composeId,
			projectId: projects.projectId,
			environmentId: environments.environmentId,
			appName: compose.appName,
			displayName: compose.name,
			serverId: compose.serverId,
			serverIp: server.ipAddress,
		})
		.from(domains)
		.innerJoin(compose, eq(domains.composeId, compose.composeId))
		.innerJoin(
			environments,
			eq(compose.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.leftJoin(server, eq(compose.serverId, server.serverId))
		.where(eq(projects.organizationId, organizationId));

	const previewRows = await db
		.select({
			domainId: domains.domainId,
			host: domains.host,
			certificateType: domains.certificateType,
			https: domains.https,
			port: domains.port,
			dnsProvider: domains.dnsProvider,
			cfProxied: domains.cfProxied,
			cfStatus: domains.cfStatus,
			cfZoneName: domains.cfZoneName,
			cfDnsRecordId: domains.cfDnsRecordId,
			createdAt: domains.createdAt,
			uniqueConfigKey: domains.uniqueConfigKey,
			serviceNameLabel: domains.serviceName,
			previewDeploymentId: domains.previewDeploymentId,
			applicationId: applications.applicationId,
			projectId: projects.projectId,
			environmentId: environments.environmentId,
			appName: applications.appName,
			displayName: applications.name,
			serverId: applications.serverId,
			serverIp: server.ipAddress,
		})
		.from(domains)
		.innerJoin(
			previewDeployments,
			eq(domains.previewDeploymentId, previewDeployments.previewDeploymentId),
		)
		.innerJoin(
			applications,
			eq(previewDeployments.applicationId, applications.applicationId),
		)
		.innerJoin(
			environments,
			eq(applications.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.leftJoin(server, eq(applications.serverId, server.serverId))
		.where(eq(projects.organizationId, organizationId));

	const applicationIds = [
		...new Set([
			...appRows.map((r) => r.applicationId),
			...previewRows.map((r) => r.applicationId),
		]),
	];
	const composeIds = [...new Set(composeRows.map((r) => r.composeId))];
	const cfRecordIds = [
		...new Set(
			[...appRows, ...composeRows, ...previewRows]
				.map((r) => r.cfDnsRecordId)
				.filter((id): id is string => !!id),
		),
	];

	const [deployMap, syncMap, hostPublishMap, webSettings] = await Promise.all([
		loadLastSuccessfulDeployMap(applicationIds, composeIds),
		loadDnsSyncMap(organizationId, cfRecordIds),
		loadHostPublishedPortsMap(applicationIds),
		getWebServerSettings(),
	]);

	const fallbackIp = webSettings?.serverIp?.trim()
		? webSettings.serverIp.trim()
		: null;

	const portLooksLikeHostPublish = (
		applicationId: string | null | undefined,
		port: number | null | undefined,
	) => {
		if (!applicationId || port == null) return false;
		return hostPublishMap.get(applicationId)?.has(port) ?? false;
	};

	const items: DomainInventoryItem[] = [];

	for (const row of appRows) {
		if (!shouldIncludeDomainBindingInInventory()) continue;
		items.push({
			domainId: row.domainId,
			host: row.host,
			kind: "application",
			serviceName: row.displayName,
			serviceId: row.applicationId,
			applicationId: row.applicationId,
			composeId: null,
			previewDeploymentId: null,
			projectId: row.projectId,
			environmentId: row.environmentId,
			appName: row.appName,
			serverId: row.serverId,
			uniqueConfigKey: row.uniqueConfigKey,
			certificateType: row.certificateType,
			https: row.https,
			port: row.port ?? null,
			portLooksLikeHostPublish: portLooksLikeHostPublish(
				row.applicationId,
				row.port,
			),
			dnsProvider: row.dnsProvider,
			cfProxied: row.dnsProvider === "cloudflare" ? row.cfProxied : null,
			cfStatus: row.dnsProvider === "cloudflare" ? row.cfStatus : null,
			cfZoneName: row.cfZoneName,
			cfDnsRecordId: row.cfDnsRecordId,
			createdAt: row.createdAt,
			lastSyncedAt: row.cfDnsRecordId
				? (syncMap.get(row.cfDnsRecordId) ?? null)
				: null,
			expectedServerIp: row.serverIp?.trim() || fallbackIp,
			lastSuccessfulDeployAt:
				deployMap.get(`app:${row.applicationId}`) ?? null,
			tlsReachable: null,
			suggestedServiceName: null,
		});
	}

	for (const row of composeRows) {
		if (!shouldIncludeDomainBindingInInventory()) continue;
		items.push({
			domainId: row.domainId,
			host: row.host,
			kind: "compose",
			serviceName: row.serviceNameLabel
				? `${row.displayName} · ${row.serviceNameLabel}`
				: row.displayName,
			serviceId: row.composeId,
			applicationId: null,
			composeId: row.composeId,
			previewDeploymentId: null,
			projectId: row.projectId,
			environmentId: row.environmentId,
			appName: row.appName,
			serverId: row.serverId,
			uniqueConfigKey: row.uniqueConfigKey,
			certificateType: row.certificateType,
			https: row.https,
			port: row.port ?? null,
			portLooksLikeHostPublish: false,
			dnsProvider: row.dnsProvider,
			cfProxied: row.dnsProvider === "cloudflare" ? row.cfProxied : null,
			cfStatus: row.dnsProvider === "cloudflare" ? row.cfStatus : null,
			cfZoneName: row.cfZoneName,
			cfDnsRecordId: row.cfDnsRecordId,
			createdAt: row.createdAt,
			lastSyncedAt: row.cfDnsRecordId
				? (syncMap.get(row.cfDnsRecordId) ?? null)
				: null,
			expectedServerIp: row.serverIp?.trim() || fallbackIp,
			lastSuccessfulDeployAt:
				deployMap.get(`compose:${row.composeId}`) ?? null,
			tlsReachable: null,
			suggestedServiceName: row.serviceNameLabel ?? null,
		});
	}

	for (const row of previewRows) {
		if (!shouldIncludeDomainBindingInInventory()) continue;
		items.push({
			domainId: row.domainId,
			host: row.host,
			kind: "preview",
			serviceName: `${row.displayName} (preview)`,
			serviceId: row.previewDeploymentId,
			applicationId: row.applicationId,
			composeId: null,
			previewDeploymentId: row.previewDeploymentId,
			projectId: row.projectId,
			environmentId: row.environmentId,
			appName: row.appName,
			serverId: row.serverId,
			uniqueConfigKey: row.uniqueConfigKey,
			certificateType: row.certificateType,
			https: row.https,
			port: row.port ?? null,
			portLooksLikeHostPublish: portLooksLikeHostPublish(
				row.applicationId,
				row.port,
			),
			dnsProvider: row.dnsProvider,
			cfProxied: row.dnsProvider === "cloudflare" ? row.cfProxied : null,
			cfStatus: row.dnsProvider === "cloudflare" ? row.cfStatus : null,
			cfZoneName: row.cfZoneName,
			cfDnsRecordId: row.cfDnsRecordId,
			createdAt: row.createdAt,
			lastSyncedAt: row.cfDnsRecordId
				? (syncMap.get(row.cfDnsRecordId) ?? null)
				: null,
			expectedServerIp: row.serverIp?.trim() || fallbackIp,
			lastSuccessfulDeployAt:
				deployMap.get(`app:${row.applicationId}`) ?? null,
			tlsReachable: null,
			suggestedServiceName: null,
		});
	}

	const webHost = webSettings?.host?.trim();
	if (webHost) {
		const normalized = webHost.toLowerCase().replace(/\.$/, "");
		const [webSync] = await db
			.select({
				lastSyncedAt: cloudflareDnsRecord.lastSyncedAt,
				proxied: cloudflareDnsRecord.proxied,
			})
			.from(cloudflareDnsRecord)
			.where(
				and(
					eq(cloudflareDnsRecord.organizationId, organizationId),
					eq(cloudflareDnsRecord.name, normalized),
				),
			)
			.limit(1);

		const httpsEnabled =
			!!webSettings?.https &&
			(webSettings?.certificateType === "letsencrypt" ||
				webSettings?.certificateType === "custom");

		let tlsReachable: boolean | null = null;
		if (httpsEnabled) {
			try {
				tlsReachable = await checkHostTlsCertificate(webHost);
			} catch {
				tlsReachable = false;
			}
		}

		items.push({
			domainId: "web-server",
			host: webHost,
			kind: "web-server",
			serviceName: "Web Server",
			serviceId: null,
			applicationId: null,
			composeId: null,
			previewDeploymentId: null,
			projectId: null,
			environmentId: null,
			appName: "dokploy",
			serverId: null,
			uniqueConfigKey: null,
			certificateType: webSettings?.certificateType ?? "none",
			https: webSettings?.https ?? false,
			port: null,
			portLooksLikeHostPublish: false,
			dnsProvider: webSync ? "cloudflare" : "none",
			cfProxied: webSync?.proxied ?? null,
			cfStatus: webSync ? "synced" : null,
			cfZoneName: null,
			cfDnsRecordId: null,
			// Prefer stable createdAt so settings saves don't reset the SSL window.
			createdAt:
				webSettings?.createdAt?.toISOString?.() ??
				webSettings?.updatedAt?.toISOString?.() ??
				new Date().toISOString(),
			lastSyncedAt: mapSyncIso(webSync?.lastSyncedAt),
			expectedServerIp: fallbackIp,
			lastSuccessfulDeployAt: null,
			tlsReachable,
			suggestedServiceName: null,
		});
	}

	// Hostnames that exist only as DNS records (e.g. host-published Postgres
	// at devdb.example.com) must still appear in All domains.
	const existingHosts = new Set(
		items.map((item) => normalizeInventoryHost(item.host)).filter(Boolean),
	);

	const pushDnsHostnameItem = (input: {
		domainId: string;
		host: string;
		serviceName: string;
		dnsProvider: DomainInventoryItem["dnsProvider"];
		cfProxied: boolean | null;
		cfZoneName: string | null;
		cfDnsRecordId: string | null;
		createdAt: string;
		lastSyncedAt: string | null;
	}) => {
		items.push({
			domainId: input.domainId,
			host: input.host,
			kind: "dns-hostname",
			serviceName: input.serviceName,
			serviceId: null,
			applicationId: null,
			composeId: null,
			previewDeploymentId: null,
			projectId: null,
			environmentId: null,
			appName: null,
			serverId: null,
			uniqueConfigKey: null,
			certificateType: "none",
			https: false,
			port: null,
			portLooksLikeHostPublish: false,
			dnsProvider: input.dnsProvider,
			cfProxied: input.cfProxied,
			cfStatus: "synced",
			cfZoneName: input.cfZoneName,
			cfDnsRecordId: input.cfDnsRecordId,
			createdAt: input.createdAt,
			lastSyncedAt: input.lastSyncedAt,
			expectedServerIp: fallbackIp,
			lastSuccessfulDeployAt: null,
			tlsReachable: null,
			suggestedServiceName: null,
		});
	};

	const [cfHostnameRows, mirroredHostnameRows] = await Promise.all([
		db
			.select({
				cfRecordId: cloudflareDnsRecord.cfRecordId,
				type: cloudflareDnsRecord.type,
				name: cloudflareDnsRecord.name,
				proxied: cloudflareDnsRecord.proxied,
				managedBy: cloudflareDnsRecord.managedBy,
				lastSyncedAt: cloudflareDnsRecord.lastSyncedAt,
				createdAt: cloudflareDnsRecord.createdAt,
			})
			.from(cloudflareDnsRecord)
			.where(
				and(
					eq(cloudflareDnsRecord.organizationId, organizationId),
					ne(cloudflareDnsRecord.managedBy, "mail_stack"),
					or(
						eq(cloudflareDnsRecord.type, "A"),
						eq(cloudflareDnsRecord.type, "AAAA"),
						eq(cloudflareDnsRecord.type, "CNAME"),
						eq(cloudflareDnsRecord.type, "a"),
						eq(cloudflareDnsRecord.type, "aaaa"),
						eq(cloudflareDnsRecord.type, "cname"),
					),
				),
			),
		db
			.select({
				externalId: dnsRecord.externalId,
				provider: dnsRecord.provider,
				type: dnsRecord.type,
				name: dnsRecord.name,
				options: dnsRecord.options,
				managedBy: dnsRecord.managedBy,
				lastSyncedAt: dnsRecord.lastSyncedAt,
				createdAt: dnsRecord.createdAt,
			})
			.from(dnsRecord)
			.where(
				and(
					eq(dnsRecord.organizationId, organizationId),
					ne(dnsRecord.managedBy, "mail_stack"),
					or(
						eq(dnsRecord.type, "A"),
						eq(dnsRecord.type, "AAAA"),
						eq(dnsRecord.type, "CNAME"),
						eq(dnsRecord.type, "a"),
						eq(dnsRecord.type, "aaaa"),
						eq(dnsRecord.type, "cname"),
					),
				),
			),
	]);

	for (const row of cfHostnameRows) {
		if (
			!shouldIncludeDnsHostnameInInventory({
				type: row.type,
				managedBy: row.managedBy,
				host: row.name,
				existingHosts,
			})
		) {
			continue;
		}
		const host = normalizeInventoryHost(row.name);
		existingHosts.add(host);
		pushDnsHostnameItem({
			domainId: `dns:cloudflare:${row.cfRecordId}`,
			host,
			serviceName:
				row.managedBy === "app_domain"
					? "App DNS record"
					: "DNS only (no Traefik binding)",
			dnsProvider: "cloudflare",
			cfProxied: row.proxied,
			cfZoneName: null,
			cfDnsRecordId: row.cfRecordId,
			createdAt:
				row.createdAt instanceof Date
					? row.createdAt.toISOString()
					: String(row.createdAt),
			lastSyncedAt: mapSyncIso(row.lastSyncedAt),
		});
	}

	for (const row of mirroredHostnameRows) {
		if (row.provider === "cloudflare") continue;
		if (
			!shouldIncludeDnsHostnameInInventory({
				type: row.type,
				managedBy: row.managedBy,
				host: row.name,
				existingHosts,
			})
		) {
			continue;
		}
		const host = normalizeInventoryHost(row.name);
		existingHosts.add(host);
		const proxied =
			typeof row.options?.proxied === "boolean" ? row.options.proxied : null;
		pushDnsHostnameItem({
			domainId: `dns:${row.provider}:${row.externalId}`,
			host,
			serviceName:
				row.managedBy === "app_domain"
					? "App DNS record"
					: "DNS only (no Traefik binding)",
			dnsProvider: row.provider,
			cfProxied: proxied,
			cfZoneName: null,
			cfDnsRecordId: null,
			createdAt:
				row.createdAt instanceof Date
					? row.createdAt.toISOString()
					: String(row.createdAt),
			lastSyncedAt: mapSyncIso(row.lastSyncedAt),
		});
	}

	// Optional live Cloudflare scan — never on the default first-paint path.
	// Zones are fetched in parallel with per-zone + total timeouts; failures
	// fall back to mirrors already loaded above (no token/secret leakage).
	if (includeLive) {
		try {
			const cfZones = await db
				.select({
					cfZoneId: cloudflareZone.cfZoneId,
					name: cloudflareZone.name,
				})
				.from(cloudflareZone)
				.where(eq(cloudflareZone.organizationId, organizationId));

			const liveScan = Promise.allSettled(
				cfZones.map(async (zone) => {
					const live = await withTimeout(
						listZoneDnsRecords({
							organizationId,
							cfZoneId: zone.cfZoneId,
						}),
						liveZoneTimeoutMs,
						`cloudflare zone ${zone.name}`,
					);
					return { zone, records: live.records };
				}),
			);

			const settled = await withTimeout(
				liveScan,
				liveTotalTimeoutMs,
				"cloudflare live inventory scan",
			);

			for (const result of settled) {
				if (result.status !== "fulfilled") continue;
				const { zone, records } = result.value;
				for (const record of records) {
					if (
						!shouldIncludeDnsHostnameInInventory({
							type: record.type,
							managedBy: record.managedBy,
							host: record.name,
							existingHosts,
						})
					) {
						continue;
					}
					const host = normalizeInventoryHost(record.name);
					existingHosts.add(host);
					pushDnsHostnameItem({
						domainId: `dns:cloudflare:${record.cfRecordId}`,
						host,
						serviceName:
							record.managedBy === "app_domain"
								? "App DNS record"
								: "DNS only (no Traefik binding)",
						dnsProvider: "cloudflare",
						cfProxied: record.proxied,
						cfZoneName: zone.name,
						cfDnsRecordId: record.cfRecordId,
						createdAt: new Date().toISOString(),
						lastSyncedAt: record.lastSyncedAt,
					});
				}
			}
		} catch {
			// Token missing, timeout, or provider error: mirrors above still apply.
		}
	}

	// Best-effort deep-link: match unbound DNS hostnames to apps/compose.
	const linkCandidates = await loadInventoryServiceCandidates(organizationId);
	if (linkCandidates.length) {
		for (const item of items) {
			if (item.kind !== "dns-hostname") continue;
			if (item.projectId || item.applicationId || item.composeId) continue;
			const match = matchDnsHostnameToService(item.host, linkCandidates);
			if (!match) continue;
			item.projectId = match.projectId;
			item.environmentId = match.environmentId;
			item.applicationId = match.applicationId;
			item.composeId = match.composeId;
			item.serviceId = match.composeId ?? match.applicationId;
			item.appName =
				linkCandidates.find(
					(c) =>
						(c.composeId && c.composeId === match.composeId) ||
						(c.applicationId && c.applicationId === match.applicationId),
				)?.appName ?? item.appName;
			item.serviceName = `${match.serviceName} (DNS only)`;
			item.suggestedServiceName = match.matchedComposeService;
		}
	}

	items.sort((a, b) => a.host.localeCompare(b.host));
	return items;
};

const loadInventoryServiceCandidates = async (
	organizationId: string,
): Promise<InventoryServiceCandidate[]> => {
	const [appCandidates, composeCandidates] = await Promise.all([
		db
			.select({
				applicationId: applications.applicationId,
				projectId: projects.projectId,
				environmentId: environments.environmentId,
				displayName: applications.name,
				appName: applications.appName,
			})
			.from(applications)
			.innerJoin(
				environments,
				eq(applications.environmentId, environments.environmentId),
			)
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(eq(projects.organizationId, organizationId)),
		db
			.select({
				composeId: compose.composeId,
				projectId: projects.projectId,
				environmentId: environments.environmentId,
				displayName: compose.name,
				appName: compose.appName,
				composeFile: compose.composeFile,
				serviceNetworks: compose.serviceNetworks,
			})
			.from(compose)
			.innerJoin(
				environments,
				eq(compose.environmentId, environments.environmentId),
			)
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(eq(projects.organizationId, organizationId)),
	]);

	const candidates: InventoryServiceCandidate[] = [];

	for (const row of appCandidates) {
		candidates.push({
			kind: "application",
			applicationId: row.applicationId,
			composeId: null,
			projectId: row.projectId,
			environmentId: row.environmentId,
			displayName: row.displayName,
			appName: row.appName,
			composeServiceNames: [],
			hostnameHints: [],
			hostPublishingServices: [],
		});
	}

	for (const row of composeCandidates) {
		const hints = extractComposeMatchHints(row.composeFile ?? "");
		const networkNames = (row.serviceNetworks ?? [])
			.map((entry) => entry.serviceName)
			.filter(Boolean);
		const composeServiceNames = [
			...new Set([...hints.serviceNames, ...networkNames]),
		];
		candidates.push({
			kind: "compose",
			applicationId: null,
			composeId: row.composeId,
			projectId: row.projectId,
			environmentId: row.environmentId,
			displayName: row.displayName,
			appName: row.appName,
			composeServiceNames,
			hostnameHints: hints.hostnameHints,
			hostPublishingServices: hints.hostPublishingServices,
		});
	}

	return candidates;
};

/** @deprecated Use listDomainsInventory — kept name for call-site clarity. */
export const listDomainsInventoryLive = (
	organizationId: string,
): Promise<DomainInventoryItem[]> =>
	listDomainsInventory(organizationId, { includeLive: true });

export type DomainDnsRecordPreview = {
	cfRecordId: string;
	type: string;
	name: string;
	content: string;
	proxied: boolean;
	ttl: number;
	priority: number | null;
	managedBy: "app_domain" | "mail_stack" | "manual";
	lastSyncedAt: string | null;
};

export type DomainDnsRecordsResult = {
	domainId: string;
	host: string;
	zoneName: string | null;
	dnsProvider:
		| "none"
		| "cloudflare"
		| "digitalocean"
		| "hetzner"
		| "route53"
		| "gcloud"
		| "ns1"
		| "akamai";
	records: DomainDnsRecordPreview[];
};

const normalizeHostFqdn = (host: string) =>
	host.trim().toLowerCase().replace(/\.$/, "");

const mapDnsRecordPreview = (row: {
	cfRecordId: string;
	type: string;
	name: string;
	content: string;
	proxied: boolean;
	ttl: number;
	priority: number | null;
	managedBy: "app_domain" | "mail_stack" | "manual";
	lastSyncedAt: Date | string | null;
}): DomainDnsRecordPreview => ({
	cfRecordId: row.cfRecordId,
	type: row.type,
	name: row.name,
	content: row.content,
	proxied: row.proxied,
	ttl: row.ttl,
	priority: row.priority,
	managedBy: row.managedBy,
	lastSyncedAt: mapSyncIso(row.lastSyncedAt),
});

const dnsRecordSelect = {
	cfRecordId: cloudflareDnsRecord.cfRecordId,
	type: cloudflareDnsRecord.type,
	name: cloudflareDnsRecord.name,
	content: cloudflareDnsRecord.content,
	proxied: cloudflareDnsRecord.proxied,
	ttl: cloudflareDnsRecord.ttl,
	priority: cloudflareDnsRecord.priority,
	managedBy: cloudflareDnsRecord.managedBy,
	lastSyncedAt: cloudflareDnsRecord.lastSyncedAt,
} as const;

const loadMirroredDnsRecords = async (
	organizationId: string,
	host: string,
	cfDnsRecordId: string | null,
) => {
	const normalized = normalizeHostFqdn(host);
	const byName = await db
		.select(dnsRecordSelect)
		.from(cloudflareDnsRecord)
		.where(
			and(
				eq(cloudflareDnsRecord.organizationId, organizationId),
				eq(cloudflareDnsRecord.name, normalized),
			),
		);

	const byId =
		cfDnsRecordId &&
		!byName.some((row) => row.cfRecordId === cfDnsRecordId)
			? await db
					.select(dnsRecordSelect)
					.from(cloudflareDnsRecord)
					.where(
						and(
							eq(cloudflareDnsRecord.organizationId, organizationId),
							eq(cloudflareDnsRecord.cfRecordId, cfDnsRecordId),
						),
					)
			: [];

	const records = [...byName, ...byId].map(mapDnsRecordPreview);
	records.sort((a, b) => {
		const typeCmp = a.type.localeCompare(b.type);
		if (typeCmp !== 0) return typeCmp;
		return a.name.localeCompare(b.name);
	});
	return records;
};

/**
 * Read-only Cloudflare DNS mirror rows for a domain (A/CNAME + sync metadata).
 * Prefers `cloudflare_dns_record` — no parallel store.
 */
export const listDomainDnsRecords = async (
	organizationId: string,
	domainId: string,
): Promise<DomainDnsRecordsResult> => {
	if (domainId === "web-server") {
		const webSettings = await getWebServerSettings();
		const host = webSettings?.host?.trim() || "";
		const records = host
			? await loadMirroredDnsRecords(organizationId, host, null)
			: [];

		return {
			domainId,
			host,
			zoneName: null,
			dnsProvider: records.length ? "cloudflare" : "none",
			records,
		};
	}

	const [appOwned] = await db
		.select({
			domainId: domains.domainId,
			host: domains.host,
			dnsProvider: domains.dnsProvider,
			cfZoneName: domains.cfZoneName,
			cfDnsRecordId: domains.cfDnsRecordId,
		})
		.from(domains)
		.innerJoin(
			applications,
			eq(domains.applicationId, applications.applicationId),
		)
		.innerJoin(
			environments,
			eq(applications.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(
				eq(domains.domainId, domainId),
				eq(projects.organizationId, organizationId),
			),
		)
		.limit(1);

	const [composeOwned] = appOwned
		? [undefined]
		: await db
				.select({
					domainId: domains.domainId,
					host: domains.host,
					dnsProvider: domains.dnsProvider,
					cfZoneName: domains.cfZoneName,
					cfDnsRecordId: domains.cfDnsRecordId,
				})
				.from(domains)
				.innerJoin(compose, eq(domains.composeId, compose.composeId))
				.innerJoin(
					environments,
					eq(compose.environmentId, environments.environmentId),
				)
				.innerJoin(projects, eq(environments.projectId, projects.projectId))
				.where(
					and(
						eq(domains.domainId, domainId),
						eq(projects.organizationId, organizationId),
					),
				)
				.limit(1);

	const [previewOwned] =
		appOwned || composeOwned
			? [undefined]
			: await db
					.select({
						domainId: domains.domainId,
						host: domains.host,
						dnsProvider: domains.dnsProvider,
						cfZoneName: domains.cfZoneName,
						cfDnsRecordId: domains.cfDnsRecordId,
					})
					.from(domains)
					.innerJoin(
						previewDeployments,
						eq(
							domains.previewDeploymentId,
							previewDeployments.previewDeploymentId,
						),
					)
					.innerJoin(
						applications,
						eq(previewDeployments.applicationId, applications.applicationId),
					)
					.innerJoin(
						environments,
						eq(applications.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(
						and(
							eq(domains.domainId, domainId),
							eq(projects.organizationId, organizationId),
						),
					)
					.limit(1);

	const owned = appOwned ?? composeOwned ?? previewOwned;
	if (!owned) {
		throw new Error("Domain not found in organization inventory");
	}

	const records = await loadMirroredDnsRecords(
		organizationId,
		owned.host,
		owned.cfDnsRecordId,
	);

	return {
		domainId: owned.domainId,
		host: owned.host,
		zoneName: owned.cfZoneName,
		dnsProvider: owned.dnsProvider,
		records,
	};
};
