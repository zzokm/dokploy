"use client"

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
		<Card>
			<CardHeader>
				<CardTitle>Cloudflare</CardTitle>
				<CardDescription>
					Connect Cloudflare to automatically manage DNS records and enable Let’s Encrypt DNS-01 for proxied domains.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2 text-sm text-muted-foreground">
					<div className="font-medium text-foreground">Required API Token permissions</div>
					<ul className="list-disc pl-5 space-y-1">
						<li>
							<span className="font-medium text-foreground">Zone.Zone</span> — Read
						</li>
						<li>
							<span className="font-medium text-foreground">Zone.DNS</span> — Edit
						</li>
					</ul>
					<p>
						Use a scoped API Token (not the Global API Key). The token is stored encrypted and never shown again after saving.
					</p>
				</div>

				<div className="flex items-center justify-between gap-3 flex-wrap">
					<Dialog open={isOpen} onOpenChange={setIsOpen}>
						<DialogTrigger asChild>
							<Button type="button" variant="secondary">
								Connect Cloudflare
							</Button>
						</DialogTrigger>
						<DialogContent className="sm:max-w-lg">
							<DialogHeader>
								<DialogTitle>Connect Cloudflare</DialogTitle>
								<DialogDescription>
									Paste a Cloudflare API Token with Zone read and DNS edit permissions.
								</DialogDescription>
							</DialogHeader>

							<div className="space-y-3">
								<div className="space-y-1.5">
									<Label htmlFor="cf-name">Name</Label>
									<Input
										id="cf-name"
										value={name}
										onChange={(e) => setName(e.target.value)}
										placeholder="Cloudflare"
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="cf-token">API Token</Label>
									<Input
										id="cf-token"
										value={token}
										onChange={(e) => setToken(e.target.value)}
										placeholder="••••••••••••••••••••"
									/>
									<p className="text-xs text-muted-foreground">
										This enables DNS automation and Traefik’s DNS-01 challenge (via `CF_DNS_API_TOKEN`).
									</p>
								</div>
							</div>

							<DialogFooter>
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
					<div className="rounded-md border divide-y">
						{integrations.data.map((i) => (
							<div key={i.id} className="flex items-center justify-between gap-3 p-3">
								<div className="min-w-0">
									<div className="text-sm font-medium truncate">{i.name}</div>
									<div className="text-xs text-muted-foreground">
										Token ending in ••••{i.apiTokenLast4}
									</div>
								</div>
								<Button
									type="button"
									variant="destructive"
									size="sm"
									isLoading={deleteIntegration.isPending}
									onClick={() => deleteIntegration.mutate({ id: i.id })}
								>
									Remove
								</Button>
							</div>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						No Cloudflare integrations yet.
					</p>
				)}
			</CardContent>
		</Card>
	)
}

