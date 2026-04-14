"use client"

import { Cloud } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { api } from "@/utils/api"

export const CloudflareMailDnsCard = () => {
	const settings = api.cloudflareSettings.get.useQuery()
	const zones = api.cloudflareSettings.listZones.useQuery(undefined, {
		enabled: !!settings.data?.connected,
	})
	const provision = api.cloudflareMail.provisionForZone.useMutation({
		onSuccess: (data) => {
			toast.success("Mail DNS provisioned")
			if (data.hostedDomainId) {
				window.location.assign(
					`/dashboard/emails?domainId=${encodeURIComponent(data.hostedDomainId)}`,
				)
			}
		},
		onError: (e) => toast.error(e.message),
	})

	const [zoneId, setZoneId] = useState<string>("")

	const enabledZones = useMemo(
		() =>
			(zones.data ?? []).filter((z) => z.status !== "disabled" && !z.paused),
		[zones.data],
	)

	return (
		<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader>
					<CardTitle className="text-xl flex flex-row gap-2 items-center">
						<Cloud className="size-6 text-muted-foreground shrink-0" aria-hidden />
						Mail DNS (Cloudflare)
					</CardTitle>
					<CardDescription>
						Publishes A records for <span className="font-mono">mail</span> and{" "}
						<span className="font-mono">webmail</span> (Roundcube), plus MX, SPF,
						DMARC, and DKIM TXT records.
					</CardDescription>
				</CardHeader>
				<CardContent className="border-t py-6 space-y-4">
					{!settings.data?.connected ? (
						<p className="text-sm text-muted-foreground">
							Connect Cloudflare on the Domains page first.
						</p>
					) : (
						<div className="flex flex-col lg:flex-row gap-4 lg:items-end">
							<div className="flex-1 min-w-0 space-y-2">
								<span className="text-sm font-medium leading-none">Zone</span>
								<Select value={zoneId} onValueChange={setZoneId}>
									<SelectTrigger aria-label="Cloudflare zone for mail DNS">
										<SelectValue placeholder="Select zone" />
									</SelectTrigger>
									<SelectContent>
										{enabledZones.map((z) => (
											<SelectItem key={z.cfZoneId} value={z.cfZoneId}>
												{z.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<Button
								type="button"
								className="w-full lg:w-auto shrink-0"
								disabled={!zoneId}
								isLoading={provision.isPending}
								onClick={() => provision.mutate({ cfZoneId: zoneId })}
							>
								Provision mail DNS
							</Button>
						</div>
					)}
				</CardContent>
			</div>
		</Card>
	)
}

