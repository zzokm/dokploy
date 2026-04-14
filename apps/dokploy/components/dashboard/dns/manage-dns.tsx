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
import { Label } from "@/components/ui/label"
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

const DNS_DOMAIN_NONE = "__dns_domain_none__"

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

	const applyDns = api.dns.applyDns.useMutation({
		onSuccess: () => {
			toast.success("DNS applied")
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
			<div className="flex flex-col sm:flex-row gap-3 items-center justify-center text-sm text-muted-foreground min-h-[25vh]">
				<Loader2 className="animate-spin size-5 shrink-0" aria-hidden />
				<span>Loading…</span>
			</div>
		)
	}

	return (
		<div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
			<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2 items-center">
							<Globe className="size-6 text-muted-foreground shrink-0 self-center" aria-hidden />
							Authoritative DNS (BIND)
						</CardTitle>
						<CardDescription>
							Advanced: manage zone records when Dokploy is authoritative DNS.
							For external DNS, use the connection instructions on each application domain.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6 py-6 sm:py-8 border-t">
						<div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 sm:items-end">
							<div className="space-y-2 min-w-[200px] max-w-md flex-1">
								<Label htmlFor="dns-domain-select">Domain</Label>
								<Select
									value={domainId ?? DNS_DOMAIN_NONE}
									onValueChange={(v) => {
										if (v === DNS_DOMAIN_NONE) {
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
								>
									<SelectTrigger id="dns-domain-select" aria-label="Select domain for DNS">
										<SelectValue placeholder="Choose a domain" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={DNS_DOMAIN_NONE}>Choose a domain</SelectItem>
										{domains?.map((d) => (
											<SelectItem key={d.id} value={d.id}>
												{d.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<Button variant="outline" asChild className="w-full sm:w-auto">
								<Link href="/dashboard/domains">Domains</Link>
							</Button>
						</div>

						{!domainId && (
							<p className="text-sm text-muted-foreground">
								Choose a domain above or open this page from{" "}
								<Link
									href="/dashboard/domains"
									className="text-primary underline-offset-4 hover:underline"
								>
									Domains
								</Link>
								.
							</p>
						)}

						{domainId && !selected && (
							<p className="text-sm text-muted-foreground">
								Domain not found. Return to{" "}
								<Link
									href="/dashboard/domains"
									className="text-primary underline-offset-4 hover:underline"
								>
									Domains
								</Link>
								.
							</p>
						)}

						{selected && (
							<>
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="default"
										className="w-full sm:w-auto"
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

								<div className="rounded-lg border overflow-hidden">
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
								</div>
							</>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	)
}
