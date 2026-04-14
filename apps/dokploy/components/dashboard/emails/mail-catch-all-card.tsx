"use client"

import { Inbox } from "lucide-react"
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

type CatchAllValues = { catchAllLocalPart?: string | null }

type MailCatchAllCardProps = {
	domainName: string
	catchAllLocalPart: string | null
	form: UseFormReturn<CatchAllValues>
	onSubmit: (e: FormEvent) => void
	savePending: boolean
}

export const MailCatchAllCard = ({
	domainName,
	catchAllLocalPart,
	form,
	onSubmit,
	savePending,
}: MailCatchAllCardProps) => (
	<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
		<div className="rounded-xl bg-background shadow-md">
			<CardHeader>
				<CardTitle className="text-xl flex flex-row gap-2 items-center flex-wrap">
					<Inbox className="size-6 text-muted-foreground shrink-0" aria-hidden />
					<span>Catch-all · {domainName}</span>
				</CardTitle>
				<CardDescription>
					Routes unknown addresses to a mailbox local part (e.g. <span className="font-mono">admin</span>).
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 py-6 sm:py-8 border-t">
				<Form {...form}>
					<form
						onSubmit={onSubmit}
						className="flex flex-col sm:flex-row flex-wrap gap-4 sm:gap-3 sm:items-end max-w-xl"
					>
						<FormField
							control={form.control}
							name="catchAllLocalPart"
							render={({ field }) => (
								<FormItem className="flex-1 min-w-[180px]">
									<FormLabel>Catch-all local part</FormLabel>
									<FormControl>
										<Input
											placeholder={catchAllLocalPart ?? "admin"}
											autoComplete="off"
											{...field}
											value={field.value ?? ""}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button type="submit" className="w-full sm:w-auto" isLoading={savePending}>
							Save catch-all
						</Button>
					</form>
				</Form>
			</CardContent>
		</div>
	</Card>
)
