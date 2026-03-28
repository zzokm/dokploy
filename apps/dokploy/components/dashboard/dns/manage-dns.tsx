"use client"

import { dnsRecordFormSchema } from "@dokploy/server/validations/dns-mail-schemas"
import { zodResolver } from "@hookform/resolvers/zod"
import { Globe, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/router"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"
import { AlertBlock } from "@/components/shared/alert-block"
import { DialogAction } from "@/components/shared/dialog-action"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { api } from "@/utils/api"

type DnsRecordForm = z.infer<typeof dnsRecordFormSchema>

export const ManageDns = () => {
	const router = useRouter()
	const q = router.query.domainId
	const domainIdParam: string | null =
		typeof q === "string" ? q : Array.isArray(q) ? (q[0] ?? null) : null
	const [domainId, setDomainId] = useState<string | null>(domainIdParam)

	useEffect(() => {
		setDomainId(domainIdParam)
	}, [domainIdParam])

	const { data: domains, isPending: domainsPending } =
		api.dns.listDomains.useQuery()

	const selected = useMemo(
		() => domains?.find((d) => d.id === domainId) ?? null,
		[domains, domainId],
	)

	const { data: records, refetch: refetchRecords } = api.dns.listRecords.useQuery(
		{ domainId: domainId ?? "" },
		{ enabled: !!domainId },
	)

	const { data: dnsStatus, refetch: refetchDnsStatus } =
		api.dns.dnsStackStatus.useQuery({}, { refetchOnWindowFocus: false })

	const applyDns = api.dns.applyDns.useMutation({
		onSuccess: () => {
			toast.success("DNS applied")
			void refetchDnsStatus()
		},
		onError: (e) => toast.error(e.message),
	})

	const deleteRecord = api.dns.deleteRecord.useMutation({
		onSuccess: () => {
			toast.success("Record removed")
			void refetchRecords()
		},
		onError: (e) => toast.error(e.message),
	})

	const recordForm = useForm<DnsRecordForm>({
		resolver: zodResolver(dnsRecordFormSchema),
		defaultValues: {
			type: "A",
			recordName: "@",
			content: "",
			priority: "10",
		},
	})

	const createRecord = api.dns.createRecord.useMutation({
		onSuccess: (_data, variables) => {
			toast.success("Record added")
			const t = variables.type
			const formType =
				t === "A" || t === "TXT" || t === "MX" ? t : ("A" as const)
			recordForm.reset({
				type: formType,
				recordName: "@",
				content: "",
				priority: "10",
			})
			void refetchRecords()
		},
		onError: (e) => toast.error(e.message),
	})

	useEffect(() => {
		recordForm.reset({
			type: "A",
			recordName: "@",
			content: "",
			priority: "10",
		})
	}, [domainId, recordForm])

	const handleDomainChange = (id: string) => {
		setDomainId(id)
		void router.replace(
			{ pathname: "/dashboard/dns", query: { domainId: id } },
			undefined,
			{ shallow: true, scroll: false },
		)
	}

	const handleAddRecord = recordForm.handleSubmit((values) => {
		if (!selected) {
			return
		}
		const priority =
			values.type === "MX"
				? Number.parseInt(values.priority ?? "10", 10)
				: undefined
		createRecord.mutate({
			domainId: selected.id,
			type: values.type,
			recordName: values.recordName,
			content: values.content,
			...(values.type === "MX" && priority !== undefined && { priority }),
		})
	})

	if (domainsPending) {
		return (
			<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[25vh]">
				<span>Loading...</span>
				<Loader2 className="animate-spin size-4" aria-hidden />
			</div>
		)
	}

	return (
		<div className="w-full flex flex-col gap-4">
			<Card className="h-full p-2.5 rounded-xl max-w-5xl mx-auto w-full">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<Globe className="size-6 text-muted-foreground self-center" />
							DNS records
						</CardTitle>
						<CardDescription>
							Select a hosted domain, add records, then apply to write zone files
							and reload BIND.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 py-8 border-t">
						<div className="flex flex-wrap gap-2 items-center">
							<span className="text-sm text-muted-foreground">Domain</span>
							<select
								className="border rounded-md px-2 py-1.5 text-sm bg-background min-w-[200px]"
								value={domainId ?? ""}
								onChange={(e) => {
									const v = e.target.value
									if (!v) {
										setDomainId(null)
										void router.replace(
											{ pathname: "/dashboard/dns", query: {} },
											undefined,
											{ shallow: true, scroll: false },
										)
										return
									}
									handleDomainChange(v)
								}}
								aria-label="Select domain for DNS"
							>
								<option value="">— Choose —</option>
								{domains?.map((d) => (
									<option key={d.id} value={d.id}>
										{d.name}
									</option>
								))}
							</select>
							<Button variant="link" asChild className="px-2">
								<Link href="/dashboard/domains">Manage domains</Link>
							</Button>
						</div>

						{dnsStatus && (
							<AlertBlock type={dnsStatus.ok ? "success" : "warning"}>
								<span className="font-medium">BIND: </span>
								{dnsStatus.message}
							</AlertBlock>
						)}

						{!domainId && (
							<AlertBlock type="info">
								Choose a domain above or open this page from{" "}
								<Link
									href="/dashboard/domains"
									className="text-primary underline-offset-4 hover:underline"
								>
									Domains
								</Link>
								.
							</AlertBlock>
						)}

						{domainId && !selected && (
							<AlertBlock type="warning">
								Domain not found. Return to{" "}
								<Link
									href="/dashboard/domains"
									className="text-primary underline-offset-4 hover:underline"
								>
									Domains
								</Link>
								.
							</AlertBlock>
						)}

						{selected && (
							<>
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="secondary"
										isLoading={applyDns.isPending}
										onClick={() =>
											applyDns.mutate({ domainId: selected.id })
										}
									>
										Apply DNS
									</Button>
								</div>

								<Form {...recordForm}>
									<form
										onSubmit={handleAddRecord}
										className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end"
									>
										<FormField
											control={recordForm.control}
											name="type"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Type</FormLabel>
													<Select
														onValueChange={field.onChange}
														value={field.value}
													>
														<FormControl>
															<SelectTrigger>
																<SelectValue />
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															<SelectItem value="A">A</SelectItem>
															<SelectItem value="TXT">TXT</SelectItem>
															<SelectItem value="MX">MX</SelectItem>
														</SelectContent>
													</Select>
													<FormMessage />
												</FormItem>
											)}
										/>
										<FormField
											control={recordForm.control}
											name="recordName"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Name</FormLabel>
													<FormControl>
														<Input {...field} />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										<FormField
											control={recordForm.control}
											name="content"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Content</FormLabel>
													<FormControl>
														<Input {...field} />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										{recordForm.watch("type") === "MX" && (
											<FormField
												control={recordForm.control}
												name="priority"
												render={({ field }) => (
													<FormItem>
														<FormLabel>Priority</FormLabel>
														<FormControl>
															<Input {...field} />
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
										)}
										<Button
											type="submit"
											className="md:col-span-4 w-full sm:w-auto"
											isLoading={createRecord.isPending}
										>
											Add record
										</Button>
									</form>
								</Form>

								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Type</TableHead>
											<TableHead>Name</TableHead>
											<TableHead>Content</TableHead>
											<TableHead>TTL</TableHead>
											<TableHead className="text-right w-[100px]"> </TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{records?.map((r) => (
											<TableRow key={r.id}>
												<TableCell>{r.type}</TableCell>
												<TableCell>{r.recordName}</TableCell>
												<TableCell className="max-w-[280px] truncate">
													{r.content}
												</TableCell>
												<TableCell>{r.ttl}</TableCell>
												<TableCell className="text-right">
													<DialogAction
														title="Delete record"
														description="Remove this DNS record."
														type="destructive"
														onClick={async () => {
															await deleteRecord.mutateAsync({ id: r.id })
														}}
													>
														<Button
															size="sm"
															variant="ghost"
															className="text-destructive"
														>
															Delete
														</Button>
													</DialogAction>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	)
}
