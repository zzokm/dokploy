"use client"

import { Copy, Loader2, RefreshCw } from "lucide-react"
import { useMemo } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { api } from "@/utils/api"

type RecordRow = { type: string; name: string; value: string }

const copyToClipboard = async (text: string) => {
	try {
		await navigator.clipboard.writeText(text)
		toast.success("Copied to clipboard")
	} catch {
		toast.error("Failed to copy")
	}
}

const RecordsTable = ({
	title,
	rows,
	isLoading,
}: {
	title: string
	rows: RecordRow[]
	isLoading: boolean
}) => (
	<div className="space-y-2">
		<div className="text-sm font-medium">{title}</div>
		{isLoading ? (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" aria-hidden />
				<span>Loading…</span>
			</div>
		) : !rows.length ? (
			<p className="text-sm text-muted-foreground">No records to show.</p>
		) : (
			<div className="rounded-md border overflow-hidden">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-[80px]">Type</TableHead>
							<TableHead className="w-[160px]">Name</TableHead>
							<TableHead>Value</TableHead>
							<TableHead className="text-right w-[60px]"> </TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((r) => (
							<TableRow key={`${title}-${r.type}-${r.name}-${r.value}`}>
								<TableCell className="font-medium">{r.type}</TableCell>
								<TableCell className="font-mono text-xs">{r.name}</TableCell>
								<TableCell className="font-mono text-xs break-all">
									{r.value}
								</TableCell>
								<TableCell className="text-right">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										onClick={() => copyToClipboard(r.value)}
										aria-label="Copy value"
									>
										<Copy className="size-4" aria-hidden />
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		)}
	</div>
)

export const DomainDnsPanel = ({ domainId }: { domainId: string }) => {
	const utils = api.useUtils()

	const connection = api.dns.getConnectionInfo.useQuery({ domainId })
	const verify = api.dns.verifyConnection.useMutation({
		onSuccess: async (res) => {
			if (res.isValid) {
				toast.success("DNS looks good")
			} else {
				toast.error(res.error ?? "DNS is not configured yet")
			}
			await utils.dns.getConnectionInfo.invalidate({ domainId })
		},
		onError: (e) => toast.error(e.message),
	})

	const { data: records, refetch: refetchRecords } = api.dns.listRecords.useQuery(
		{ domainId },
	)

	const applyDns = api.dns.applyDns.useMutation({
		onSuccess: () => toast.success("DNS applied"),
		onError: (e) => toast.error(e.message),
	})

	const expected = useMemo(() => {
		const a = (connection.data?.records ?? []).map((r) => ({
			type: r.type,
			name: r.name,
			value: r.value,
		}))
		const ns = (connection.data?.nameservers ?? []).map((r) => ({
			type: r.type,
			name: r.name,
			value: r.value,
		}))
		const glue = (connection.data?.glue ?? []).map((r) => ({
			type: r.type,
			name: r.name,
			value: r.value,
		}))
		return { a, ns, glue }
	}, [connection.data])

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-3 flex-wrap">
				<div className="text-sm text-muted-foreground">
					Update your DNS provider to match these records.
				</div>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					isLoading={verify.isPending}
					onClick={() => verify.mutate({ domainId })}
				>
					<RefreshCw className="size-4 mr-2" aria-hidden />
					Verify
				</Button>
			</div>

			<Tabs defaultValue="required">
				<TabsList className="w-full justify-start">
					<TabsTrigger value="required">Required records</TabsTrigger>
					<TabsTrigger value="managed">Managed zone</TabsTrigger>
				</TabsList>

				<TabsContent value="required" className="space-y-4">
					<RecordsTable
						title="A records"
						rows={expected.a}
						isLoading={connection.isPending}
					/>
					<RecordsTable
						title="Nameservers (optional)"
						rows={expected.ns}
						isLoading={connection.isPending}
					/>
					<RecordsTable
						title="Glue (if you use the nameservers)"
						rows={expected.glue}
						isLoading={connection.isPending}
					/>
				</TabsContent>

				<TabsContent value="managed" className="space-y-3">
					<div className="flex items-center gap-2 flex-wrap">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							isLoading={applyDns.isPending}
							onClick={() => applyDns.mutate({ domainId })}
						>
							Apply DNS
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void refetchRecords()}
						>
							Refresh records
						</Button>
					</div>

					<div className="rounded-md border overflow-hidden">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Type</TableHead>
									<TableHead>Name</TableHead>
									<TableHead>Content</TableHead>
									<TableHead>TTL</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{records?.map((r) => (
									<TableRow key={r.id}>
										<TableCell>{r.type}</TableCell>
										<TableCell>{r.recordName}</TableCell>
										<TableCell className="max-w-[320px] truncate">
											{r.content}
										</TableCell>
										<TableCell>{r.ttl}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	)
}

