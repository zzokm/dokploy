"use client"

import { Mail } from "lucide-react"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"

type StackRef = {
	bindImage: string
	eximImage: string
	dovecotImage: string
	roundcubeImage: string
}

type EmailsStackCardProps = {
	stackRef: StackRef | undefined
}

export const EmailsStackCard = ({
	stackRef,
}: EmailsStackCardProps) => (
	<Card className="h-full p-2.5 rounded-xl max-w-5xl mx-auto w-full">
		<div className="rounded-xl bg-background shadow-md">
			<CardHeader>
				<CardTitle className="text-xl flex flex-row gap-2">
					<Mail className="size-6 text-muted-foreground self-center" />
					Emails
				</CardTitle>
				<CardDescription>
					Mail stack: Exim (SMTP), Dovecot (IMAP), optional Roundcube webmail.
					Provision files and DKIM after enabling mail on a domain.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-2 py-8 border-t">
				{stackRef ? (
					<div className="text-xs text-muted-foreground">
						Images: {stackRef.bindImage}, {stackRef.eximImage},{" "}
						{stackRef.dovecotImage}, {stackRef.roundcubeImage}
					</div>
				) : null}
			</CardContent>
		</div>
	</Card>
)
