"use client";

import { Cloud } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CloudflareDomainSyncDialog } from "@/components/dashboard/application/domains/cloudflare-domain-sync-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/utils/api";

type CloudflareDomainControlsProps = {
	domainId: string;
	currentDnsProvider: string | null | undefined;
	currentProxied: boolean | null | undefined;
};

export const CloudflareDomainControls = ({
	domainId,
	currentDnsProvider,
	currentProxied,
}: CloudflareDomainControlsProps) => {
	const utils = api.useUtils();
	const settings = api.cloudflareSettings.get.useQuery();

	const [proxied, setProxied] = useState<boolean>(currentProxied ?? true);
	const [syncDialogOpen, setSyncDialogOpen] = useState(false);

	useEffect(() => {
		setProxied(currentProxied ?? true);
	}, [currentProxied]);

	const setProvider = api.domain.setDnsProviderCloudflare.useMutation({
		onSuccess: async () => {
			await utils.domain.one.invalidate({ domainId });
			await utils.domain.byApplicationId.invalidate();
			await utils.domain.byComposeId.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const isCloudflare = currentDnsProvider === "cloudflare";
	const isConnected = !!settings.data?.connected;

	const enableCloudflareManagement = () => {
		setProvider.mutate({ domainId, proxied });
	};

	const handleProxiedChange = (checked: boolean) => {
		const previous = proxied;
		setProxied(checked);
		if (!isConnected || !isCloudflare) {
			return;
		}
		setProvider.mutate(
			{ domainId, proxied: checked },
			{
				onError: () => {
					setProxied(previous);
				},
			},
		);
	};

	if (!isConnected && !isCloudflare) {
		return null;
	}

	return (
		<>
			<CloudflareDomainSyncDialog
				domainId={domainId}
				open={syncDialogOpen}
				onOpenChange={setSyncDialogOpen}
			/>
			<div className="flex w-full animate-in fade-in-0 slide-in-from-bottom-1 flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4 duration-300">
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 items-start gap-3">
						<div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
							<Cloud className="size-4 text-muted-foreground" aria-hidden />
						</div>
						<div className="min-w-0 space-y-1">
							<p className="text-sm font-medium leading-none">Cloudflare</p>
							<p className="text-xs leading-relaxed text-muted-foreground">
								Keep DNS and proxy settings in Cloudflare without cluttering the
								domain card.
							</p>
						</div>
					</div>
					<Badge variant="outline" className="w-fit text-[11px]">
						{!isConnected
							? "Cloudflare disconnected"
							: isCloudflare
								? "Managed in Cloudflare"
								: "Manual DNS"}
					</Badge>
				</div>
				{!isConnected ? (
					<p className="text-xs text-muted-foreground">
						Reconnect Cloudflare on the Domains page to sync or update proxy
						settings for this hostname.
					</p>
				) : !isCloudflare ? (
					<div className="flex flex-col gap-3 rounded-md border border-border bg-background px-3 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0 space-y-0.5">
							<p className="text-sm font-medium">
								Manage this hostname in Cloudflare
							</p>
							<p className="text-xs text-muted-foreground">
								Enable Cloudflare DNS automation for this saved domain.
							</p>
						</div>
						<div className="flex items-center gap-3 sm:min-w-[10rem] sm:justify-end">
							<span className="text-xs text-muted-foreground">Enable</span>
							<Switch
								checked={false}
								onCheckedChange={(checked) => {
									if (checked) {
										enableCloudflareManagement();
									}
								}}
								disabled={setProvider.isPending}
								aria-label="Enable Cloudflare management"
							/>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-3 rounded-md border border-border bg-background px-3 py-3 transition-colors">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0 space-y-0.5">
								<p className="text-sm font-medium">Proxy (orange cloud)</p>
								<p className="text-xs text-muted-foreground">
									Recommended for HTTPS at the edge. Use the toggle here, then
									sync DNS if needed.
								</p>
							</div>
							<div className="flex items-center justify-between gap-3 sm:min-w-[9rem] sm:justify-end">
								<span className="text-xs text-muted-foreground sm:order-first">
									{proxied ? "Proxied" : "DNS only"}
								</span>
								<Switch
									checked={proxied}
									onCheckedChange={handleProxiedChange}
									disabled={setProvider.isPending}
									aria-label="Cloudflare proxy enabled"
								/>
							</div>
						</div>
						<div className="flex justify-end">
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="w-full sm:w-auto"
								onClick={() => setSyncDialogOpen(true)}
							>
								Sync DNS
							</Button>
						</div>
					</div>
				)}
			</div>
		</>
	);
};
