"use client"

import { Cloud, KeyRound } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Card,
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
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/utils/api"

export const CloudflareSettingsCard = () => {
	const utils = api.useUtils()
	const { data: settings } = api.cloudflareSettings.get.useQuery()
	const [open, setOpen] = useState(false)
	const [token, setToken] = useState("")

	const setTokenMutation = api.cloudflareSettings.setToken.useMutation({
		onSuccess: async (result) => {
			toast.success("Cloudflare connected")
			if (result.validation?.warning) {
				toast.message(result.validation.warning)
			}
			setToken("")
			await utils.cloudflareSettings.get.invalidate()
			await utils.cloudflareSettings.listZones.invalidate()
		},
		onError: (e) => toast.error(e.message),
	})

	const syncZonesMutation = api.cloudflareSettings.syncZones.useMutation({
		onSuccess: async () => {
			toast.success("Domains synced")
			await utils.cloudflareSettings.listZones.invalidate()
		},
		onError: (e) => toast.error(e.message),
	})

	const disconnectMutation = api.cloudflareSettings.disconnect.useMutation({
		onSuccess: async () => {
			toast.success("Cloudflare disconnected")
			setToken("")
			await utils.cloudflareSettings.get.invalidate()
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

	const connected = !!settings?.connected

	return (
		<>
			<Card className="h-full min-w-0 w-full overflow-hidden rounded-xl border border-border bg-sidebar p-2.5 shadow-none">
				<div className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-xl bg-background shadow-md duration-300">
					<CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0 space-y-1">
							<CardTitle className="flex flex-row items-center gap-2 text-lg sm:text-xl">
								<Cloud
									className="size-6 shrink-0 text-muted-foreground"
									aria-hidden
								/>
								Cloudflare
							</CardTitle>
							<CardDescription className="text-xs sm:text-sm">
								DNS providers
							</CardDescription>
						</div>
						<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
							<Badge
								variant={connected ? "green" : "outline"}
								className="w-fit"
							>
								{connected
									? `Connected · ****${settings?.apiTokenLast4 ?? ""}`
									: "Not connected"}
							</Badge>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								className="w-full sm:w-auto"
								onClick={() => setOpen(true)}
							>
								Manage
							</Button>
						</div>
					</CardHeader>
				</div>
			</Card>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Cloud className="size-5 text-muted-foreground" aria-hidden />
							Cloudflare
						</DialogTitle>
						<DialogDescription>
							Manage DNS records and Let&apos;s Encrypt DNS-01 (Traefik).
						</DialogDescription>
					</DialogHeader>

					<div className="animate-in fade-in-0 slide-in-from-bottom-1 space-y-6 duration-300">
						<div className="space-y-2 text-sm text-muted-foreground">
							<p className="font-medium text-foreground">
								Required API token permissions
							</p>
							<ul className="list-disc space-y-1 pl-5">
								<li>
									<span className="font-medium text-foreground">
										Zone → Zone → Read
									</span>
								</li>
								<li>
									<span className="font-medium text-foreground">
										Zone → DNS → Edit (includes read/write)
									</span>
								</li>
							</ul>
							<p className="leading-relaxed">
								Use a scoped API token (not the global API key). The token is
								stored encrypted and is not shown again after saving.
							</p>
						</div>

						{connected ? (
							<div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/20 p-4 transition-colors">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<div className="flex items-start gap-3">
										<div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
											<KeyRound
												className="size-4 text-muted-foreground"
												aria-hidden
											/>
										</div>
										<div className="min-w-0 text-sm text-muted-foreground">
											<p className="font-medium text-foreground">Connected</p>
											<p>
												Token ending in{" "}
												<span className="font-mono text-foreground">
													****{settings?.apiTokenLast4}
												</span>
											</p>
										</div>
									</div>
									<Button
										type="button"
										variant="secondary"
										size="sm"
										isLoading={syncZonesMutation.isPending}
										onClick={() => syncZonesMutation.mutate()}
										className="w-full sm:w-auto"
									>
										Sync domains
									</Button>
								</div>
								<div className="space-y-2 border-t border-border/60 pt-4">
									<Label htmlFor="cf-token-settings">Replace API token</Label>
									<Input
										id="cf-token-settings"
										value={token}
										onChange={(e) => setToken(e.target.value)}
										placeholder="Paste new API token"
										className="font-mono text-sm"
										autoComplete="off"
									/>
									<div className="flex flex-col gap-2 sm:flex-row">
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
										<Button
											type="button"
											variant="outline"
											isLoading={disconnectMutation.isPending}
											onClick={() => disconnectMutation.mutate()}
											className="w-full sm:w-auto"
										>
											Disconnect
										</Button>
									</div>
									<p className="text-xs leading-relaxed text-muted-foreground">
										Updates DNS automation and Traefik DNS-01 via{" "}
										<span className="font-mono">CF_DNS_API_TOKEN</span>.
									</p>
								</div>
							</div>
						) : (
							<div className="flex w-full flex-col gap-4">
								<div className="space-y-2">
									<Label htmlFor="cf-token-settings-connect">
										Cloudflare API token
									</Label>
									<Input
										id="cf-token-settings-connect"
										value={token}
										onChange={(e) => setToken(e.target.value)}
										placeholder="Paste API token"
										autoComplete="off"
										className="font-mono text-sm"
									/>
									<div className="flex flex-col gap-1 mt-2 text-xs text-muted-foreground">
										<span className="font-semibold text-foreground">Create a Cloudflare API token</span>
										<span>Open Cloudflare → My Profile → API Tokens → Create Token. Prefer a custom token with least privilege.</span>
										<ul className="list-disc list-inside ml-2">
											<li>Zone → Zone → Read</li>
											<li>Zone → DNS → Edit</li>
											<li>Account → Account Settings → Read (needed to list zones in some accounts)</li>
										</ul>
										<span className="mt-1">Managed Cloudflare DNS always uses CDN proxy and DNS-01 certificates.</span>
									</div>
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
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setOpen(false)}
						>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
