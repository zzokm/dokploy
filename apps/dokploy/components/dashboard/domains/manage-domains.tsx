"use client"

import { addDomainFormSchema } from "@dokploy/server/validations/dns-mail-schemas"
import { zodResolver } from "@hookform/resolvers/zod"
import { Globe, Loader2 } from "lucide-react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"
import { AlertBlock } from "@/components/shared/alert-block"
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

type AddDomainForm = z.infer<typeof addDomainFormSchema>

export const ManageDomains = () => {
	const {
		data: domains,
		refetch,
		isPending,
	} = api.dns.listDomains.useQuery()
	const { data: dnsStatus, refetch: refetchDnsStatus } =
		api.dns.dnsStackStatus.useQuery({}, { refetchOnWindowFocus: false })

	const createDomain = api.dns.createDomain.useMutation({
		onSuccess: () => {
			toast.success("Domain created")
			void refetch()
			void refetchDnsStatus()
		},
		onError: (e) => toast.error(e.message),
	})

	const deployStack = api.dns.deployCoreServices.useMutation({
		onSuccess: () => {
			toast.success("Core services reconcile started")
			void refetchDnsStatus()
		},
		onError: (e) => toast.error(e.message),
	})

	const applyDns = api.dns.applyDns.useMutation({
		onSuccess: () => {
			toast.success("DNS applied")
			void refetchDnsStatus()
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
							Hosted domains: enable DNS and mail, then open DNS or Emails for
							records and mailboxes.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2 py-8 border-t">
						<div className="flex flex-wrap gap-2 pb-2">
							<Button
								type="button"
								variant="secondary"
								isLoading={deployStack.isPending}
								onClick={() => deployStack.mutate({})}
							>
								Reconcile core services
							</Button>
						</div>
						{dnsStatus && (
							<AlertBlock type={dnsStatus.ok ? "success" : "warning"}>
								<span className="font-medium">BIND: </span>
								{dnsStatus.message}
							</AlertBlock>
						)}
						<AlertBlock type="info">
							Set <code className="text-xs">PANEL_SKIP_RNDC_RELOAD=true</code>{" "}
							to write zone files without running{" "}
							<code className="text-xs">rndc reload</code> (debug only). Restart
							the process after changing env.
						</AlertBlock>

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
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Domain</TableHead>
												<TableHead>DNS</TableHead>
												<TableHead>Mail</TableHead>
												<TableHead className="text-right">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{domains.map((d) => (
												<TableRow key={d.id}>
													<TableCell className="font-medium">{d.name}</TableCell>
													<TableCell>
														{d.isDnsManaged ? (
															<Badge variant="default">On</Badge>
														) : (
															<Badge variant="secondary">Off</Badge>
														)}
													</TableCell>
													<TableCell>
														{d.isMailManaged ? (
															<Badge variant="default">On</Badge>
														) : (
															<Badge variant="secondary">Off</Badge>
														)}
													</TableCell>
													<TableCell className="text-right space-x-2">
														<Button size="sm" variant="outline" asChild>
															<Link
																href={`/dashboard/dns?domainId=${encodeURIComponent(d.id)}`}
															>
																Manage DNS
															</Link>
														</Button>
														<Button size="sm" variant="outline" asChild>
															<Link
																href={`/dashboard/emails?domainId=${encodeURIComponent(d.id)}`}
															>
																Manage mail
															</Link>
														</Button>
														<Button
															size="sm"
															variant="secondary"
															type="button"
															isLoading={applyDns.isPending}
															onClick={() =>
																applyDns.mutate({ domainId: d.id })
															}
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
								)}
							</>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	)
}
