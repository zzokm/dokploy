"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
	deriveCloudflareDomainControlsVisibility,
	resolveCloudflareManagedState,
} from "@/components/dashboard/application/domains/cloudflare-domain-controls-visibility";
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

	// Optimistic overlays cleared once the refetch lands, so an error falls back
	// to server truth instead of a guessed previous value.
	const [pendingManaged, setPendingManaged] = useState<boolean | null>(null);
	const [pendingProxied, setPendingProxied] = useState<boolean | null>(null);
	const [syncDialogOpen, setSyncDialogOpen] = useState(false);

	const managed = resolveCloudflareManagedState({
		pendingManaged,
		dnsProvider: currentDnsProvider,
	});
	const proxied = pendingProxied ?? currentProxied ?? true;
	const isConnected = !!settings.data?.connected;

	const onSettled = async () => {
		await Promise.all([
			utils.domain.one.invalidate({ domainId }),
			utils.domain.byApplicationId.invalidate(),
			utils.domain.byComposeId.invalidate(),
		]);
		setPendingManaged(null);
		setPendingProxied(null);
	};

	const setProvider = api.domain.setDnsProviderCloudflare.useMutation({
		onError: (e) => toast.error(e.message),
		onSettled,
	});
	const disableProvider = api.domain.disableDnsProviderCloudflare.useMutation({
		onError: (e) => toast.error(e.message),
		onSettled,
	});

	const isPending = setProvider.isPending || disableProvider.isPending;

	const handleManagedChange = (checked: boolean) => {
		setPendingManaged(checked);
		if (checked) {
			setProvider.mutate({ domainId, proxied });
		} else {
			disableProvider.mutate({ domainId });
		}
	};

	const handleProxiedChange = (checked: boolean) => {
		setPendingProxied(checked);
		setProvider.mutate({ domainId, proxied: checked });
	};

	const visibility = deriveCloudflareDomainControlsVisibility({
		isConnected,
		isCloudflareManaged: managed,
	});

	if (!visibility.showSection) {
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
				{visibility.showReconnectHint ? (
					<p className="text-xs text-muted-foreground">
						Reconnect Cloudflare on the Domains page to sync or update proxy
						settings for this hostname.
					</p>
				) : null}
				{visibility.showManagedToggle ? (
					<div className="flex flex-row items-center justify-between gap-4 rounded-lg border p-3 shadow-xs">
						<p className="text-sm font-medium leading-none">
							Cloudflare managed domain
						</p>
						<Switch
							checked={managed}
							onCheckedChange={handleManagedChange}
							disabled={isPending}
							aria-label="Cloudflare managed domain"
							className="shrink-0"
						/>
					</div>
				) : null}
				{visibility.showProxyToggle ? (
					<>
						<div className="flex animate-in fade-in-0 slide-in-from-top-1 flex-row items-center justify-between gap-4 rounded-lg border p-3 shadow-xs duration-200">
							<p className="text-sm font-medium leading-none">
								Proxied (orange cloud)
							</p>
							<Switch
								checked={proxied}
								onCheckedChange={handleProxiedChange}
								disabled={isPending}
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
				) : null}
			</div>
		</>
	);
};
