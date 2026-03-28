"use client"

import type { ReactNode } from "react"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"

export type MailboxConnectionSettingsDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	localPart: string
	apexDomain: string
}

const copyRow = async (label: string, value: string) => {
	try {
		await navigator.clipboard.writeText(value)
		toast.success(`${label} copied`)
	} catch {
		toast.error("Could not copy to clipboard")
	}
}

const SettingBlock = ({
	label,
	children,
	copyText,
}: {
	label: string
	children: ReactNode
	copyText?: string
}) => (
	<div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
		<div className="flex items-center justify-between gap-2">
			<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</span>
			{copyText !== undefined && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 px-2 shrink-0"
					aria-label={`Copy ${label}`}
					onClick={() => void copyRow(label, copyText)}
				>
					<Copy className="size-3.5" />
				</Button>
			)}
		</div>
		<div className="font-mono text-sm text-foreground break-all">{children}</div>
	</div>
)

export const MailboxConnectionSettingsDialog = ({
	open,
	onOpenChange,
	localPart,
	apexDomain,
}: MailboxConnectionSettingsDialogProps) => {
	const username = `${localPart}@${apexDomain}`
	const mailHost = `mail.${apexDomain}`

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Connection settings</DialogTitle>
					<DialogDescription>
						Use these values in Apple Mail, Outlook, Thunderbird, or other
						clients. Webmail (if deployed) is typically at{" "}
						<span className="font-mono text-foreground">
							https://webmail.{apexDomain}
						</span>
						.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3 pt-2">
					<SettingBlock label="Username" copyText={username}>
						{username}
					</SettingBlock>

					<div className="rounded-lg border border-dashed bg-muted/20 p-3 space-y-1">
						<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Password
						</span>
						<p className="text-sm text-muted-foreground">
							Hidden for security. Use the password you set when you created this
							mailbox.
						</p>
					</div>

					<SettingBlock label="Incoming server (IMAP)" copyText={mailHost}>
						<div className="space-y-1">
							<div>
								<span className="text-muted-foreground">Host: </span>
								{mailHost}
							</div>
							<div>
								<span className="text-muted-foreground">Port: </span>
								993
							</div>
							<div>
								<span className="text-muted-foreground">Security: </span>
								SSL/TLS (IMAPS)
							</div>
						</div>
					</SettingBlock>

					<SettingBlock label="Outgoing server (SMTP)" copyText={mailHost}>
						<div className="space-y-1">
							<div>
								<span className="text-muted-foreground">Host: </span>
								{mailHost}
							</div>
							<div>
								<span className="text-muted-foreground">Port: </span>
								587
							</div>
							<div>
								<span className="text-muted-foreground">Security: </span>
								STARTTLS
							</div>
						</div>
					</SettingBlock>
				</div>
			</DialogContent>
		</Dialog>
	)
}
