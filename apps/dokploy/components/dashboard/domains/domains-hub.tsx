"use client";

import { Cloud, Globe2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DomainsInventoryTable } from "@/components/dashboard/domains/domains-inventory-table";
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
import { api } from "@/utils/api";

const statusVariant = (status: "active" | "pending" | "disabled") => {
	if (status === "active") return "default";
	if (status === "pending") return "secondary";
	return "outline";
};

export const DomainsHub = () => {
	const utils = api.useUtils();
	const [tokenInput, setTokenInput] = useState("");
	const { data: settings } = api.cloudflareSettings.get.useQuery();
	const { data: zones, refetch, isPending: zonesPending } =
		api.cloudflareSettings.listZones.useQuery(undefined, {
			enabled: !!settings?.connected,
		});

	const setToken = api.cloudflareSettings.setToken.useMutation({
		onSuccess: async () => {
			toast.success("Cloudflare connected — syncing domains…");
			setTokenInput("");
			await utils.cloudflareSettings.get.invalidate();
			await utils.cloudflareSettings.listZones.invalidate();
			await utils.domain.listInventory.invalidate();
			await refetch();
		},
		onError: (e) => toast.error(e.message),
	});

	const syncZones = api.cloudflareSettings.syncZones.useMutation({
		onSuccess: async () => {
			toast.success("Domains synced");
			await refetch();
		},
		onError: (e) => toast.error(e.message),
	});

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
			await utils.domain.byApplicationId.invalidate();
			await utils.domain.byComposeId.invalidate();
			await utils.domain.listInventory.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const handleConnect = () => {
		const token = tokenInput.trim();
		if (!token) {
			toast.error("API token is required");
			return;
		}
		setToken.mutate({ apiToken: token });
	};

	if (!settings?.connected) {
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
								Inventory of every hostname across your projects. Connect
								Cloudflare to automate DNS.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-8 border-t py-8 sm:py-10">
							<DomainsInventoryTable />

							<div className="mx-auto flex w-full max-w-md flex-col gap-6 border-t pt-8">
								<div className="flex flex-col items-center gap-3 text-center">
									<div className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted/40">
										<Cloud
											className="size-6 text-muted-foreground"
											aria-hidden
										/>
									</div>
									<div className="space-y-1">
										<p className="text-sm font-medium text-foreground">
											Connect Cloudflare
										</p>
										<p className="text-xs leading-relaxed text-muted-foreground">
											Paste a scoped API token. Domains sync after connect; app
											domains can then update A records automatically.
										</p>
									</div>
								</div>

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
									isLoading={setToken.isPending}
									onClick={handleConnect}
									className="w-full sm:w-auto"
								>
									Connect Cloudflare
								</Button>
								<p className="text-xs leading-relaxed text-muted-foreground">
									Required permissions:{" "}
									<span className="font-medium text-foreground">Zone Read</span>{" "}
									and{" "}
									<span className="font-medium text-foreground">DNS Write</span>
								</p>
							</div>
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
								All hostnames across apps, compose, and the web server ·
								Cloudflare ****{settings.apiTokenLast4}
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
								Sync DNS
							</Button>
							<Button
								type="button"
								variant="secondary"
								className="w-full sm:w-auto"
								isLoading={syncZones.isPending}
								onClick={() => syncZones.mutate()}
							>
								<RefreshCw className="mr-2 size-4" aria-hidden />
								Sync domains
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
							<DomainsInventoryTable />
						</section>

						<section className="space-y-3 border-t pt-6">
							<div className="space-y-1">
								<h3 className="text-sm font-medium">Cloudflare account</h3>
								<p className="text-xs text-muted-foreground">
									Imported zones available for DNS automation.
								</p>
							</div>
							{zonesPending ? (
								<div className="flex min-h-[12vh] w-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground sm:flex-row">
									<Loader2 className="size-5 animate-spin" aria-hidden />
									<span>Loading Cloudflare domains…</span>
								</div>
							) : !zones?.length ? (
								<div className="flex min-h-[12vh] w-full flex-col items-center justify-center gap-3 px-2 text-center">
									<Cloud className="size-8 text-muted-foreground" aria-hidden />
									<span className="max-w-md text-sm text-muted-foreground">
										No domains imported yet. Sync domains from your Cloudflare
										account to get started.
									</span>
									<Button
										type="button"
										variant="secondary"
										isLoading={syncZones.isPending}
										onClick={() => syncZones.mutate()}
									>
										<RefreshCw className="mr-2 size-4" aria-hidden />
										Sync domains
									</Button>
								</div>
							) : (
								<div className="flex w-full flex-col gap-2">
									{zones.map((z, index) => (
										<div
											key={z.cfZoneId}
											className="flex w-full animate-in fade-in-0 slide-in-from-bottom-1 items-center justify-between rounded-lg bg-sidebar p-1 duration-300 fill-mode-both"
											style={{
												animationDelay: `${Math.min(index, 8) * 40}ms`,
											}}
										>
											<div className="flex w-full items-center justify-between rounded-lg border bg-background p-3 transition-colors hover:bg-muted/20">
												<div className="flex min-w-0 flex-col gap-1">
													<span className="truncate text-sm font-medium">
														{z.name}
													</span>
													<span className="text-xs text-muted-foreground">
														Proxy managed per application domain
													</span>
												</div>
												<div className="ml-3 flex shrink-0 flex-wrap items-center justify-end gap-2">
													<Badge variant={statusVariant(z.status)}>
														{z.status}
													</Badge>
													{z.paused ? (
														<Badge variant="outline">paused</Badge>
													) : null}
												</div>
											</div>
										</div>
									))}
								</div>
							)}
						</section>
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
