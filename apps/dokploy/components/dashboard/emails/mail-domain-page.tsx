"use client"

import { Globe, Mail, RefreshCw } from "lucide-react"
import Link from "next/link"
import {
	aliasFormSchema,
	catchAllFormSchema,
} from "@dokploy/server/validations/dns-mail-schemas"
import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"
import { MailAliasesCard } from "@/components/dashboard/emails/mail-aliases-card"
import { MailCatchAllCard } from "@/components/dashboard/emails/mail-catch-all-card"
import { MailMailboxesCard } from "@/components/dashboard/emails/mail-mailboxes-card"
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { api } from "@/utils/api"

type MailDomainPageProps = {
	domainId: string
}

type CatchAllForm = z.infer<typeof catchAllFormSchema>
type AliasForm = z.infer<typeof aliasFormSchema>

export const MailDomainPage = ({ domainId }: MailDomainPageProps) => {
	const utils = api.useUtils()
	const [connectionOpen, setConnectionOpen] = useState(false)
	const [connectionLocalPart, setConnectionLocalPart] = useState<string | null>(null)

	const { data: mailDomains, isPending: pendingMailDomains } =
		api.mail.listMailDomains.useQuery()

	const domain = useMemo(
		() => mailDomains?.find((d) => d.id === domainId) ?? null,
		[mailDomains, domainId],
	)

	const { data: mailboxes, refetch: refetchMailboxes } = api.mail.listMailboxes.useQuery(
		{ domainId },
		{ enabled: !!domainId },
	)
	const { data: aliases, refetch: refetchAliases } = api.mail.listAliases.useQuery(
		{ domainId },
		{ enabled: !!domainId },
	)

	const updateDomain = api.mail.updateDomain.useMutation({
		onSuccess: async () => {
			toast.success("Domain updated")
			await utils.mail.listMailDomains.invalidate()
		},
		onError: (e) => toast.error(e.message),
	})

	const setEmailHosting = api.mail.setEmailHosting.useMutation({
		onSuccess: async () => {
			toast.success("Email hosting updated")
			await utils.mail.listMailDomains.invalidate()
		},
		onError: (e) => toast.error(e.message),
	})

	const catchAllForm = useForm<CatchAllForm>({
		resolver: zodResolver(catchAllFormSchema),
		defaultValues: { catchAllLocalPart: "" },
	})

	const aliasForm = useForm<AliasForm>({
		resolver: zodResolver(aliasFormSchema),
		defaultValues: { sourceLocalPart: "", destination: "" },
	})

	useEffect(() => {
		if (!domain) {
			return
		}
		catchAllForm.reset({
			catchAllLocalPart:
				(domain as { catchAllLocalPart?: string | null }).catchAllLocalPart ?? "",
		})
	}, [domain, catchAllForm])

	const createAlias = api.mail.createAlias.useMutation({
		onSuccess: async () => {
			toast.success("Alias created")
			aliasForm.reset({ sourceLocalPart: "", destination: "" })
			await refetchAliases()
		},
		onError: (e) => toast.error(e.message),
	})

	const checkDns = api.mail.checkDnsPropagation.useMutation({
		onSuccess: (data) => {
			const bad = data.checks.filter((c) => c.status !== "ok").length
			if (bad) {
				toast.error(`${bad} DNS check(s) not propagated yet`)
			} else {
				toast.success("DNS looks propagated")
			}
		},
		onError: (e) => toast.error(e.message),
	})

	const services = api.mail.stackStatus.useQuery()
	const [dnsChecks, setDnsChecks] = useState<
		Array<{
			name: string
			type: string
			status: "ok" | "missing" | "mismatch" | "error"
			details?: string | null
		}>
	>([])

	if (pendingMailDomains) {
		return (
			<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2 items-center">
							<Mail className="size-6 text-muted-foreground shrink-0" aria-hidden />
							Mail domain
						</CardTitle>
					</CardHeader>
					<CardContent className="border-t py-8 text-sm text-muted-foreground">
						Loading…
					</CardContent>
				</div>
			</Card>
		)
	}

	if (!domain) {
		return (
			<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2 items-center">
							<Mail className="size-6 text-muted-foreground shrink-0" aria-hidden />
							Mail domain not found
						</CardTitle>
						<CardDescription>
							Go back to{" "}
							<Link
								href="/dashboard/emails"
								className="text-primary underline-offset-4 hover:underline"
							>
								Emails
							</Link>
							.
						</CardDescription>
					</CardHeader>
				</div>
			</Card>
		)
	}

	const mailserverOk = services.data?.mailserver?.running ?? null
	const roundcubeOk = services.data?.roundcube?.running ?? null

	const spf = dnsChecks.find((c) => c.type === "TXT (SPF)") ?? null
	const dmarc = dnsChecks.find((c) => c.type === "TXT (DMARC)") ?? null
	const dkim = dnsChecks.find((c) => c.type === "TXT (DKIM)") ?? null

	const checklistVariant = (status: string | null) => {
		if (status === "ok") return "default"
		if (status === "missing") return "secondary"
		return "outline"
	}

	return (
		<div className="flex flex-col gap-6">
			<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-1 min-w-0">
							<CardTitle className="text-xl flex flex-row gap-2 items-center">
								<Globe className="size-6 text-muted-foreground shrink-0" aria-hidden />
								{domain.name}
							</CardTitle>
							<CardDescription>
								Manage mailboxes, aliases, webmail, and verify DNS propagation for this domain.
							</CardDescription>
						</div>
						<div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
							<Button asChild type="button" variant="outline" className="w-full sm:w-auto">
								<Link href="/dashboard/emails">Back</Link>
							</Button>
							<Button
								type="button"
								variant="secondary"
								className="w-full sm:w-auto"
								isLoading={checkDns.isPending}
								onClick={() => checkDns.mutate({ domainId })}
							>
								<RefreshCw className="mr-2 size-4" aria-hidden />
								Validate DNS
							</Button>
						</div>
					</CardHeader>
					<CardContent className="border-t py-6 space-y-4">
						<div className="flex flex-wrap gap-2">
							<Badge variant={mailserverOk ? "default" : "secondary"}>
								Mail: {mailserverOk ? "Running" : "Unknown"}
							</Badge>
							<Badge variant={roundcubeOk ? "default" : "secondary"}>
								Webmail: {roundcubeOk ? "Running" : "Unknown"}
							</Badge>
							{domain.dkimSelector ? (
								<Badge>DKIM: {domain.dkimSelector}</Badge>
							) : (
								<Badge variant="secondary">DKIM: Pending</Badge>
							)}
						</div>
						<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border bg-muted/30 p-4">
							<div className="space-y-0.5">
								<div className="text-sm font-medium">Where is email hosted?</div>
								<div className="text-xs text-muted-foreground">
									Set to External/None to prevent Dokploy from pushing MX/SPF/DKIM/DMARC records.
								</div>
							</div>
							<Select
								value={(domain as { emailHosting?: string | null }).emailHosting ?? "none"}
								onValueChange={(v) => {
									setEmailHosting.mutate({
										domainId,
										emailHosting: v as "dokploy" | "external" | "none",
									})
								}}
							>
								<SelectTrigger
									className="h-9 w-full sm:w-[200px]"
									aria-label="Where email is hosted"
									disabled={setEmailHosting.isPending}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="dokploy">Dokploy</SelectItem>
									<SelectItem value="external">External</SelectItem>
									<SelectItem value="none">None</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="rounded-lg border bg-muted/30 p-4 space-y-3">
							<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
								<div className="space-y-0.5">
									<div className="text-sm font-medium">DNS health</div>
									<div className="text-xs text-muted-foreground">
										Check SPF, DKIM, and DMARC propagation to improve deliverability.
									</div>
								</div>
								<Button
									type="button"
									size="sm"
									variant="outline"
									isLoading={checkDns.isPending}
									onClick={() =>
										checkDns.mutate(
											{ domainId },
											{
												onSuccess: (data) => {
													setDnsChecks(data.checks)
												},
											},
										)
									}
								>
									<RefreshCw className="mr-2 size-4" aria-hidden />
									Run checks
								</Button>
							</div>

							<div className="flex flex-wrap gap-2">
								<Badge variant={checklistVariant(spf?.status ?? null)}>
									SPF: {spf?.status ?? "not checked"}
								</Badge>
								<Badge variant={checklistVariant(dkim?.status ?? null)}>
									DKIM: {dkim?.status ?? "not checked"}
								</Badge>
								<Badge variant={checklistVariant(dmarc?.status ?? null)}>
									DMARC: {dmarc?.status ?? "not checked"}
								</Badge>
							</div>

							{dnsChecks.length ? (
								<div className="space-y-2 text-xs text-muted-foreground">
									{[spf, dkim, dmarc].map((c) =>
										c ? (
											<div key={`${c.type}-${c.name}`} className="space-y-0.5">
												<div className="font-medium text-foreground">{c.type}</div>
												{c.details ? (
													<div className="font-mono break-all">{c.details}</div>
												) : (
													<div className="font-mono">—</div>
												)}
											</div>
										) : null,
									)}
								</div>
							) : (
								<p className="text-xs text-muted-foreground">
									Click <span className="font-medium text-foreground">Run checks</span> to fetch live DNS.
								</p>
							)}
						</div>
					</CardContent>
				</div>
			</Card>

			<MailCatchAllCard
				domainName={domain.name}
				catchAllLocalPart={
					(domain as { catchAllLocalPart?: string | null }).catchAllLocalPart ?? null
				}
				form={catchAllForm}
				onSubmit={catchAllForm.handleSubmit((values) => {
					updateDomain.mutate({
						id: domainId,
						catchAllLocalPart: values.catchAllLocalPart?.trim()
							? values.catchAllLocalPart.trim()
							: null,
					})
				})}
				savePending={updateDomain.isPending}
			/>

			<MailMailboxesCard
				domainId={domainId}
				domainName={domain.name}
				mailboxes={mailboxes}
				onMailboxesChanged={() => {
					void refetchMailboxes()
					void refetchAliases()
				}}
				connectionOpen={connectionOpen}
				connectionLocalPart={connectionLocalPart}
				onConnectionOpenChange={(open) => {
					setConnectionOpen(open)
					if (!open) {
						setConnectionLocalPart(null)
					}
				}}
				onOpenConnection={(localPart) => {
					setConnectionLocalPart(localPart)
					setConnectionOpen(true)
				}}
			/>

			<MailAliasesCard
				domainName={domain.name}
				form={aliasForm}
				onSubmitAlias={aliasForm.handleSubmit((values) => {
					createAlias.mutate({
						domainId,
						sourceLocalPart: values.sourceLocalPart,
						destination: values.destination,
					})
				})}
				createPending={createAlias.isPending}
				aliases={aliases}
			/>
		</div>
	)
}

