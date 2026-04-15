"use client"

import { ExternalLink, Loader2, Mail } from "lucide-react"
import Link from "next/link"
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

type HostedDomainRow = {
	id: string
	name: string
	isMailManaged: boolean
	dkimSelector: string | null
}

type MailDomainsListCardProps = {
	mailDomains: HostedDomainRow[] | undefined
	pendingMailDomains: boolean
}

export const MailDomainsListCard = ({
	mailDomains,
	pendingMailDomains,
}: MailDomainsListCardProps) => (
	<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
		<div className="rounded-xl bg-background shadow-md">
			<CardHeader>
				<CardTitle className="text-xl flex flex-row gap-2 items-center">
					<Mail className="size-6 text-muted-foreground shrink-0" aria-hidden />
					Mail domains
				</CardTitle>
				<CardDescription>
					Domains with mail enabled for this server. DNS is provisioned automatically when you click{" "}
					<span className="font-medium text-foreground">Sync DNS</span> under{" "}
					<Link
						href="/dashboard/domains"
						className="text-primary underline-offset-4 hover:underline"
					>
						Domains
					</Link>{" "}
					.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6 py-6 sm:py-8 border-t">
				<p className="text-sm text-muted-foreground">
					MX and related records may take a few minutes to propagate; mail can be
					configured here even before DNS is live everywhere.
				</p>

				{pendingMailDomains ? (
					<div className="flex flex-col sm:flex-row gap-3 items-center justify-center text-sm text-muted-foreground min-h-[20vh]">
						<Loader2 className="animate-spin size-5 shrink-0" aria-hidden />
						<span>Loading…</span>
					</div>
				) : !mailDomains?.length ? (
					<div className="flex flex-col items-center gap-3 min-h-[20vh] justify-center text-muted-foreground px-4 text-center">
						<Mail className="size-10 shrink-0" aria-hidden />
						<span className="text-sm sm:text-base max-w-md">
							No mail-enabled domains. Enable mail on a domain to manage mailboxes here.
						</span>
					</div>
				) : (
					<div className="rounded-lg border overflow-x-auto">
					<Table className="min-w-[520px]">
						<TableHeader>
							<TableRow>
								<TableHead>Domain</TableHead>
								<TableHead>DKIM</TableHead>
								<TableHead className="text-right w-[1%] whitespace-nowrap pl-4">
									Actions
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{mailDomains.map((d) => (
								<TableRow key={d.id}>
									<TableCell className="font-medium">{d.name}</TableCell>
									<TableCell>
										{d.dkimSelector ? (
											<Badge variant="default">{d.dkimSelector}</Badge>
										) : (
											<Badge variant="secondary">Not provisioned</Badge>
										)}
									</TableCell>
									<TableCell className="text-right align-middle p-2 sm:p-3">
										<div className="inline-flex flex-row flex-nowrap items-center justify-end gap-2">
											<Button asChild size="sm" variant="outline" className="shrink-0">
												<Link href={`/dashboard/emails/${encodeURIComponent(d.id)}`}>
													Manage
													<ExternalLink className="ml-2 size-4" aria-hidden />
												</Link>
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					</div>
				)}
			</CardContent>
		</div>
	</Card>
)
