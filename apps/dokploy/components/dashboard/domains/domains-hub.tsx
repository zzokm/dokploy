"use client";

import { formatDistanceToNow } from "date-fns";
import {
	ChevronDown,
	Cloud,
	FolderOpen,
	Globe2,
	KeyRound,
	Link2,
	ListTree,
	Loader2,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const statusVariant = (status: "active" | "pending" | "disabled") => {
	if (status === "active") return "default";
	if (status === "pending") return "secondary";
	return "outline";
};

const ConnectDnsProviderEmpty = ({
	tokenInput,
	setTokenInput,
	onConnect,
	isLoading,
}: {
	tokenInput: string;
	setTokenInput: (value: string) => void;
	onConnect: () => void;
	isLoading: boolean;
}) => (
	<div className="mx-auto flex w-full max-w-lg flex-col gap-8 py-4">
		<div className="flex flex-col items-center gap-3 text-center">
			<div className="flex size-14 items-center justify-center rounded-xl border border-border bg-muted/40">
				<Cloud className="size-7 text-muted-foreground" aria-hidden />
			</div>
			<div className="space-y-1.5">
				<p className="text-base font-medium text-foreground">
					Connect a DNS provider
				</p>
				<p className="text-sm leading-relaxed text-muted-foreground">
					Import DNS domains and automate A records for applications, compose
					services, and the web server.
				</p>
			</div>
		</div>

		<ol className="space-y-3 text-sm">
			<li className="flex gap-3 rounded-lg border bg-sidebar/60 p-3">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
					<KeyRound className="size-4 text-muted-foreground" aria-hidden />
				</span>
				<div className="min-w-0 space-y-0.5">
					<p className="font-medium">1. Create an API token</p>
					<p className="text-xs text-muted-foreground">
						For Cloudflare: Zone → Zone → Read and Zone → DNS → Edit. Other
						providers use their DNS token scopes.
					</p>
				</div>
			</li>
			<li className="flex gap-3 rounded-lg border bg-sidebar/60 p-3">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
					<Link2 className="size-4 text-muted-foreground" aria-hidden />
				</span>
				<div className="min-w-0 space-y-0.5">
					<p className="font-medium">2. Connect here</p>
					<p className="text-xs text-muted-foreground">
						Paste the token below. We store it sealed and sync your DNS domains.
					</p>
				</div>
			</li>
			<li className="flex gap-3 rounded-lg border bg-sidebar/60 p-3">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
					<FolderOpen className="size-4 text-muted-foreground" aria-hidden />
				</span>
				<div className="min-w-0 space-y-0.5">
					<p className="font-medium">3. Attach from a project</p>
					<p className="text-xs text-muted-foreground">
						Open a service Domains tab and add a hostname under a synced DNS
						domain.
					</p>
				</div>
			</li>
		</ol>

		<div className="space-y-3">
			<div className="space-y-2">
				<Label htmlFor="cf-token">Cloudflare API token</Label>
				<Input
					id="cf-token"
					value={tokenInput}
					onChange={(e) => setTokenInput(e.target.value)}
					placeholder="Paste API token"
					autoComplete="off"
					className="font-mono text-sm"
				/>
			</div>
			<Button
				type="button"
				isLoading={isLoading}
				onClick={onConnect}
				className="w-full sm:w-auto"
			>
				Connect Cloudflare
			</Button>
			<p className="text-xs leading-relaxed text-muted-foreground">
				Add DigitalOcean / Hetzner from Web Server → DNS providers. Cloudflare
				managed DNS always uses CDN proxy + DNS-01.
			</p>
		</div>
	</div>
);

const ConnectedNoAppDomainsEmpty = ({
	zoneCount,
}: {
	zoneCount: number;
}) => (
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
	const [tokenInput, setTokenInput] = useState("");
	const [expandedZoneIds, setExpandedZoneIds] = useState<string[]>([]);
	const { data: settings } = api.cloudflareSettings.get.useQuery();
	const { data: vaultCreds } = api.dnsProviders.list.useQuery();
	const { data: inventory, isPending: inventoryPending } =
		api.domain.listInventory.useQuery();
	const { data: cfZones, refetch: refetchCfZones, isPending: cfZonesPending } =
		api.cloudflareSettings.listZones.useQuery(undefined, {
			enabled: !!settings?.connected,
		});
	const {
		data: mirroredZones,
		refetch: refetchMirrored,
		isPending: mirroredPending,
	} = api.dnsProviders.listZones.useQuery(undefined, {
		enabled: (vaultCreds?.length ?? 0) > 0 || !!settings?.connected,
	});

	const hasAnyProvider =
		!!settings?.connected || (vaultCreds?.length ?? 0) > 0;

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
			}
		>();

		for (const z of mirroredZones ?? []) {
			const key = `${z.provider}:${z.zoneExternalId}`;
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
			});
		}

		// CF legacy table may have zones before vault mirror is populated
		for (const z of cfZones ?? []) {
			const key = `cloudflare:${z.cfZoneId}`;
			if (!byKey.has(key)) {
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
				});
			}
		}

		return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
	}, [mirroredZones, cfZones]);

	const setToken = api.cloudflareSettings.setToken.useMutation({
		onSuccess: async (result) => {
			toast.success("Cloudflare connected, syncing DNS domains…");
			if (result.validation?.warning) {
				toast.message(result.validation.warning);
			}
			setTokenInput("");
			await utils.cloudflareSettings.get.invalidate();
			await utils.cloudflareSettings.listZones.invalidate();
			await utils.dnsProviders.listZones.invalidate();
			await utils.dnsProviders.list.invalidate();
			await utils.domain.listInventory.invalidate();
			await refetchCfZones();
			await refetchMirrored();
		},
		onError: (e) => toast.error(e.message),
	});

	const syncCfZones = api.cloudflareSettings.syncZones.useMutation();
	const syncVaultZones = api.dnsProviders.syncZones.useMutation();

	const syncZones = {
		isPending: syncCfZones.isPending || syncVaultZones.isPending,
		mutate: () => {
			void (async () => {
				try {
					if (settings?.connected) {
						await syncCfZones.mutateAsync();
					}
					if ((vaultCreds?.length ?? 0) > 0) {
						await syncVaultZones.mutateAsync({});
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

	const handleConnect = () => {
		const token = tokenInput.trim();
		if (!token) {
			toast.error("API token is required");
			return;
		}
		setToken.mutate({ apiToken: token });
	};

	const provisionedCount =
		inventory?.filter((row) => row.kind !== "web-server").length ?? 0;
	const hasInventory = (inventory?.length ?? 0) > 0;
	const zoneCount = zones.length;
	const zonesPending = cfZonesPending || mirroredPending;
	const showConnectedThinEmpty =
		!inventoryPending && provisionedCount === 0 && zoneCount > 0;

	const lastSyncedAt = useMemo(() => {
		return latestSyncIso([
			settings?.updatedAt ?? null,
			...zones.map((z) =>
				z.lastSyncedAt
					? z.lastSyncedAt instanceof Date
						? z.lastSyncedAt.toISOString()
						: String(z.lastSyncedAt)
					: null,
			),
			...(inventory?.map((row) => row.lastSyncedAt) ?? []),
		]);
	}, [settings?.updatedAt, zones, inventory]);

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
							{inventoryPending ? (
								<div className="flex min-h-[12vh] items-center justify-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" aria-hidden />
									Loading…
								</div>
							) : hasInventory ? (
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

							<ConnectDnsProviderEmpty
								tokenInput={tokenInput}
								setTokenInput={setTokenInput}
								onConnect={handleConnect}
								isLoading={setToken.isPending}
							/>
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
								{settings?.apiTokenLast4
									? ` · Managed DNS ****${settings.apiTokenLast4}`
									: ""}
								<span className="text-muted-foreground"> · {lastSyncedLabel}</span>
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
									Every hostname provisioned in this organization.
								</p>
							</div>
							{showConnectedThinEmpty ? (
								<div className="space-y-6">
									<ConnectedNoAppDomainsEmpty zoneCount={zoneCount} />
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
							{zonesPending ? (
								<div className="flex min-h-[12vh] w-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground sm:flex-row">
									<Loader2 className="size-5 animate-spin" aria-hidden />
									<span>Loading DNS domains…</span>
								</div>
							) : !zones?.length ? (
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
									{zones.map((z, index) => {
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
