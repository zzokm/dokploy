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
						Deploy core services
					</Button>
				</div>
				{stackRef && (
					<AlertBlock type="info">
						<span className="font-medium">Reference images (data plane):</span>
						<ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
							<li>BIND (DNS): {stackRef.bindImage}</li>
							<li>Exim: {stackRef.eximImage}</li>
							<li>Dovecot: {stackRef.dovecotImage}</li>
							<li>Roundcube: {stackRef.roundcubeImage}</li>
						</ul>
						<p className="mt-2 text-sm">
							Third-party licenses: see{" "}
							<code className="text-xs">THIRD_PARTY_LICENSES.md</code> at the
							repository root.
						</p>
					</AlertBlock>
				)}
				<AlertBlock type="warning">
					Use <span className="font-medium">Deploy core services</span> to create
					BIND, Dovecot, Exim, and Roundcube with panel volume paths, or run the
					compose scripts from{" "}
					<code className="text-xs">docker/core-services</code>.
				</AlertBlock>
			</CardContent>
		</div>
	</Card>
)
