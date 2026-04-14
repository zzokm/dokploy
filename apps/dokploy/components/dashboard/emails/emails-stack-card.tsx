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
	mailserverImage: string
	roundcubeImage: string
}

type EmailsStackCardProps = {
	stackRef: StackRef | undefined
}

export const EmailsStackCard = ({
	stackRef,
}: EmailsStackCardProps) => (
	<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
		<div className="rounded-xl bg-background shadow-md">
			<CardHeader>
				<CardTitle className="text-xl flex flex-row gap-2 items-center">
					<Mail className="size-6 text-muted-foreground shrink-0" aria-hidden />
					Emails
				</CardTitle>
				<CardDescription>
					Mail stack: docker-mailserver (Postfix, Dovecot, filters) and Roundcube webmail.
					Enable mail on a domain, then provision DNS and DKIM.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-2 py-6 sm:py-8 border-t">
				{stackRef ? (
					<p className="text-xs text-muted-foreground font-mono break-all leading-relaxed">
						Images: {stackRef.bindImage}, {stackRef.mailserverImage},{" "}
						{stackRef.roundcubeImage}
					</p>
				) : null}
			</CardContent>
		</div>
	</Card>
)
