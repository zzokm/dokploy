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
	/** @deprecated Ignored — CF Auto DNS always proxied. Kept for call-site compat. */
	currentProxied?: boolean | null | undefined;
};

export const CloudflareDomainControls = ({
	domainId,
	currentDnsProvider,
}: CloudflareDomainControlsProps) => {
	const utils = api.useUtils();
	const settings = api.cloudflareSettings.get.useQuery();

	const [pendingManaged, setPendingManaged] = useState<boolean | null>(null);
	const [syncDialogOpen, setSyncDialogOpen] = useState(false);

	const managed = resolveCloudflareManagedState({
		pendingManaged,
		dnsProvider: currentDnsProvider,
	});
	const isConnected = !!settings.data?.connected;

	const onSettled = async () => {
		await Promise.all([
			utils.domain.one.invalidate({ domainId }),
			utils.domain.byApplicationId.invalidate(),
			utils.domain.byComposeId.invalidate(),
		]);
		setPendingManaged(null);
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
			// CF policy: always proxied
			setProvider.mutate({ domainId, proxied: true });
		} else {
			disableProvider.mutate({ domainId });
		}
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
				<p className="text-sm font-medium">Auto DNS</p>
				{visibility.showReconnectHint ? (
					<p className="text-xs text-muted-foreground">
						Connect a DNS provider on the Domains page to manage this hostname.
					</p>
				) : null}
				{visibility.showManagedToggle ? (
					<div className="flex flex-row items-center justify-between gap-4 rounded-lg border p-3 shadow-xs">
						<div className="space-y-1">
							<p className="text-sm font-medium leading-none">Managed DNS</p>
							<p className="text-xs text-muted-foreground">
								Dokploy upserts the record and uses DNS-01 for TLS when the
								provider requires it.
							</p>
						</div>
						<Switch
							checked={managed}
							onCheckedChange={handleManagedChange}
							disabled={isPending}
							aria-label="Managed DNS"
							className="shrink-0"
						/>
					</div>
				) : null}
				{visibility.showSyncAction ? (
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
				) : null}
			</div>
		</>
	);
};
