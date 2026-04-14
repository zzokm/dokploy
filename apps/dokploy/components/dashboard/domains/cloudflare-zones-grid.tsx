"use client"

import { Cloud, Loader2, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CloudflareDnsPreviewDialog } from "@/components/dashboard/domains/cloudflare-dns-preview-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { api } from "@/utils/api"

const statusVariant = (status: "active" | "pending" | "disabled") => {
	if (status === "active") return "default"
	if (status === "pending") return "secondary"
	return "outline"
}

export const CloudflareZonesGrid = () => {
	const utils = api.useUtils()
	const [tokenInput, setTokenInput] = useState("")
	const [previewOpen, setPreviewOpen] = useState(false)
	const [autoReview, setAutoReview] = useState(false)
	const { data: settings } = api.cloudflareSettings.get.useQuery()
	const { data: zones, refetch, isPending } =
		api.cloudflareSettings.listZones.useQuery(undefined, {
			enabled: !!settings?.connected,
		})

	const { data: previewRows, isFetching: previewLoading } =
		api.cloudflareSettings.previewAppDns.useQuery(undefined, {
			enabled: !!settings?.connected && (previewOpen || autoReview),
		})

	useEffect(() => {
		if (!autoReview || previewLoading) {
			return
		}
		if (!previewRows || previewRows.length === 0) {
			setAutoReview(false)
			return
		}
		const needsAttention = previewRows.filter((r) => r.state !== "ok")
		if (needsAttention.length > 0) {
			setPreviewOpen(true)
		} else {
			toast.success("All Cloudflare app domains already point at this server.")
		}
		setAutoReview(false)
	}, [autoReview, previewLoading, previewRows])

	const setToken = api.cloudflareSettings.setToken.useMutation({
		onSuccess: async () => {
			toast.success("Cloudflare connected — syncing zones…")
			setTokenInput("")
			await utils.cloudflareSettings.get.invalidate()
			await utils.cloudflareSettings.listZones.invalidate()
			await refetch()
			setAutoReview(true)
		},
		onError: (e) => toast.error(e.message),
	})

	const syncZones = api.cloudflareSettings.syncZones.useMutation({
		onSuccess: async () => {
			toast.success("Zones synced")
			await refetch()
			setAutoReview(true)
		},
		onError: (e) => toast.error(e.message),
	})

	const handleConnect = () => {
		const token = tokenInput.trim()
		if (!token) {
			toast.error("API token is required")
			return
		}
		setToken.mutate({ apiToken: token })
	}

	if (!settings?.connected) {
		return (
			<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<Cloud className="size-6 text-muted-foreground shrink-0 self-center" />
							Domains (Cloudflare)
						</CardTitle>
						<CardDescription>
							Connect Cloudflare to import your zones and manage DNS automatically
							for applications and mail.
						</CardDescription>
					</CardHeader>
					<CardContent className="border-t py-6 sm:py-8">
						<div className="flex flex-col gap-4 max-w-md">
							<div className="space-y-2">
								<Label htmlFor="cf-token">Cloudflare API token</Label>
								<Input
									id="cf-token"
									value={tokenInput}
									onChange={(e) => setTokenInput(e.target.value)}
									placeholder="Paste API token"
									autoComplete="off"
									className="font-mono text-sm"
								/>
							</div>
							<Button
								type="button"
								isLoading={setToken.isPending}
								onClick={handleConnect}
								className="w-full sm:w-auto"
							>
								Connect Cloudflare
							</Button>
							<p className="text-xs text-muted-foreground leading-relaxed">
								Required permissions:{" "}
								<span className="font-mono text-foreground">Zone.Zone:Read</span> and{" "}
								<span className="font-mono text-foreground">Zone.DNS:Edit</span>
							</p>
						</div>
					</CardContent>
				</div>
			</Card>
		)
	}

	const handleOpenDnsReview = () => {
		setPreviewOpen(true)
	}

	return (
		<>
			<CloudflareDnsPreviewDialog
				open={previewOpen}
				onOpenChange={setPreviewOpen}
				rows={previewRows}
				isLoading={previewLoading && (previewOpen || autoReview)}
			/>
			<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-1 min-w-0">
						<CardTitle className="text-xl flex flex-row gap-2">
							<Cloud className="size-6 text-muted-foreground shrink-0 self-center" />
							Domains (Cloudflare)
						</CardTitle>
						<CardDescription className="break-words">
							Connected with token ending in{" "}
							<span className="font-mono">****{settings.apiTokenLast4}</span>
						</CardDescription>
					</div>
					<div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto shrink-0">
						<Button
							type="button"
							variant="outline"
							size="default"
							className="w-full sm:w-auto"
							isLoading={previewLoading}
							onClick={handleOpenDnsReview}
						>
							Review DNS targets
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="default"
							className="w-full sm:w-auto"
							isLoading={syncZones.isPending}
							onClick={() => syncZones.mutate()}
						>
							<RefreshCw className="size-4 mr-2" aria-hidden />
							Sync zones
						</Button>
					</div>
				</CardHeader>
				<CardContent className="border-t py-6">
					{isPending ? (
						<div className="flex flex-col sm:flex-row items-center justify-center gap-3 min-h-[12rem] text-sm text-muted-foreground">
							<Loader2 className="size-5 animate-spin" aria-hidden />
							<span>Loading zones…</span>
						</div>
					) : !zones?.length ? (
						<div className="flex flex-col items-center justify-center gap-2 min-h-[12rem] text-center px-2">
							<Cloud className="size-8 text-muted-foreground" aria-hidden />
							<p className="text-sm text-muted-foreground max-w-md">
								No zones found. Click <span className="font-medium text-foreground">Sync now</span>{" "}
								to import zones from Cloudflare.
							</p>
						</div>
					) : (
						<div className="rounded-lg border overflow-hidden">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Zone</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="hidden sm:table-cell">Proxy</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{zones.map((z) => (
										<TableRow key={z.cfZoneId}>
											<TableCell className="font-medium align-top">{z.name}</TableCell>
											<TableCell>
												<div className="flex flex-wrap items-center gap-2">
													<Badge variant={statusVariant(z.status)}>{z.status}</Badge>
													{z.paused && <Badge variant="outline">paused</Badge>}
												</div>
											</TableCell>
											<TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
												Managed per domain
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</div>
		</Card>
		</>
	)
}
