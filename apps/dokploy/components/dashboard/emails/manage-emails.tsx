"use client"

import { EmailsStackCard } from "@/components/dashboard/emails/emails-stack-card"
import { MailDomainsListCard } from "@/components/dashboard/emails/mail-domains-list-card"
import { api } from "@/utils/api"

export const ManageEmails = () => {
	const { data: stackRef } = api.mail.stackReference.useQuery()
	const {
		data: mailDomains,
		isPending: pendingMailDomains,
	} = api.mail.listMailDomains.useQuery()

	return (
		<div className="w-full flex flex-col gap-6">
			<EmailsStackCard stackRef={stackRef} />

			<MailDomainsListCard
				mailDomains={mailDomains}
				pendingMailDomains={pendingMailDomains}
			/>
		</div>
	)
}
