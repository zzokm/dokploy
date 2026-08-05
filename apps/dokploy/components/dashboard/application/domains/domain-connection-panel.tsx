"use client"

import { formatDistanceToNow } from "date-fns"
import { Cloud, Copy, Globe, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { api } from "@/utils/api"
import {
	cloudflareConnectionDetails,
	cloudflareConnectionLabel,
	connectionBadgeClass,
	deriveConnectionBadge,
} from "./domain-connection-utils"

type DomainConnectionPanelProps = {
	domainId: string
	dnsValidation?: { isLoading: boolean; isValid?: boolean }
}

const copyToClipboard = async (text: string) => {
	try {
		await navigator.clipboard.writeText(text)
		toast.success("Copied to clipboard")
	} catch {
		toast.error("Failed to copy")
	}
}

const formatSyncedLabel = (iso: string | null) => {
	if (!iso) return null
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return null
	return `synced ${formatDistanceToNow(date, { addSuffix: true })}`
}

export const DomainConnectionPanel = ({
	domainId,
	dnsValidation,
}: DomainConnectionPanelProps) => {
	const utils = api.useUtils()
	const instructions = api.domain.getConnectionInstructions.useQuery({
		domainId,
	})
	const cloudflare = instructions.data?.cloudflare ?? null
	const isCloudflareManaged = !!cloudflare?.managed

	const status = api.domain.getConnectionStatus.useQuery(
		{ domainId },
		{ enabled: instructions.isSuccess && !isCloudflareManaged },
	)

	const verify = api.domain.verifyConnection.useMutation({
		onSuccess: async () => {
			await utils.domain.getConnectionStatus.invalidate({ domainId })
			toast.success("Verification complete")
		},
		onError: (e) => toast.error(e.message),
	})

	if (instructions.isPending) {
		return (
			<div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
				<Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
				<span>Loading DNS details…</span>
			</div>
		)
	}

	if (cloudflare && isCloudflareManaged) {
		const details = cloudflareConnectionDetails(
			cloudflare,
			formatSyncedLabel(cloudflare.lastSyncedAt),
		)

		return (
			<div className="flex w-full animate-in fade-in-0 slide-in-from-bottom-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 duration-300">
				<Cloud className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
				<span
					className={`text-xs font-medium ${
						cloudflare.status === "error" ? "text-red-600 dark:text-red-400" : ""
					}`}
				>
					{cloudflareConnectionLabel(cloudflare)}
				</span>
				{details.length ? (
					<span className="min-w-0 truncate text-xs text-muted-foreground">
						{details.join(" · ")}
					</span>
				) : null}
			</div>
		)
	}

	const badge = deriveConnectionBadge({
		checkStatus: status.data?.status,
		isChecking: verify.isPending || status.isFetching,
		dnsValidation,
	})
	const statusMessage = status.data?.message ?? null

	return (
		<div className="flex w-full animate-in fade-in-0 slide-in-from-bottom-1 flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3.5 duration-300 sm:flex-row sm:items-start">
			<div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
				<Globe className="size-4 text-muted-foreground" aria-hidden />
			</div>
			<div className="min-w-0 flex-1 space-y-3">
				<div className="space-y-1">
					<p className="text-sm font-medium leading-none">Connection &amp; DNS</p>
					<p className="text-xs leading-relaxed text-muted-foreground">
						Copy these records into your DNS provider, then verify.
					</p>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<Badge
						variant="outline"
						className={`w-fit text-[11px] ${connectionBadgeClass(badge)}`}
					>
						{badge === "Checking" ? (
							<>
								<Loader2 className="mr-1 size-3 animate-spin" aria-hidden />
								Checking
							</>
						) : (
							badge
						)}
					</Badge>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-full shrink-0 transition-colors sm:w-auto"
						isLoading={verify.isPending}
						onClick={() => verify.mutate({ domainId })}
					>
						<RefreshCw className="mr-2 size-4" aria-hidden />
						Verify connection
					</Button>
				</div>

				{statusMessage ? (
					<p className="text-xs text-muted-foreground">{statusMessage}</p>
				) : null}

				{instructions.data?.records?.length ? (
					<div className="overflow-hidden rounded-md border border-border bg-background">
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-[72px] sm:w-[90px]">Type</TableHead>
										<TableHead className="w-[100px] sm:w-[140px]">
											Name
										</TableHead>
										<TableHead>Value</TableHead>
										<TableHead className="w-12 text-right sm:w-14"> </TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{instructions.data.records.map((r) => (
										<TableRow key={`${r.type}-${r.name}-${r.value}`}>
											<TableCell className="align-top font-medium">
												{r.type}
											</TableCell>
											<TableCell className="align-top">{r.name}</TableCell>
											<TableCell className="break-all align-top font-mono text-xs">
												{r.value}
											</TableCell>
											<TableCell className="align-top text-right">
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="shrink-0 transition-colors"
													onClick={() => copyToClipboard(r.value)}
													aria-label="Copy DNS value"
												>
													<Copy className="size-4" aria-hidden />
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</div>
				) : (
					<p className="text-xs text-muted-foreground">
						No DNS instructions available for this domain yet.
					</p>
				)}
			</div>
		</div>
	)
}
