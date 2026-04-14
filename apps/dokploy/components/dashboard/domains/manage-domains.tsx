"use client"

import { addDomainFormSchema } from "@dokploy/server/validations/dns-mail-schemas"
import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronRight, Globe, Loader2 } from "lucide-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"
import { DialogAction } from "@/components/shared/dialog-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion"
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { api } from "@/utils/api"
import { DomainDnsPanel } from "./domain-dns-panel"

type AddDomainForm = z.infer<typeof addDomainFormSchema>

export const ManageDomains = () => {
	const {
		data: domains,
		refetch,
		isPending,
	} = api.dns.listDomains.useQuery()

	const createDomain = api.dns.createDomain.useMutation({
		onSuccess: () => {
			toast.success("Domain created")
			void refetch()
		},
		onError: (e) => toast.error(e.message),
	})

	const applyDns = api.dns.applyDns.useMutation({
		onSuccess: () => {
			toast.success("DNS applied")
		},
		onError: (e) => toast.error(e.message),
	})

	const deleteDomain = api.dns.deleteDomain.useMutation({
		onSuccess: () => {
			toast.success("Domain removed")
			void refetch()
		},
		onError: (e) => toast.error(e.message),
	})

	const addDomainForm = useForm<AddDomainForm>({
		resolver: zodResolver(addDomainFormSchema),
		defaultValues: { name: "" },
	})

	const handleAddDomain = addDomainForm.handleSubmit((values) => {
		createDomain.mutate({
			name: values.name.trim(),
			isDnsManaged: true,
			isMailManaged: false,
		})
		addDomainForm.reset({ name: "" })
	})

	return (
		<div className="w-full">
			<Card className="h-full p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<Globe className="size-6 text-muted-foreground self-center" />
							Domains
						</CardTitle>
						<CardDescription>
							Add a domain, then copy the required DNS records into your DNS
							provider. You can also manage zone records per domain if you choose
							to.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2 py-8 border-t">
						{isPending ? (
							<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[25vh]">
								<span>Loading...</span>
								<Loader2 className="animate-spin size-4" aria-hidden />
							</div>
						) : (
							<>
								<Form {...addDomainForm}>
									<form
										onSubmit={handleAddDomain}
										className="flex flex-wrap gap-2 items-end pb-4"
									>
										<FormField
											control={addDomainForm.control}
											name="name"
											render={({ field }) => (
												<FormItem className="flex-1 min-w-[200px]">
													<FormLabel>Add domain</FormLabel>
													<FormControl>
														<Input
															placeholder="example.com"
															autoComplete="off"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										<Button type="submit" isLoading={createDomain.isPending}>
											Add domain
										</Button>
									</form>
								</Form>

								{!domains?.length ? (
									<div className="flex flex-col items-center gap-3 min-h-[20vh] justify-center text-muted-foreground">
										<Globe className="size-8" />
										<span className="text-base">
											No domains yet. Add a domain to start.
										</span>
									</div>
								) : (
									<Accordion type="single" collapsible className="w-full">
										{domains.map((d) => (
											<AccordionItem key={d.id} value={d.id} className="border rounded-md mb-2">
												<AccordionTrigger className="px-4 hover:no-underline">
													<div className="flex w-full items-center justify-between gap-3 flex-wrap">
														<div className="flex items-center gap-3">
															<div className="font-medium">{d.name}</div>
															<div className="flex items-center gap-2">
																<Badge variant={d.isDnsManaged ? "default" : "secondary"}>
																	DNS {d.isDnsManaged ? "On" : "Off"}
																</Badge>
																<Badge variant={d.isMailManaged ? "default" : "secondary"}>
																	Mail {d.isMailManaged ? "On" : "Off"}
																</Badge>
															</div>
														</div>
														<div className="flex items-center gap-2">
															<Button
																size="sm"
																variant="ghost"
																type="button"
																className="text-muted-foreground"
															>
																Details <ChevronRight className="size-4 ml-1" aria-hidden />
															</Button>
														</div>
													</div>
												</AccordionTrigger>
												<AccordionContent className="px-4 pb-4">
													<div className="flex items-center justify-end gap-2 pb-3">
														<Button
															size="sm"
															variant="secondary"
															type="button"
															isLoading={applyDns.isPending}
															onClick={() => applyDns.mutate({ domainId: d.id })}
														>
															Apply DNS
														</Button>
														<DialogAction
															title="Delete domain"
															description="This removes the domain and all DNS records for it."
															type="destructive"
															onClick={async () => {
																await deleteDomain.mutateAsync({ id: d.id })
															}}
														>
															<Button size="sm" variant="ghost" className="text-destructive">
																Delete
															</Button>
														</DialogAction>
													</div>

													<DomainDnsPanel domainId={d.id} />
												</AccordionContent>
											</AccordionItem>
										))}
									</Accordion>
								)}
							</>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	)
}
