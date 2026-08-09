"use client";

import { formatDistanceToNow } from "date-fns";
import {
	ChevronDown,
	Cloud,
	Globe2,
	ListTree,
	Loader2,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	type CachedDnsZone,
	type DnsDomainsCachePayload,
	readDnsDomainsCache,
	serializeHubZones,
	writeDnsDomainsCache,
} from "@/components/dashboard/domains/dns-domains-cache";
import { DnsProviderOnboarding } from "@/components/dashboard/domains/dns-provider-onboarding";
import { latestSyncIso } from "@/components/dashboard/domains/domain-inventory-utils";
import { DomainsInventoryTable } from "@/components/dashboard/domains/domains-inventory-table";
import { ZoneDnsRecordsPanel } from "@/components/dashboard/domains/zone-dns-records-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const statusVariant = (status: "active" | "pending" | "disabled") => {
	if (status === "active") return "default";
	if (status === "pending") return "secondary";
	return "outline";
};

const ConnectedNoAppDomainsEmpty = ({ zoneCount }: { zoneCount: number }) => (
	<div className="flex min-h-[22vh] flex-col items-center justify-center gap-4 px-2 text-center">
		<div className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted/40">
			<Globe2 className="size-6 text-muted-foreground" aria-hidden />
		</div>
		<div className="max-w-md space-y-1.5">
			<p className="text-sm font-medium text-foreground">
				Synced {zoneCount} DNS domain{zoneCount === 1 ? "" : "s"}. Attach one
				from a project.
			</p>
			<p className="text-xs leading-relaxed text-muted-foreground">
				Synced DNS domains are ready. Open any application or compose service,
				go to Domains, and add a hostname with Managed DNS enabled.
			</p>
		</div>
		<Button type="button" variant="secondary" asChild>
			<Link href="/dashboard/projects">Go to projects</Link>
		</Button>
	</div>
);

export const DomainsHub = () => {
	const utils = api.useUtils();
	const [expandedZoneIds, setExpandedZoneIds] = useState<string[]>([]);
	const [domainsCache, setDomainsCache] =
		useState<DnsDomainsCachePayload | null>(null);
	const { data: sessionData } = api.user.session.useQuery();
	const orgId = sessionData?.session.activeOrganizationId ?? null;
	const { data: settings } = api.cloudflareSettings.get.useQuery();
	const { data: vaultCreds } = api.dnsProviders.list.useQuery();
	const { data: inventory, isPending: inventoryPending } =
		api.domain.listInventory.useQuery();
	const {
		data: cfZones,
		refetch: refetchCfZones,
		isPending: cfZonesPending,
	} = api.cloudflareSettings.listZones.useQuery(undefined, {
		enabled: !!settings?.connected && (vaultCreds?.length ?? 0) === 0,
	});
	const {
		data: mirroredZones,
		refetch: refetchMirrored,
		isPending: mirroredPending,
	} = api.dnsProviders.listZones.useQuery(undefined, {
		enabled: (vaultCreds?.length ?? 0) > 0 || !!settings?.connected,
	});

	const credentialLabelById = useMemo(() => {
		const map = new Map<string, string>();
		for (const c of vaultCreds ?? []) {
			map.set(c.id, c.label);
		}
		return map;
	}, [vaultCreds]);

	useEffect(() => {
		if (!orgId) {
			setDomainsCache(null);
			return;
		}
		setDomainsCache(readDnsDomainsCache(orgId));
	}, [orgId]);

	const providersResolved = settings !== undefined && vaultCreds !== undefined;
	const liveHasProvider =
		!!settings?.connected || (vaultCreds?.length ?? 0) > 0;
	const hasAnyProvider = providersResolved
		? liveHasProvider
		: Boolean(domainsCache?.hasProvider);

	const zones = useMemo(() => {
		const byKey = new Map<
			string,
			{
				key: string;
				provider: string;
				zoneExternalId: string;
				cfZoneId: string;
				name: string;
				status: "active" | "pending" | "disabled";
				paused: boolean;
				lastSyncedAt: Date | string | null;
				credentialId: string | null;
				credentialLabel: string | null;
			}
		>();

		for (const z of mirroredZones ?? []) {
			const key = `${z.provider}:${z.credentialId ?? "none"}:${z.zoneExternalId}`;
			byKey.set(key, {
				key,
				provider: z.provider,
				zoneExternalId: z.zoneExternalId,
				cfZoneId: z.zoneExternalId,
				name: z.name,
				status: z.status,
				paused: z.paused,
				lastSyncedAt: z.lastSyncedAt,
				credentialId: z.credentialId,
				credentialLabel:
					z.credentialLabel ??
					(z.credentialId
						? (credentialLabelById.get(z.credentialId) ?? null)
						: null),
			});
		}

		// CF legacy table may have zones before vault mirror is populated
		for (const z of cfZones ?? []) {
			const key = `cloudflare:legacy:${z.cfZoneId}`;
			if (![...byKey.values()].some((e) => e.zoneExternalId === z.cfZoneId)) {
				byKey.set(key, {
					key,
					provider: "cloudflare",
					zoneExternalId: z.cfZoneId,
					cfZoneId: z.cfZoneId,
					name: z.name,
					status: z.status,
					paused: z.paused,
					lastSyncedAt: z.lastSyncedAt,
					credentialId: null,
					credentialLabel: "Default",
				});
			}
		}

		return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
	}, [mirroredZones, cfZones, credentialLabelById]);

	const accountSubtitle = useMemo(() => {
		if (!vaultCreds?.length) {
			return settings?.apiTokenLast4
				? ` · Managed DNS ****${settings.apiTokenLast4}`
				: "";
		}
		if (vaultCreds.length === 1) {
			const c = vaultCreds[0]!;
			return ` · ${c.label} ****${c.secretLast4}`;
		}
		return ` · ${vaultCreds.length} DNS accounts`;
	}, [vaultCreds, settings?.apiTokenLast4]);

	useEffect(() => {
		if (!orgId || !providersResolved) return;

		if (!liveHasProvider) {
			const written = writeDnsDomainsCache(orgId, {
				hasProvider: false,
				zones: [],
			});
			if (written) setDomainsCache(written);
			return;
		}

		const cfEnabled = !!settings?.connected;
		const mirroredEnabled =
			(vaultCreds?.length ?? 0) > 0 || !!settings?.connected;
		const cfReady = !cfEnabled || !cfZonesPending;
		const mirroredReady = !mirroredEnabled || !mirroredPending;
		if (!cfReady || !mirroredReady) return;

		const written = writeDnsDomainsCache(orgId, {
			hasProvider: true,
			zones: serializeHubZones(zones),
		});
		if (written) setDomainsCache(written);
	}, [
		orgId,
		providersResolved,
		liveHasProvider,
		settings?.connected,
		vaultCreds?.length,
		cfZonesPending,
		mirroredPending,
		zones,
	]);

	const syncCfZones = api.cloudflareSettings.syncZones.useMutation();
	const syncVaultZones = api.dnsProviders.syncZones.useMutation();

	const syncZones = {
		isPending: syncCfZones.isPending || syncVaultZones.isPending,
		mutate: () => {
			void (async () => {
				try {
					if ((vaultCreds?.length ?? 0) > 0) {
						await syncVaultZones.mutateAsync({});
					} else if (settings?.connected) {
						await syncCfZones.mutateAsync();
					}
					toast.success("DNS domains synced");
					await refetchCfZones();
					await refetchMirrored();
					await utils.dnsProviders.listZones.invalidate();
				} catch (e) {
					toast.error(
						e instanceof Error ? e.message : "Failed to sync DNS domains",
					);
				}
			})();
		},
	};

	const syncDns = api.cloudflareSettings.syncDns.useMutation({
		onSuccess: async (data) => {
			const applied = data.appDns.applied.length;
			const errors = data.appDns.errors.length;
			if (applied) {
				toast.success(
					`Updated DNS for ${applied} domain${applied === 1 ? "" : "s"}`,
				);
			} else {
				toast.success("DNS already up to date");
			}
			if (errors) {
				toast.error(`${errors} domain(s) could not be updated`);
			}
			await utils.cloudflareSettings.previewAppDns.invalidate();
			await utils.cloudflareSettings.previewAppDnsForDomain.invalidate();
			await utils.cloudflareSettings.listZones.invalidate();
			await utils.dnsProviders.listZones.invalidate();
			await utils.domain.byApplicationId.invalidate();
			await utils.domain.byComposeId.invalidate();
			await utils.domain.listInventory.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const toggleZoneRecords = (zoneKey: string) => {
		setExpandedZoneIds((prev) =>
			prev.includes(zoneKey)
				? prev.filter((id) => id !== zoneKey)
				: [...prev, zoneKey],
		);
	};

	const provisionedCount = inventory?.length ?? 0;
	const hasInventory = provisionedCount > 0;
	const zonesPending = cfZonesPending || mirroredPending;
	const hasZonesCache = Boolean(domainsCache?.hasProvider);
	const showZonesLoading = zonesPending && !hasZonesCache;
	const displayZones: CachedDnsZone[] = !zonesPending
		? serializeHubZones(zones)
		: (domainsCache?.zones ?? []);
	const displayZoneCount = !zonesPending ? zones.length : displayZones.length;
	const showConnectedThinEmpty =
		!inventoryPending &&
		provisionedCount === 0 &&
		displayZoneCount > 0 &&
		!zonesPending;

	const lastSyncedAt = useMemo(() => {
		const zoneSyncSources = (!zonesPending ? zones : displayZones).map((z) =>
			z.lastSyncedAt
				? z.lastSyncedAt instanceof Date
					? z.lastSyncedAt.toISOString()
					: String(z.lastSyncedAt)
				: null,
		);
		return latestSyncIso([
			settings?.updatedAt ?? null,
			...zoneSyncSources,
			...(inventory?.map((row) => row.lastSyncedAt) ?? []),
		]);
	}, [settings?.updatedAt, zones, displayZones, zonesPending, inventory]);

	const lastSyncedLabel = lastSyncedAt
		? `Last synced ${formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })}`
		: "Not synced yet";

	if (!hasAnyProvider) {
		return (
			<div className="flex w-full flex-col gap-4">
				<Card className="mx-auto h-full w-full max-w-5xl rounded-xl bg-sidebar p-2.5">
					<div className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-xl bg-background shadow-md duration-300">
						<CardHeader className="space-y-3">
							<CardTitle className="flex flex-row gap-2 text-xl">
								<Globe2 className="size-6 shrink-0 self-center text-muted-foreground" />
								Domains
							</CardTitle>
							<CardDescription>
								Connect a DNS provider to import DNS domains and automate DNS
								for your applications.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-8 border-t py-8 sm:py-10">
							{hasInventory ? (
								<section className="space-y-3">
									<div className="space-y-1">
										<h3 className="text-sm font-medium">All domains</h3>
										<p className="text-xs text-muted-foreground">
											Hostnames already attached in projects (DNS not automated
											yet).
										</p>
									</div>
									<DomainsInventoryTable />
								</section>
							) : null}

							<DnsProviderOnboarding />
						</CardContent>
					</div>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex w-full flex-col gap-4">
			<Card className="mx-auto h-full w-full max-w-5xl rounded-xl bg-sidebar p-2.5">
				<div className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-xl bg-background shadow-md duration-300">
					<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
						<div className="min-w-0 space-y-1">
							<CardTitle className="flex flex-row gap-2 text-xl">
								<Globe2 className="size-6 shrink-0 self-center text-muted-foreground" />
								Domains
							</CardTitle>
							<CardDescription className="break-words">
								All hostnames across apps, compose, and the web server
								{accountSubtitle}
								<span className="text-muted-foreground">
									{" "}
									· {lastSyncedLabel}
								</span>
							</CardDescription>
						</div>
						<div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
							<Button
								type="button"
								variant="default"
								className="w-full sm:w-auto"
								isLoading={syncDns.isPending}
								onClick={() => syncDns.mutate()}
							>
								<ShieldCheck className="mr-2 size-4" aria-hidden />
								Sync all
							</Button>
							<Button
								type="button"
								variant="secondary"
								className="w-full sm:w-auto"
								isLoading={syncZones.isPending}
								onClick={() => syncZones.mutate()}
							>
								<RefreshCw className="mr-2 size-4" aria-hidden />
								Sync DNS domains
							</Button>
						</div>
					</CardHeader>
					<CardContent className="space-y-8 border-t py-8">
						<section className="space-y-3">
							<div className="space-y-1">
								<h3 className="text-sm font-medium">All domains</h3>
								<p className="text-xs text-muted-foreground">
									Every application, compose, preview, web-server, and DNS
									hostname in this organization. Nothing is hidden as inner or
									backend.
								</p>
							</div>
							{showConnectedThinEmpty ? (
								<div className="space-y-6">
									<ConnectedNoAppDomainsEmpty zoneCount={displayZoneCount} />
									{hasInventory ? <DomainsInventoryTable /> : null}
								</div>
							) : (
								<DomainsInventoryTable />
							)}
						</section>

						<section className="space-y-3 border-t pt-6">
							<div className="space-y-1">
								<h3 className="text-sm font-medium">DNS Domains</h3>
								<p className="text-xs text-muted-foreground">
									Imported DNS domains available for managed DNS automation.
								</p>
							</div>
							{showZonesLoading ? (
								<div className="flex min-h-[12vh] w-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground sm:flex-row">
									<Loader2 className="size-5 animate-spin" aria-hidden />
									<span>Loading DNS domains…</span>
								</div>
							) : !displayZones.length ? (
								<div className="flex min-h-[12vh] w-full flex-col items-center justify-center gap-3 px-2 text-center">
									<Cloud className="size-8 text-muted-foreground" aria-hidden />
									<span className="max-w-md text-sm text-muted-foreground">
										No DNS domains imported yet. Sync from your DNS provider to
										get started.
									</span>
									<Button
										type="button"
										variant="secondary"
										isLoading={syncZones.isPending}
										onClick={() => syncZones.mutate()}
									>
										<RefreshCw className="mr-2 size-4" aria-hidden />
										Sync DNS domains
									</Button>
								</div>
							) : (
								<div className="flex w-full flex-col gap-2">
									{displayZones.map((z, index) => {
										const expanded = expandedZoneIds.includes(z.key);
										const panelId = `zone-records-${z.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
										return (
											<div
												key={z.key}
												className="w-full animate-in fade-in-0 slide-in-from-bottom-1 rounded-lg bg-sidebar p-1 duration-300 fill-mode-both"
												style={{
													animationDelay: `${Math.min(index, 8) * 40}ms`,
												}}
											>
												<div className="w-full overflow-hidden rounded-lg border bg-background">
													<div className="flex flex-col gap-3 p-3 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
														<div className="flex min-w-0 flex-col gap-1">
															<span className="truncate text-sm font-medium">
																{z.name}
															</span>
															<span className="text-xs text-muted-foreground">
																{z.provider}
																{z.credentialLabel
																	? ` · ${z.credentialLabel}`
																	: ""}
																{z.provider === "cloudflare"
																	? " · CDN proxy on (policy)"
																	: " · managed DNS"}
															</span>
														</div>
														<div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
															<Badge variant="outline">{z.provider}</Badge>
															<Badge variant={statusVariant(z.status)}>
																{z.status}
															</Badge>
															{z.paused ? (
																<Badge variant="outline">paused</Badge>
															) : null}
															<Button
																type="button"
																variant="secondary"
																size="sm"
																className="h-8"
																aria-expanded={expanded}
																aria-controls={panelId}
																onClick={() => toggleZoneRecords(z.key)}
															>
																<ListTree
																	className="mr-1.5 size-3.5"
																	aria-hidden
																/>
																Records
																<ChevronDown
																	className={cn(
																		"ml-1.5 size-3.5 transition-transform duration-200",
																		expanded && "rotate-180",
																	)}
																	aria-hidden
																/>
															</Button>
														</div>
													</div>
													{expanded ? (
														<ZoneDnsRecordsPanel
															id={panelId}
															cfZoneId={z.cfZoneId}
															zoneName={z.name}
															provider={z.provider}
															credentialId={z.credentialId}
														/>
													) : null}
												</div>
											</div>
										);
									})}
								</div>
							)}
						</section>
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
