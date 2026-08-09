"use client";

import { ArrowRight, Cloud, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/utils/api";

type ServerDomainCloudflareControlsProps = {
	/** Saved host from web server settings (empty if none). */
	savedHost: string;
	/** Current form host value (may differ before save). */
	formHost: string;
};

export const ServerDomainCloudflareControls = ({
	savedHost,
	formHost,
}: ServerDomainCloudflareControlsProps) => {
	const utils = api.useUtils();
	const { data: settings } = api.cloudflareSettings.get.useQuery();
	const [manageOpen, setManageOpen] = useState(false);

	const host = savedHost.trim();
	const formMatchesSaved =
		formHost.trim().toLowerCase() === host.toLowerCase() && !!host;
	const isConnected = !!settings?.connected;

	const previewQuery = api.cloudflareSettings.previewServerDomainDns.useQuery(
		undefined,
		{ enabled: isConnected && !!host },
	);

	const applyMutation = api.cloudflareSettings.applyServerDomainDns.useMutation(
		{
			onSuccess: async () => {
				toast.success("Server domain DNS updated");
				await utils.cloudflareSettings.previewServerDomainDns.invalidate();
				setManageOpen(false);
			},
			onError: (e) => toast.error(e.message),
		},
	);

	const statusLabel = !isConnected
		? "Not connected"
		: !host
			? "Save a domain first"
			: !formMatchesSaved
				? "Save domain to sync DNS"
				: previewQuery.data?.state === "ok"
					? "DNS up to date"
					: previewQuery.data?.state === "no_zone"
						? "No matching domain"
						: previewQuery.data?.state === "missing" ||
								previewQuery.data?.state === "drift"
							? "DNS needs sync"
							: "Ready";

	return (
		<>
			<div className="col-span-2 flex w-full animate-in fade-in-0 slide-in-from-bottom-1 flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 duration-300 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-start gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
						<Cloud className="size-4 text-muted-foreground" aria-hidden />
					</div>
					<div className="min-w-0 space-y-1">
						<p className="text-sm font-medium leading-none">Auto DNS</p>
						<p className="text-xs leading-relaxed text-muted-foreground">
							Sync the server hostname via managed DNS.
						</p>
					</div>
				</div>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
					<Badge variant="outline" className="w-fit text-[11px]">
						{statusLabel}
					</Badge>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-full sm:w-auto"
						onClick={() => setManageOpen(true)}
					>
						Manage DNS
					</Button>
				</div>
			</div>

			<Dialog open={manageOpen} onOpenChange={setManageOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Manage server domain DNS</DialogTitle>
						<DialogDescription>
							Review DNS status, then sync the saved host.
						</DialogDescription>
					</DialogHeader>
					<ServerDomainCloudflareManageContent
						savedHost={savedHost}
						formHost={formHost}
						onClose={() => setManageOpen(false)}
						applyMutationPending={applyMutation.isPending}
						onApply={() => applyMutation.mutate({ proxied: true })}
					/>
				</DialogContent>
			</Dialog>
		</>
	);
};

type ManageContentProps = {
	savedHost: string;
	formHost: string;
	onApply: () => void;
	onClose: () => void;
	applyMutationPending: boolean;
};

const ServerDomainCloudflareManageContent = ({
	savedHost,
	formHost,
	onApply,
	onClose,
	applyMutationPending,
}: ManageContentProps) => {
	const { data: settings } = api.cloudflareSettings.get.useQuery();
	const host = savedHost.trim();
	const formMatchesSaved =
		formHost.trim().toLowerCase() === host.toLowerCase() && !!host;
	const isConnected = !!settings?.connected;
	const { data: preview, isFetching } =
		api.cloudflareSettings.previewServerDomainDns.useQuery(undefined, {
			enabled: isConnected && !!host,
		});

	const current = preview?.currentIp ?? "—";
	const desired = preview?.desiredIp ?? "—";
	const canApply =
		isConnected &&
		formMatchesSaved &&
		preview &&
		preview.state !== "no_zone" &&
		preview.state !== "no_target" &&
		preview.state !== "no_host" &&
		!!preview.desiredIp &&
		(preview.wouldChange || preview.currentProxied === false);

	return (
		<div className="space-y-4 text-sm text-muted-foreground">
			{!isConnected ? (
				<p>
					Connect a DNS provider on the{" "}
					<Link
						href="/dashboard/domains"
						className="text-foreground underline underline-offset-2"
					>
						Domains
					</Link>{" "}
					page first.
				</p>
			) : !host ? (
				<p>Save a server domain before syncing DNS.</p>
			) : !formMatchesSaved ? (
				<p>Save your domain changes first, then reopen DNS management.</p>
			) : isFetching || applyMutationPending ? (
				<div className="flex min-h-[5rem] items-center justify-center gap-2 py-4">
					<Loader2 className="size-4 animate-spin" aria-hidden />
					<span>
						{applyMutationPending ? "Updating DNS…" : "Checking DNS…"}
					</span>
				</div>
			) : preview ? (
				<div className="animate-in fade-in-0 slide-in-from-bottom-1 space-y-4 duration-300">
					{preview.state === "ok" && preview.currentProxied !== false ? (
						<p>
							The A record for{" "}
							<span className="font-mono text-foreground">{preview.host}</span>{" "}
							already points at this Dokploy server ({desired}).
						</p>
					) : preview.state === "no_host" ? (
						<p>Save a server domain before syncing DNS.</p>
					) : preview.state === "no_zone" ? (
						<p>
							No synced zone matches{" "}
							<span className="font-mono text-foreground">{preview.host}</span>.
							Open Domains and sync zones.
						</p>
					) : preview.state === "no_target" ? (
						<p>
							No public server IP is set. Update Server IP before syncing DNS.
						</p>
					) : (
						<>
							<p>
								DNS will update the A record for{" "}
								<span className="font-mono text-foreground">
									{preview.host}
								</span>{" "}
								so traffic reaches this node.
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
				<p>Could not load preview. Connect a DNS provider and try again.</p>
			)}

			<DialogFooter className="flex-col gap-2 sm:flex-row">
				{canApply ? (
					<Button
						type="button"
						isLoading={applyMutationPending}
						onClick={onApply}
					>
						Apply DNS
					</Button>
				) : null}
				<Button
					type="button"
					variant="secondary"
					onClick={onClose}
					disabled={applyMutationPending}
				>
					Close
				</Button>
			</DialogFooter>
		</div>
	);
};
