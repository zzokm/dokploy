"use client"

import { Cloud } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CloudflareDomainSyncDialog } from "@/components/dashboard/application/domains/cloudflare-domain-sync-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { api } from "@/utils/api"

type CloudflareDomainControlsProps = {
	domainId: string
	currentDnsProvider: string | null | undefined
	currentProxied: boolean | null | undefined
}

export const CloudflareDomainControls = ({
	domainId,
	currentDnsProvider,
	currentProxied,
}: CloudflareDomainControlsProps) => {
	const utils = api.useUtils()
	const settings = api.cloudflareSettings.get.useQuery()

	const [proxied, setProxied] = useState<boolean>(currentProxied ?? true)
	const [syncDialogOpen, setSyncDialogOpen] = useState(false)

	useEffect(() => {
		setProxied(currentProxied ?? true)
	}, [currentProxied])

	const setProvider = api.domain.setDnsProviderCloudflare.useMutation({
		onSuccess: async () => {
			await utils.domain.one.invalidate({ domainId })
			await utils.domain.byApplicationId.invalidate()
			await utils.domain.byComposeId.invalidate()
		},
		onError: (e) => toast.error(e.message),
	})

	const isCloudflare = currentDnsProvider === "cloudflare"
	const isConnected = !!settings.data?.connected

	const handleProxiedChange = (checked: boolean) => {
		const previous = proxied
		setProxied(checked)
		if (!isConnected) {
			return
		}
		setProvider.mutate(
			{ domainId, proxied: checked },
			{
				onError: () => {
					setProxied(previous)
				},
			},
		)
	}

	const cfStatusLabel = !isConnected
		? "Not connected"
		: isCloudflare
			? "Managed in Cloudflare"
			: "Ready — toggle proxy to apply"

	return (
		<>
			<CloudflareDomainSyncDialog
				domainId={domainId}
				open={syncDialogOpen}
				onOpenChange={setSyncDialogOpen}
			/>
			<div className="flex flex-col sm:flex-row sm:items-start gap-3 rounded-lg border p-3 transition-colors bg-muted/50 w-full">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/5">
					<Cloud className="size-4 text-primary/70" aria-hidden />
				</div>
				<div className="min-w-0 flex-1 space-y-3">
					<div className="space-y-1">
						<p className="text-sm font-medium leading-none">Cloudflare DNS</p>
						<p className="text-xs text-muted-foreground">
							Sync A records to this node and control orange-cloud proxying when your account is
							connected.
						</p>
					</div>

					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<Badge variant="outline" className="w-fit text-[11px]">
							{cfStatusLabel}
						</Badge>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="w-full shrink-0 sm:w-auto"
							disabled={!isCloudflare}
							onClick={() => setSyncDialogOpen(true)}
						>
							Sync DNS
						</Button>
					</div>

					{!isConnected ? (
						<p className="text-xs text-muted-foreground">
							Connect Cloudflare on the Domains page to automate records.
						</p>
					) : (
						<div className="flex flex-col gap-3 rounded-md border bg-background/80 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0 space-y-0.5">
								<p className="text-sm font-medium">Proxy (orange cloud)</p>
								<p className="text-xs text-muted-foreground">
									Recommended for HTTPS at the edge. Saves DNS and certificate settings.
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
					)}
				</div>
			</div>
		</>
	)
}
