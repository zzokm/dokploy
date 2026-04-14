"use client"

import { ArrowRightLeft } from "lucide-react"
import type { FormEvent } from "react"
import type { UseFormReturn } from "react-hook-form"
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

type AliasRow = {
	id: string
	sourceLocalPart: string
	destination: string
}

type AliasFormValues = { sourceLocalPart: string; destination: string }

type MailAliasesCardProps = {
	domainName: string
	form: UseFormReturn<AliasFormValues>
	onSubmitAlias: (e: FormEvent) => void
	createPending: boolean
	aliases: AliasRow[] | undefined
}

export const MailAliasesCard = ({
	domainName,
	form,
	onSubmitAlias,
	createPending,
	aliases,
}: MailAliasesCardProps) => (
	<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
		<div className="rounded-xl bg-background shadow-md">
			<CardHeader>
				<CardTitle className="text-xl flex flex-row gap-2 items-center">
					<ArrowRightLeft className="size-6 text-muted-foreground shrink-0" aria-hidden />
					Aliases
				</CardTitle>
				<CardDescription>
					Map a local part to a full destination address for {domainName}.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 py-6 sm:py-8 border-t">
				<Form {...form}>
					<form
						onSubmit={onSubmitAlias}
						className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end max-w-2xl"
					>
						<FormField
							control={form.control}
							name="sourceLocalPart"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Source local part</FormLabel>
									<FormControl>
										<Input placeholder="support" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="destination"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Destination email</FormLabel>
									<FormControl>
										<Input
											type="email"
											placeholder="admin@example.com"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button
							type="submit"
							className="sm:col-span-2 w-full sm:w-auto"
							isLoading={createPending}
						>
							Add alias
						</Button>
					</form>
				</Form>
				<div className="rounded-lg border overflow-hidden">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>From</TableHead>
							<TableHead>To</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{aliases?.map((a) => (
							<TableRow key={a.id}>
								<TableCell>
									{a.sourceLocalPart}@{domainName}
								</TableCell>
								<TableCell>{a.destination}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				</div>
			</CardContent>
		</div>
	</Card>
)
