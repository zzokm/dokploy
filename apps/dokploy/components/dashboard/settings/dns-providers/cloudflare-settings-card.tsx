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
	const integrations = api.cloudflare.listIntegrations.useQuery()

	const createIntegration = api.cloudflare.createIntegration.useMutation({
		onSuccess: async () => {
			toast.success("Cloudflare connected")
			await integrations.refetch()
		},
		onError: (e) => toast.error(e.message),
	})

	const deleteIntegration = api.cloudflare.deleteIntegration.useMutation({
		onSuccess: async () => {
			toast.success("Cloudflare integration removed")
			await integrations.refetch()
			await utils.cloudflare.invalidate()
		},
		onError: (e) => toast.error(e.message),
	})

	const [isOpen, setIsOpen] = useState(false)
	const [name, setName] = useState("Cloudflare")
	const [token, setToken] = useState("")

	const canSubmit = useMemo(() => name.trim().length > 0 && token.trim().length > 20, [name, token])

	const handleConnect = async () => {
		try {
			await createIntegration.mutateAsync({ name: name.trim(), apiToken: token.trim() })
		} catch {
			return
		}
		setToken("")
		setIsOpen(false)
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

					<div className="flex flex-col sm:flex-row sm:items-center gap-3">
						<Dialog open={isOpen} onOpenChange={setIsOpen}>
							<DialogTrigger asChild>
								<Button type="button" variant="default" className="w-full sm:w-auto">
									Connect Cloudflare
								</Button>
							</DialogTrigger>
							<DialogContent className="sm:max-w-lg">
								<DialogHeader>
									<DialogTitle>Connect Cloudflare</DialogTitle>
									<DialogDescription>
										Paste a Cloudflare API token with Zone read and DNS edit permissions.
									</DialogDescription>
								</DialogHeader>

								<div className="space-y-4">
									<div className="space-y-2">
										<Label htmlFor="cf-name">Name</Label>
										<Input
											id="cf-name"
											value={name}
											onChange={(e) => setName(e.target.value)}
											placeholder="Cloudflare"
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="cf-token-dialog">API token</Label>
										<Input
											id="cf-token-dialog"
											value={token}
											onChange={(e) => setToken(e.target.value)}
											placeholder="••••••••••••••••••••"
											className="font-mono text-sm"
										/>
										<p className="text-xs text-muted-foreground leading-relaxed">
											Enables DNS automation and Traefik DNS-01 via <span className="font-mono">CF_DNS_API_TOKEN</span>.
										</p>
									</div>
								</div>

								<DialogFooter className="gap-2 sm:gap-0">
									<Button
										type="button"
										variant="outline"
										onClick={() => setIsOpen(false)}
									>
										Cancel
									</Button>
									<Button
										type="button"
										onClick={handleConnect}
										disabled={!canSubmit || createIntegration.isPending}
										isLoading={createIntegration.isPending}
									>
										Connect
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</div>

					{integrations.isPending ? (
						<p className="text-sm text-muted-foreground">Loading integrations…</p>
					) : integrations.data?.length ? (
						<div className="rounded-lg border border-border divide-y bg-muted/20">
							{integrations.data.map((i) => (
								<div
									key={i.id}
									className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4"
								>
									<div className="min-w-0 space-y-0.5">
										<div className="text-sm font-medium truncate">{i.name}</div>
										<div className="text-xs text-muted-foreground font-mono">
											Token ••••{i.apiTokenLast4}
										</div>
									</div>
									<Button
										type="button"
										variant="destructive"
										size="sm"
										className="w-full sm:w-auto shrink-0"
										isLoading={deleteIntegration.isPending}
										onClick={() => deleteIntegration.mutate({ id: i.id })}
									>
										Remove
									</Button>
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">No Cloudflare integrations yet.</p>
					)}
				</CardContent>
			</div>
		</Card>
	)
}
