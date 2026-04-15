"use client"

import { Plus, Users } from "lucide-react"
import { useState } from "react"
import { AddMailboxDialog } from "@/components/dashboard/emails/add-mailbox-dialog"
import { BulkImportMailboxesDialog } from "@/components/dashboard/emails/bulk-import-mailboxes-dialog"
import { MailboxConnectionSettingsDialog } from "@/components/dashboard/emails/mailbox-connection-settings-dialog"
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"

type MailboxRow = {
	id: string
	localPart: string
	isActive: boolean
	quotaBytes: number
}

const formatMailboxQuota = (bytes: number) => {
	if (bytes === 0) {
		return "Unlimited"
	}
	if (bytes >= 1024 ** 3) {
		return `${(bytes / 1024 ** 3).toFixed(1)} GB`
	}
	if (bytes >= 1024 ** 2) {
		return `${Math.round(bytes / 1024 ** 2)} MB`
	}
	return `${bytes} B`
}

const buildRoundcubeWebmailUrl = (apexDomain: string, email: string) => {
	const apex = apexDomain.trim().replace(/\/$/, "")
	const u = new URL(`https://webmail.${apex}/`)
	u.searchParams.set("_task", "login")
	u.searchParams.set("_user", email)
	return u.toString()
}

type MailMailboxesCardProps = {
	domainId: string
	domainName: string
	mailboxes: MailboxRow[] | undefined
	onMailboxesChanged: () => void
	connectionOpen: boolean
	connectionLocalPart: string | null
	onConnectionOpenChange: (open: boolean) => void
	onOpenConnection: (localPart: string) => void
}

export const MailMailboxesCard = ({
	domainId,
	domainName,
	mailboxes,
	onMailboxesChanged,
	connectionOpen,
	connectionLocalPart,
	onConnectionOpenChange,
	onOpenConnection,
}: MailMailboxesCardProps) => {
	const [addOpen, setAddOpen] = useState(false)
	const [bulkOpen, setBulkOpen] = useState(false)

	const handleOpenWebmail = (email: string) => {
		window.open(
			buildRoundcubeWebmailUrl(domainName, email),
			"_blank",
			"noopener,noreferrer",
		)
	}

	return (
		<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
					<div className="space-y-1 min-w-0">
						<CardTitle className="text-xl flex flex-row gap-2 items-center">
							<Users className="size-6 text-muted-foreground shrink-0" aria-hidden />
							Mailboxes
						</CardTitle>
						<CardDescription>
							Mailboxes and Argon2id password hashes live in Postgres. Webmail DNS should
							include an A record for{" "}
							<span className="font-mono">webmail.{domainName}</span> (created when you
							provision mail DNS in Cloudflare).
						</CardDescription>
					</div>
					<div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto shrink-0">
						<Button
							type="button"
							size="sm"
							variant="outline"
							className="shrink-0 gap-2 w-full sm:w-auto"
							onClick={() => setBulkOpen(true)}
							aria-label="Bulk import mailboxes CSV"
						>
							Bulk import CSV
						</Button>
						<Button
							type="button"
							size="sm"
							className="shrink-0 gap-2 w-full sm:w-auto"
							onClick={() => setAddOpen(true)}
							aria-label="Add mailbox"
						>
							<Plus className="size-4 shrink-0" aria-hidden />
							Add mailbox
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-4 py-6 sm:py-8 border-t">
					<AddMailboxDialog
						domainId={domainId}
						domainName={domainName}
						open={addOpen}
						onOpenChange={setAddOpen}
						onSuccess={() => {
							onMailboxesChanged()
						}}
					/>
					<BulkImportMailboxesDialog
						open={bulkOpen}
						onOpenChange={setBulkOpen}
						domainId={domainId}
						apexDomain={domainName}
						onSuccess={() => {
							onMailboxesChanged()
							setBulkOpen(false)
						}}
					/>

					<MailboxConnectionSettingsDialog
						open={connectionOpen && connectionLocalPart !== null}
						onOpenChange={onConnectionOpenChange}
						localPart={connectionLocalPart ?? ""}
						apexDomain={domainName}
					/>

					<div className="rounded-lg border overflow-x-auto">
						<Table className="min-w-[560px]">
							<TableHeader>
								<TableRow>
									<TableHead>Address</TableHead>
									<TableHead>Active</TableHead>
									<TableHead>Quota</TableHead>
									<TableHead className="text-right w-[1%] whitespace-nowrap min-w-[200px] pl-4">
										Actions
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{mailboxes?.map((m) => (
									<TableRow key={m.id}>
										<TableCell className="font-medium">
											{m.localPart}@{domainName}
										</TableCell>
										<TableCell>
											{m.isActive ? (
												<Badge>Yes</Badge>
											) : (
												<Badge variant="secondary">No</Badge>
											)}
										</TableCell>
										<TableCell>{formatMailboxQuota(m.quotaBytes)}</TableCell>
										<TableCell className="text-right align-middle p-2 sm:p-3">
											<div className="inline-flex flex-row flex-nowrap items-center justify-end gap-2">
												<Button
													type="button"
													size="sm"
													variant="default"
													className="shrink-0"
													aria-label={`Open Roundcube webmail for ${m.localPart}@${domainName}`}
													onClick={() =>
														handleOpenWebmail(`${m.localPart}@${domainName}`)
													}
												>
													Open webmail
												</Button>
												<Button
													type="button"
													size="sm"
													variant="outline"
													className="shrink-0"
													aria-label={`Connection settings for ${m.localPart}@${domainName}`}
													onClick={() => onOpenConnection(m.localPart)}
												>
													Connection settings
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</div>
		</Card>
	)
}
