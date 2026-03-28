"use client"

import {
	aliasFormSchema,
	catchAllFormSchema,
	extractTlsFormSchema,
	mailboxFormSchema,
} from "@dokploy/server/validations/dns-mail-schemas"
import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"
import { EmailsStackCard } from "@/components/dashboard/emails/emails-stack-card"
import { MailAliasesCard } from "@/components/dashboard/emails/mail-aliases-card"
import { MailCatchAllCard } from "@/components/dashboard/emails/mail-catch-all-card"
import { MailDomainsListCard } from "@/components/dashboard/emails/mail-domains-list-card"
import { MailMailboxesCard } from "@/components/dashboard/emails/mail-mailboxes-card"
import { MailTlsExtractCard } from "@/components/dashboard/emails/mail-tls-extract-card"
import { useEmailsPageSelection } from "@/components/dashboard/emails/use-emails-page-selection"
import { api } from "@/utils/api"

type CatchAllForm = z.infer<typeof catchAllFormSchema>
type MailboxForm = z.infer<typeof mailboxFormSchema>
type AliasForm = z.infer<typeof aliasFormSchema>
type TlsForm = z.infer<typeof extractTlsFormSchema>

export const ManageEmails = () => {
	const { data: stackRef } = api.dns.stackReference.useQuery()
	const {
		data: allDomains,
		refetch: refetchAllDomains,
		isPending: pendingAllDomains,
	} = api.dns.listDomains.useQuery()
	const {
		data: mailDomains,
		refetch: refetchMailDomains,
		isPending: pendingMailDomains,
	} = api.mail.listMailDomains.useQuery()

	const { selectedId, selectMailDomain } = useEmailsPageSelection()

	const selected = useMemo(
		() => mailDomains?.find((d) => d.id === selectedId) ?? null,
		[mailDomains, selectedId],
	)

	const { data: mailboxes, refetch: refetchMailboxes } =
		api.mail.listMailboxes.useQuery(
			{ domainId: selectedId ?? "" },
			{ enabled: !!selectedId },
		)
	const { data: aliases, refetch: refetchAliases } = api.mail.listAliases.useQuery(
		{ domainId: selectedId ?? "" },
		{ enabled: !!selectedId },
	)

	const catchAllForm = useForm<CatchAllForm>({
		resolver: zodResolver(catchAllFormSchema),
		defaultValues: { catchAllLocalPart: "" },
	})

	const mailboxForm = useForm<MailboxForm>({
		resolver: zodResolver(mailboxFormSchema),
		defaultValues: { localPart: "", password: "" },
	})

	const aliasForm = useForm<AliasForm>({
		resolver: zodResolver(aliasFormSchema),
		defaultValues: { sourceLocalPart: "", destination: "" },
	})

	const tlsForm = useForm<TlsForm>({
		resolver: zodResolver(extractTlsFormSchema),
		defaultValues: { domain: "" },
	})

	const [connectionOpen, setConnectionOpen] = useState(false)
	const [connectionLocalPart, setConnectionLocalPart] = useState<string | null>(
		null,
	)

	const updateDomain = api.dns.updateDomain.useMutation({
		onSuccess: () => {
			toast.success("Domain updated")
			void refetchMailDomains()
			void refetchAllDomains()
		},
		onError: (e) => toast.error(e.message),
	})

	const deployStack = api.dns.deployCoreServices.useMutation({
		onSuccess: () => toast.success("Core services deployment started"),
		onError: (e) => toast.error(e.message),
	})

	const provisionMail = api.mail.provisionMail.useMutation({
		onSuccess: () => {
			toast.success("Mail files written")
			void refetchMailDomains()
			if (selectedId) {
				void refetchMailboxes()
				void refetchAliases()
			}
		},
		onError: (e) => toast.error(e.message),
	})

	const createMailbox = api.mail.createMailbox.useMutation({
		onSuccess: () => {
			toast.success("Mailbox created")
			mailboxForm.reset({ localPart: "", password: "" })
			void refetchMailboxes()
		},
		onError: (e) => toast.error(e.message),
	})

	const createAlias = api.mail.createAlias.useMutation({
		onSuccess: () => {
			toast.success("Alias created")
			aliasForm.reset({ sourceLocalPart: "", destination: "" })
			void refetchAliases()
		},
		onError: (e) => toast.error(e.message),
	})

	const extractMailTls = api.mail.extractMailTls.useMutation({
		onSuccess: () => toast.success("TLS material extracted for mail"),
		onError: (e) => toast.error(e.message),
	})

	useEffect(() => {
		if (selected) {
			catchAllForm.reset({
				catchAllLocalPart: selected.catchAllLocalPart ?? "",
			})
			tlsForm.reset({ domain: selected.name })
		}
	}, [selected, catchAllForm, tlsForm])

	const handleCatchAll = catchAllForm.handleSubmit((values) => {
		if (!selected) {
			return
		}
		updateDomain.mutate({
			id: selected.id,
			catchAllLocalPart: values.catchAllLocalPart?.trim()
				? values.catchAllLocalPart.trim()
				: null,
		})
	})

	const handleMailbox = mailboxForm.handleSubmit((values) => {
		if (!selected) {
			return
		}
		createMailbox.mutate({
			domainId: selected.id,
			localPart: values.localPart,
			password: values.password,
		})
	})

	const handleAlias = aliasForm.handleSubmit((values) => {
		if (!selected) {
			return
		}
		createAlias.mutate({
			domainId: selected.id,
			sourceLocalPart: values.sourceLocalPart,
			destination: values.destination,
		})
	})

	const handleTls = tlsForm.handleSubmit((values) => {
		extractMailTls.mutate({
			domain: values.domain.trim(),
		})
	})

	return (
		<div className="w-full flex flex-col gap-4">
			<EmailsStackCard
				stackRef={stackRef}
				deployPending={deployStack.isPending}
				onDeploy={() => deployStack.mutate({})}
			/>

			<MailDomainsListCard
				allDomains={allDomains}
				mailDomains={mailDomains}
				pendingAllDomains={pendingAllDomains}
				pendingMailDomains={pendingMailDomains}
				selectedId={selectedId}
				onSelectDomain={selectMailDomain}
				onEnableMail={(id) =>
					updateDomain.mutate({ id, isMailManaged: true })
				}
				onProvision={(id) => provisionMail.mutate({ domainId: id })}
				enableMailPending={updateDomain.isPending}
				provisionPending={provisionMail.isPending}
			/>

			{selected && (
				<>
					<MailCatchAllCard
						domainName={selected.name}
						catchAllLocalPart={selected.catchAllLocalPart}
						form={catchAllForm}
						onSubmit={handleCatchAll}
						savePending={updateDomain.isPending}
					/>

					<MailMailboxesCard
						domainName={selected.name}
						form={mailboxForm}
						onSubmitMailbox={handleMailbox}
						createPending={createMailbox.isPending}
						mailboxes={mailboxes}
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
						domainName={selected.name}
						form={aliasForm}
						onSubmitAlias={handleAlias}
						createPending={createAlias.isPending}
						aliases={aliases}
					/>

					<MailTlsExtractCard
						domainPlaceholder={selected.name}
						form={tlsForm}
						onSubmitTls={handleTls}
						extractPending={extractMailTls.isPending}
					/>
				</>
			)}
		</div>
	)
}
