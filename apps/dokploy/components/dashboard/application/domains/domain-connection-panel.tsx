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
			return "bg-green-500/10 text-green-600 border-green-500/20"
		case "checking":
			return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
		case "dns_mismatch":
		case "dns_no_answer":
		case "error":
			return "bg-red-500/10 text-red-600 border-red-500/20"
		case "server_unreachable":
			return "bg-amber-500/10 text-amber-600 border-amber-500/20"
		case "pending":
		default:
			return "bg-muted text-muted-foreground"
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
		case "pending":
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
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 flex-wrap">
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
					variant="secondary"
					size="sm"
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
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" aria-hidden />
					<span>Loading DNS instructions…</span>
				</div>
			) : instructions.data?.records?.length ? (
				<div className="rounded-md border overflow-hidden">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-[90px]">Type</TableHead>
								<TableHead className="w-[140px]">Name</TableHead>
								<TableHead>Value</TableHead>
								<TableHead className="text-right w-[60px]"> </TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{instructions.data.records.map((r) => (
								<TableRow key={`${r.type}-${r.name}-${r.value}`}>
									<TableCell className="font-medium">{r.type}</TableCell>
									<TableCell>{r.name}</TableCell>
									<TableCell className="font-mono text-xs break-all">
										{r.value}
									</TableCell>
									<TableCell className="text-right">
										<Button
											type="button"
											variant="ghost"
											size="icon"
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

