"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CloudflareDomainSyncDialog } from "@/components/dashboard/application/domains/cloudflare-domain-sync-dialog";
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
			<div className="mb-2 flex w-full animate-in fade-in-0 slide-in-from-bottom-1 flex-col gap-3 duration-300">
				<p className="text-sm font-medium">Cloudflare DNS settings</p>
				{!isConnected ? (
					<p className="text-xs text-muted-foreground">
						Reconnect Cloudflare on the Domains page to sync or update proxy
						settings for this hostname.
					</p>
				) : !isCloudflare ? (
					<div className="flex flex-row items-center justify-between gap-4 rounded-lg border p-3 shadow-xs">
						<p className="text-sm font-medium leading-none">
							Manage in Cloudflare
						</p>
						<Switch
							checked={false}
							onCheckedChange={(checked) => {
								if (checked) {
									enableCloudflareManagement();
								}
							}}
							disabled={setProvider.isPending}
							aria-label="Enable Cloudflare management"
							className="shrink-0"
						/>
					</div>
				) : (
					<>
						<div className="flex flex-row items-center justify-between gap-4 rounded-lg border p-3 shadow-xs">
							<p className="text-sm font-medium leading-none">
								Proxied (orange cloud)
							</p>
							<Switch
								checked={proxied}
								onCheckedChange={handleProxiedChange}
								disabled={setProvider.isPending}
								aria-label="Cloudflare proxy enabled"
								className="shrink-0"
							/>
						</div>
						<div className="flex justify-end">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => setSyncDialogOpen(true)}
							>
								Sync DNS
							</Button>
						</div>
					</>
				)}
			</div>
		</>
	);
};
