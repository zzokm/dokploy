"use client"

import type { FormEvent } from "react"
import type { UseFormReturn } from "react-hook-form"
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
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
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

type MailboxFormValues = { localPart: string; password: string }

type MailMailboxesCardProps = {
	domainName: string
	form: UseFormReturn<MailboxFormValues>
	onSubmitMailbox: (e: FormEvent) => void
	createPending: boolean
	mailboxes: MailboxRow[] | undefined
	connectionOpen: boolean
	connectionLocalPart: string | null
	onConnectionOpenChange: (open: boolean) => void
	onOpenConnection: (localPart: string) => void
}

export const MailMailboxesCard = ({
	domainName,
	form,
	onSubmitMailbox,
	createPending,
	mailboxes,
	connectionOpen,
	connectionLocalPart,
	onConnectionOpenChange,
	onOpenConnection,
}: MailMailboxesCardProps) => (
	<Card className="h-full p-2.5 rounded-xl max-w-5xl mx-auto w-full">
		<div className="rounded-xl bg-background shadow-md">
			<CardHeader>
				<CardTitle className="text-xl">Mailboxes</CardTitle>
				<CardDescription>
					Passwords are stored as Argon2id hashes.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 py-8 border-t">
				<Form {...form}>
					<form
						onSubmit={onSubmitMailbox}
						className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end max-w-3xl"
					>
						<FormField
							control={form.control}
							name="localPart"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Local part</FormLabel>
									<FormControl>
										<Input autoComplete="off" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="password"
							render={({ field }) => (
								<FormItem className="sm:col-span-2">
									<FormLabel>Password</FormLabel>
									<FormControl>
										<Input
											type="password"
											autoComplete="new-password"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button
							type="submit"
							className="sm:col-span-3 w-full sm:w-auto"
							isLoading={createPending}
						>
							Create mailbox
						</Button>
					</form>
				</Form>

				<MailboxConnectionSettingsDialog
					open={connectionOpen && connectionLocalPart !== null}
					onOpenChange={onConnectionOpenChange}
					localPart={connectionLocalPart ?? ""}
					apexDomain={domainName}
				/>

				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Address</TableHead>
							<TableHead>Active</TableHead>
							<TableHead>Quota (bytes)</TableHead>
							<TableHead className="text-right w-[180px]">Connection</TableHead>
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
								<TableCell>{m.quotaBytes}</TableCell>
								<TableCell className="text-right">
									<Button
										type="button"
										size="sm"
										variant="outline"
										aria-label={`Connection settings for ${m.localPart}@${domainName}`}
										onClick={() => onOpenConnection(m.localPart)}
									>
										Connection settings
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</div>
	</Card>
)
