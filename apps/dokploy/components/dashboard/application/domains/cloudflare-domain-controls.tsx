"use client"

import { Cloud } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
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
			toast.success("Cloudflare enabled for this domain")
			await utils.domain.one.invalidate({ domainId })
			await utils.domain.byApplicationId.invalidate()
			await utils.domain.byComposeId.invalidate()
		},
		onError: (e) => toast.error(e.message),
	})

	const isCloudflare = currentDnsProvider === "cloudflare"
	const isConnected = !!settings.data?.connected

	const canEnable = useMemo(
		() => isConnected && !setProvider.isPending,
		[isConnected, setProvider.isPending],
	)

	return (
		<>
			<CloudflareDomainSyncDialog
				domainId={domainId}
				open={syncDialogOpen}
				onOpenChange={setSyncDialogOpen}
			/>
		<div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
			<div className="flex items-start gap-2">
				<Cloud className="size-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
				<div className="space-y-1 min-w-0 flex-1">
					<p className="text-sm font-medium leading-none">Cloudflare DNS</p>
					<p className="text-xs text-muted-foreground">
						Automate records and optional orange-cloud proxying when your account is connected.
					</p>
				</div>
			</div>

			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="outline">Integration</Badge>
					{isCloudflare ? (
						<Badge variant="secondary">Enabled</Badge>
					) : (
						<Badge variant="secondary">Not enabled</Badge>
					)}
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="w-full sm:w-auto shrink-0"
					disabled={!isCloudflare}
					onClick={() => setSyncDialogOpen(true)}
				>
					Sync DNS
				</Button>
			</div>

			{!isConnected ? (
				<p className="text-sm text-muted-foreground">
					Connect Cloudflare on the Domains page to enable automation.
				</p>
			) : (
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-border bg-background/80 px-3 py-3">
					<div className="space-y-0.5 min-w-0">
						<p className="text-sm font-medium">Proxy (orange cloud)</p>
						<p className="text-xs text-muted-foreground">
							Recommended for HTTPS at the edge. Toggle before enabling for this domain.
						</p>
					</div>
					<div className="flex items-center justify-between sm:justify-end gap-3 sm:min-w-[9rem]">
						<span className="text-sm text-muted-foreground sm:order-first">
							{proxied ? "Proxied" : "DNS only"}
						</span>
						<Switch
							checked={proxied}
							onCheckedChange={setProxied}
							aria-label="Cloudflare proxy enabled"
						/>
					</div>
				</div>
			)}

			<div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-1">
				<Button
					type="button"
					size="sm"
					className="w-full sm:w-auto"
					disabled={!canEnable}
					isLoading={setProvider.isPending}
					onClick={() =>
						setProvider.mutate({
							domainId,
							proxied,
						})
					}
				>
					Enable for this domain
				</Button>
			</div>
		</div>
		</>
	)
}
