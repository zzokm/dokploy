"use client"

import { Loader2, Mail } from "lucide-react"
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
	allDomains: HostedDomainRow[] | undefined
	mailDomains: HostedDomainRow[] | undefined
	pendingAllDomains: boolean
	pendingMailDomains: boolean
	selectedId: string | null
	onSelectDomain: (id: string) => void
	onEnableMail: (id: string) => void
	onProvision: (id: string) => void
	enableMailPending: boolean
	provisionPending: boolean
}

export const MailDomainsListCard = ({
	allDomains,
	mailDomains,
	pendingAllDomains,
	pendingMailDomains,
	selectedId,
	onSelectDomain,
	onEnableMail,
	onProvision,
	enableMailPending,
	provisionPending,
}: MailDomainsListCardProps) => (
	<Card className="h-full p-2.5 rounded-xl max-w-5xl mx-auto w-full">
		<div className="rounded-xl bg-background shadow-md">
			<CardHeader>
				<CardTitle className="text-xl">Mail domains</CardTitle>
				<CardDescription>
					Domains with mail enabled. Enable mail on a domain from the database
					(any hosted domain can be toggled), then provision.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-2 py-8 border-t">
				<p className="text-sm text-muted-foreground mb-4">
					Add domains under{" "}
					<Link
						href="/dashboard/domains"
						className="text-primary underline-offset-4 hover:underline"
					>
						Domains
					</Link>
					, then enable mail here.
				</p>

				{allDomains?.some((d) => !d.isMailManaged) && (
					<div className="mb-6">
						<h3 className="text-sm font-medium mb-2">Enable mail on a domain</h3>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Domain</TableHead>
									<TableHead className="text-right"> </TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{allDomains
									?.filter((d) => !d.isMailManaged)
									.map((d) => (
										<TableRow key={d.id}>
											<TableCell className="font-medium">{d.name}</TableCell>
											<TableCell className="text-right">
												<Button
													size="sm"
													type="button"
													isLoading={enableMailPending}
													onClick={() => onEnableMail(d.id)}
												>
													Enable mail
												</Button>
											</TableCell>
										</TableRow>
									))}
							</TableBody>
						</Table>
					</div>
				)}

				{pendingAllDomains || pendingMailDomains ? (
					<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[20vh]">
						<span>Loading...</span>
						<Loader2 className="animate-spin size-4" />
					</div>
				) : !mailDomains?.length ? (
					<div className="flex flex-col items-center gap-3 min-h-[20vh] justify-center text-muted-foreground">
						<Mail className="size-8" />
						<span className="text-base text-center max-w-md">
							No mail-enabled domains. Enable mail on a domain (set mail managed)
							to manage mailboxes here.
						</span>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Domain</TableHead>
								<TableHead>DKIM</TableHead>
								<TableHead className="text-right">Actions</TableHead>
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
									<TableCell className="text-right space-x-2">
										<Button
											size="sm"
											variant={selectedId === d.id ? "default" : "outline"}
											type="button"
											onClick={() => onSelectDomain(d.id)}
										>
											Manage
										</Button>
										<Button
											size="sm"
											variant="secondary"
											type="button"
											isLoading={provisionPending}
											onClick={() => onProvision(d.id)}
										>
											Provision
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</div>
	</Card>
)
