"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { api } from "@/utils/api"

type CloudflareDomainControlsProps = {
	domainId: string
	currentDnsProvider: string | null | undefined
	currentIntegrationId: string | null | undefined
	currentZoneId: string | null | undefined
	currentProxied: boolean | null | undefined
}

export const CloudflareDomainControls = ({
	domainId,
	currentDnsProvider,
	currentIntegrationId,
	currentZoneId,
	currentProxied,
}: CloudflareDomainControlsProps) => {
	const utils = api.useUtils()
	const integrations = api.cloudflare.listIntegrations.useQuery()

	const [integrationId, setIntegrationId] = useState<string>(currentIntegrationId ?? "")
	const [zoneId, setZoneId] = useState<string>(currentZoneId ?? "")
	const [proxied, setProxied] = useState<boolean>(currentProxied ?? true)

	useEffect(() => {
		setIntegrationId(currentIntegrationId ?? "")
		setZoneId(currentZoneId ?? "")
		setProxied(currentProxied ?? true)
	}, [currentIntegrationId, currentZoneId, currentProxied])

	const zones = api.cloudflare.listZones.useQuery(
		{ integrationId },
		{ enabled: !!integrationId },
	)

	const setProvider = api.domain.setDnsProviderCloudflare.useMutation({
		onSuccess: async () => {
			toast.success("Cloudflare enabled for this domain")
			await utils.domain.one.invalidate({ domainId })
			await utils.domain.byApplicationId.invalidate()
			await utils.domain.byComposeId.invalidate()
		},
		onError: (e) => toast.error(e.message),
	})

	const sync = api.domain.syncCloudflareDns.useMutation({
		onSuccess: async () => {
			toast.success("DNS synced")
			await utils.domain.one.invalidate({ domainId })
		},
		onError: (e) => toast.error(e.message),
	})

	const isCloudflare = currentDnsProvider === "cloudflare"
	const hasIntegration = integrations.data?.length

	const canEnable = useMemo(
		() => !!integrationId && !!zoneId && !setProvider.isPending,
		[integrationId, zoneId, setProvider.isPending],
	)

	return (
		<div className="rounded-md border p-3 space-y-3">
			<div className="flex items-center justify-between gap-3 flex-wrap">
				<div className="flex items-center gap-2 flex-wrap">
					<Badge variant="outline">Cloudflare</Badge>
					{isCloudflare ? (
						<Badge variant="secondary">Enabled</Badge>
					) : (
						<Badge variant="secondary">Not enabled</Badge>
					)}
				</div>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					isLoading={sync.isPending}
					disabled={!isCloudflare}
					onClick={() => sync.mutate({ domainId })}
				>
					Sync DNS
				</Button>
			</div>

			{!hasIntegration ? (
				<p className="text-sm text-muted-foreground">
					Add a Cloudflare integration in Settings → Web Server → DNS providers to enable automation.
				</p>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
					<div className="space-y-1">
						<div className="text-xs text-muted-foreground">Integration</div>
						<Select value={integrationId} onValueChange={setIntegrationId}>
							<SelectTrigger>
								<SelectValue placeholder="Select integration" />
							</SelectTrigger>
							<SelectContent>
								{integrations.data?.map((i) => (
									<SelectItem key={i.id} value={i.id}>
										{i.name} (••••{i.apiTokenLast4})
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-1">
						<div className="text-xs text-muted-foreground">Zone</div>
						<Select
							value={zoneId}
							onValueChange={setZoneId}
							disabled={!integrationId || zones.isPending}
						>
							<SelectTrigger>
								<SelectValue placeholder={integrationId ? "Select zone" : "Select integration first"} />
							</SelectTrigger>
							<SelectContent>
								{zones.data?.map((z) => (
									<SelectItem key={z.id} value={z.id}>
										{z.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<div className="text-xs text-muted-foreground">Proxy (recommended)</div>
						<div className="flex items-center justify-between gap-3">
							<div className="text-sm">{proxied ? "Proxied" : "DNS only"}</div>
							<Switch checked={proxied} onCheckedChange={setProxied} />
						</div>
					</div>
				</div>
			)}

			<div className="flex items-center justify-end gap-2">
				<Button
					type="button"
					size="sm"
					disabled={!canEnable}
					isLoading={setProvider.isPending}
					onClick={() =>
						setProvider.mutate({
							domainId,
							integrationId,
							zoneId,
							proxied,
						})
					}
				>
					Enable for this domain
				</Button>
			</div>
		</div>
	)
}

