"use client"

import { Mail } from "lucide-react"
import { AlertBlock } from "@/components/shared/alert-block"
import { Button } from "@/components/ui/button"
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
	deployPending: boolean
	onDeploy: () => void
}

export const EmailsStackCard = ({
	stackRef,
	deployPending,
	onDeploy,
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
				<div className="flex flex-wrap gap-2 pb-2">
					<Button
						type="button"
						variant="secondary"
						isLoading={deployPending}
						onClick={onDeploy}
					>
						Reconcile core services
					</Button>
				</div>
				<AlertBlock type="info">
					Core services are managed automatically and are expected to stay online
					24/7. If anything is missing or stopped, use{" "}
					<span className="font-medium">Reconcile core services</span> to
					(deploy/start) them.
				</AlertBlock>
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
