"use client"

import { Cloud } from "lucide-react"
import { useState } from "react"
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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/utils/api"

export const CloudflareSettingsCard = () => {
	const utils = api.useUtils()
	const { data: settings } = api.cloudflareSettings.get.useQuery()
	const [token, setToken] = useState("")

	const setTokenMutation = api.cloudflareSettings.setToken.useMutation({
		onSuccess: async () => {
			toast.success("Cloudflare connected")
			setToken("")
			await utils.cloudflareSettings.get.invalidate()
			await utils.cloudflareSettings.listZones.invalidate()
		},
		onError: (e) => toast.error(e.message),
	})

	const syncZonesMutation = api.cloudflareSettings.syncZones.useMutation({
		onSuccess: async () => {
			toast.success("Zones synced")
			await utils.cloudflareSettings.listZones.invalidate()
		},
		onError: (e) => toast.error(e.message),
	})

	const handleConnect = () => {
		const next = token.trim()
		if (!next) {
			toast.error("API token is required")
			return
		}
		setTokenMutation.mutate({ apiToken: next })
	}

	return (
		<Card className="h-full w-full overflow-hidden rounded-xl border border-border bg-sidebar p-2.5 shadow-none">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader className="space-y-1">
					<CardTitle className="text-lg sm:text-xl flex flex-row gap-2 items-center">
						<Cloud className="size-6 text-muted-foreground shrink-0" aria-hidden />
						Cloudflare
					</CardTitle>
					<CardDescription>
						Connect Cloudflare to manage DNS records and Let&apos;s Encrypt DNS-01 for proxied domains (Traefik).
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6 border-t py-6">
					<div className="space-y-2 text-sm text-muted-foreground">
						<p className="font-medium text-foreground">Required API token permissions</p>
						<ul className="list-disc pl-5 space-y-1">
							<li>
								<span className="font-medium text-foreground">Zone.Zone</span> — Read
							</li>
							<li>
								<span className="font-medium text-foreground">Zone.DNS</span> — Edit
							</li>
						</ul>
						<p className="leading-relaxed">
							Use a scoped API token (not the global API key). The token is stored encrypted and is not shown again after saving.
						</p>
					</div>

					{settings?.connected ? (
						<div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
							<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
								<div className="text-sm text-muted-foreground">
									Connected with token ending in{" "}
									<span className="font-mono text-foreground">****{settings.apiTokenLast4}</span>
								</div>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									isLoading={syncZonesMutation.isPending}
									onClick={() => syncZonesMutation.mutate()}
									className="w-full sm:w-auto"
								>
									Sync zones
								</Button>
							</div>
							<div className="space-y-2">
								<Label htmlFor="cf-token-settings">Replace API token</Label>
								<Input
									id="cf-token-settings"
									value={token}
									onChange={(e) => setToken(e.target.value)}
									placeholder="Paste new API token"
									className="font-mono text-sm"
									autoComplete="off"
								/>
								<Button
									type="button"
									variant="default"
									isLoading={setTokenMutation.isPending}
									onClick={handleConnect}
									disabled={!token.trim()}
									className="w-full sm:w-auto"
								>
									Update token
								</Button>
								<p className="text-xs text-muted-foreground leading-relaxed">
									This updates DNS automation and Traefik DNS-01 via{" "}
									<span className="font-mono">CF_DNS_API_TOKEN</span>.
								</p>
							</div>
						</div>
					) : (
						<div className="flex flex-col gap-4 max-w-md">
							<div className="space-y-2">
								<Label htmlFor="cf-token-settings">Cloudflare API token</Label>
								<Input
									id="cf-token-settings"
									value={token}
									onChange={(e) => setToken(e.target.value)}
									placeholder="Paste API token"
									autoComplete="off"
									className="font-mono text-sm"
								/>
							</div>
							<Button
								type="button"
								variant="default"
								className="w-full sm:w-auto"
								isLoading={setTokenMutation.isPending}
								onClick={handleConnect}
								disabled={!token.trim()}
							>
								Connect Cloudflare
							</Button>
						</div>
					)}
				</CardContent>
			</div>
		</Card>
	)
}
