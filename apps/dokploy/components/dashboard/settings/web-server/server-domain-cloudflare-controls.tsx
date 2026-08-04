"use client"

import { ArrowRight, Cloud, Loader2 } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { api } from "@/utils/api"

type ServerDomainCloudflareControlsProps = {
	/** Saved host from web server settings (empty if none). */
	savedHost: string
	/** Current form host value (may differ before save). */
	formHost: string
}

export const ServerDomainCloudflareControls = ({
	savedHost,
	formHost,
}: ServerDomainCloudflareControlsProps) => {
	const utils = api.useUtils()
	const { data: settings } = api.cloudflareSettings.get.useQuery()
	const [syncOpen, setSyncOpen] = useState(false)
	const [proxied, setProxied] = useState(true)

	const host = savedHost.trim()
	const formMatchesSaved =
		formHost.trim().toLowerCase() === host.toLowerCase() && !!host
	const isConnected = !!settings?.connected

	const previewQuery = api.cloudflareSettings.previewServerDomainDns.useQuery(
		undefined,
		{ enabled: isConnected && !!host },
	)

	useEffect(() => {
		if (previewQuery.data?.desiredProxied !== undefined) {
			setProxied(previewQuery.data.desiredProxied)
		} else if (previewQuery.data?.currentProxied !== null && previewQuery.data?.currentProxied !== undefined) {
			setProxied(previewQuery.data.currentProxied)
		}
	}, [previewQuery.data])

	const applyMutation = api.cloudflareSettings.applyServerDomainDns.useMutation({
		onSuccess: async () => {
			toast.success("Server domain DNS updated")
			await utils.cloudflareSettings.previewServerDomainDns.invalidate()
			setSyncOpen(false)
		},
		onError: (e) => toast.error(e.message),
	})

	const handleProxiedChange = (checked: boolean) => {
		const previous = proxied
		setProxied(checked)
		if (!isConnected || !formMatchesSaved) {
			return
		}
		applyMutation.mutate(
			{ proxied: checked },
			{
				onError: () => setProxied(previous),
			},
		)
	}

	const statusLabel = !isConnected
		? "Not connected"
		: !host
			? "Save a domain first"
			: !formMatchesSaved
				? "Save domain to sync DNS"
				: previewQuery.data?.state === "ok"
					? "DNS up to date"
					: previewQuery.data?.state === "no_zone"
						? "No matching zone"
						: previewQuery.data?.state === "missing" ||
								previewQuery.data?.state === "drift"
							? "DNS needs sync"
							: "Ready"

	return (
		<>
			<ServerDomainCloudflareSyncDialog
				open={syncOpen}
				onOpenChange={setSyncOpen}
				proxied={proxied}
			/>
			<div className="col-span-2 flex w-full animate-in fade-in-0 slide-in-from-bottom-1 flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3.5 duration-300 sm:flex-row sm:items-start">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
					<Cloud className="size-4 text-muted-foreground" aria-hidden />
				</div>
				<div className="min-w-0 flex-1 space-y-3">
					<div className="space-y-1">
						<p className="text-sm font-medium leading-none">Cloudflare DNS</p>
						<p className="text-xs leading-relaxed text-muted-foreground">
							Point an A record at this Dokploy server and control orange-cloud
							proxying when Cloudflare is connected.
						</p>
					</div>

					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<Badge variant="outline" className="w-fit text-[11px]">
							{statusLabel}
						</Badge>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="w-full shrink-0 transition-colors sm:w-auto"
							disabled={!isConnected || !formMatchesSaved}
							onClick={() => setSyncOpen(true)}
						>
							Sync DNS
						</Button>
					</div>

					{!isConnected ? (
						<p className="text-xs text-muted-foreground">
							Connect Cloudflare below (DNS providers) or on the{" "}
							<Link
								href="/dashboard/domains"
								className="text-foreground underline underline-offset-2"
							>
								Domains
							</Link>{" "}
							page.
						</p>
					) : (
						<div className="flex flex-col gap-3 rounded-md border border-border bg-background px-3 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0 space-y-0.5">
								<p className="text-sm font-medium">Proxy (orange cloud)</p>
								<p className="text-xs text-muted-foreground">
									Recommended when using HTTPS. Uses Traefik DNS-01 via{" "}
									<span className="font-mono">letsencrypt-cloudflare</span>.
								</p>
							</div>
							<div className="flex items-center justify-between gap-3 sm:min-w-[9rem] sm:justify-end">
								<span className="text-xs text-muted-foreground sm:order-first">
									{proxied ? "Proxied" : "DNS only"}
								</span>
								<Switch
									checked={proxied}
									onCheckedChange={handleProxiedChange}
									disabled={
										!formMatchesSaved ||
										applyMutation.isPending ||
										!isConnected
									}
									aria-label="Cloudflare proxy enabled"
								/>
							</div>
						</div>
					)}
				</div>
			</div>
		</>
	)
}

type SyncDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	proxied: boolean
}

const ServerDomainCloudflareSyncDialog = ({
	open,
	onOpenChange,
	proxied,
}: SyncDialogProps) => {
	const utils = api.useUtils()
	const { data: preview, isFetching } =
		api.cloudflareSettings.previewServerDomainDns.useQuery(undefined, {
			enabled: open,
		})

	const apply = api.cloudflareSettings.applyServerDomainDns.useMutation({
		onSuccess: async () => {
			toast.success("Server domain DNS updated")
			await utils.cloudflareSettings.previewServerDomainDns.invalidate()
			onOpenChange(false)
		},
		onError: (e) => toast.error(e.message),
	})

	const current = preview?.currentIp ?? "—"
	const desired = preview?.desiredIp ?? "—"
	const canApply =
		preview &&
		preview.wouldChange &&
		preview.state !== "no_zone" &&
		preview.state !== "no_target" &&
		preview.state !== "no_host" &&
		!!preview.desiredIp

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Sync DNS for server domain</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3 text-left text-sm text-muted-foreground">
							{isFetching || apply.isPending ? (
								<div className="flex min-h-[5rem] items-center justify-center gap-2 py-4">
									<Loader2 className="size-4 animate-spin" aria-hidden />
									<span>
										{apply.isPending
											? "Updating Cloudflare…"
											: "Checking Cloudflare…"}
									</span>
								</div>
							) : preview ? (
								<div className="animate-in fade-in-0 slide-in-from-bottom-1 space-y-3 duration-300">
									{preview.state === "ok" ? (
										<p>
											The A record for{" "}
											<span className="font-mono text-foreground">
												{preview.host}
											</span>{" "}
											already points at this Dokploy server ({desired}).
										</p>
									) : preview.state === "no_host" ? (
										<p>Save a server domain before syncing DNS.</p>
									) : preview.state === "no_zone" ? (
										<p>
											No synced Cloudflare zone matches{" "}
											<span className="font-mono text-foreground">
												{preview.host}
											</span>
											. Open Domains and run{" "}
											<span className="font-medium text-foreground">
												Sync zones
											</span>
											.
										</p>
									) : preview.state === "no_target" ? (
										<p>
											No public server IP is set. Update Server IP before
											syncing DNS.
										</p>
									) : (
										<>
											<p>
												Cloudflare will update the A record for{" "}
												<span className="font-mono text-foreground">
													{preview.host}
												</span>{" "}
												so traffic reaches this node
												{proxied ? " (proxied)" : " (DNS only)"}.
											</p>
											<div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 font-mono text-xs text-foreground">
												<span>{current}</span>
												<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
												<span>{desired}</span>
											</div>
											{preview.errorMessage ? (
												<p className="text-xs text-destructive">
													{preview.errorMessage}
												</p>
											) : null}
										</>
									)}
								</div>
							) : (
								<p>
									Could not load preview. Connect Cloudflare and try again.
								</p>
							)}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="flex-col gap-2 sm:flex-row">
					{canApply ? (
						<Button
							type="button"
							isLoading={apply.isPending}
							onClick={() => apply.mutate({ proxied })}
						>
							Apply DNS
						</Button>
					) : null}
					<Button
						type="button"
						variant="secondary"
						onClick={() => onOpenChange(false)}
						disabled={apply.isPending}
					>
						Close
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
