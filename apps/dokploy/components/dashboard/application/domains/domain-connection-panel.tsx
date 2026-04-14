"use client"

import { Copy, Loader2, RefreshCw } from "lucide-react"
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

type DomainConnectionPanelProps = {
	domainId: string
}

const copyToClipboard = async (text: string) => {
	try {
		await navigator.clipboard.writeText(text)
		toast.success("Copied to clipboard")
	} catch {
		toast.error("Failed to copy")
	}
}

const badgeClassForStatus = (status: string | null | undefined) => {
	switch (status) {
		case "active":
			return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20"
		case "checking":
			return "bg-yellow-500/10 text-yellow-800 dark:text-yellow-300 border-yellow-500/20"
		case "dns_mismatch":
		case "dns_no_answer":
		case "error":
			return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
		case "server_unreachable":
			return "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/20"
		default:
			return "bg-muted text-muted-foreground border-transparent"
	}
}

const labelForStatus = (status: string | null | undefined) => {
	switch (status) {
		case "active":
			return "Active"
		case "checking":
			return "Checking"
		case "dns_mismatch":
			return "DNS mismatch"
		case "dns_no_answer":
			return "No DNS answers"
		case "server_unreachable":
			return "Server unreachable"
		case "error":
			return "Error"
		default:
			return "Pending"
	}
}

export const DomainConnectionPanel = ({ domainId }: DomainConnectionPanelProps) => {
	const utils = api.useUtils()
	const instructions = api.domain.getConnectionInstructions.useQuery({ domainId })
	const status = api.domain.getConnectionStatus.useQuery({ domainId })

	const verify = api.domain.verifyConnection.useMutation({
		onSuccess: async () => {
			await utils.domain.getConnectionStatus.invalidate({ domainId })
			toast.success("Verification complete")
		},
		onError: (e) => toast.error(e.message),
	})

	const currentStatus = status.data?.status ?? "pending"
	const statusMessage = status.data?.message ?? null

	return (
		<div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
			<div className="space-y-1">
				<p className="text-sm font-medium">Connection &amp; DNS</p>
				<p className="text-xs text-muted-foreground">
					Point DNS at your server, then verify. Copy values into your DNS provider if you are not using Cloudflare automation.
				</p>
			</div>

			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
				<Badge variant="outline" className={badgeClassForStatus(currentStatus)}>
					{verify.isPending || status.isFetching ? (
						<>
							<Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
							Checking
						</>
					) : (
						labelForStatus(currentStatus)
					)}
				</Badge>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="w-full sm:w-auto shrink-0"
					isLoading={verify.isPending}
					onClick={() => verify.mutate({ domainId })}
				>
					<RefreshCw className="size-4 mr-2" aria-hidden />
					Verify connection
				</Button>
			</div>

			{statusMessage ? (
				<p className="text-sm text-muted-foreground">{statusMessage}</p>
			) : null}

			{instructions.isPending ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
					<Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
					<span>Loading DNS instructions…</span>
				</div>
			) : instructions.data?.records?.length ? (
				<div className="rounded-lg border border-border overflow-hidden bg-background">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-[72px] sm:w-[90px]">Type</TableHead>
								<TableHead className="w-[100px] sm:w-[140px]">Name</TableHead>
								<TableHead>Value</TableHead>
								<TableHead className="text-right w-12 sm:w-14"> </TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{instructions.data.records.map((r) => (
								<TableRow key={`${r.type}-${r.name}-${r.value}`}>
									<TableCell className="font-medium align-top">{r.type}</TableCell>
									<TableCell className="align-top">{r.name}</TableCell>
									<TableCell className="font-mono text-xs break-all align-top">
										{r.value}
									</TableCell>
									<TableCell className="text-right align-top">
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="shrink-0"
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
			) : (
				<p className="text-sm text-muted-foreground">
					No DNS instructions available for this domain yet.
				</p>
			)}
		</div>
	)
}
