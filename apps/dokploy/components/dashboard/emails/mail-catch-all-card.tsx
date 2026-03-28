"use client"

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
	<Card className="h-full p-2.5 rounded-xl max-w-5xl mx-auto w-full">
		<div className="rounded-xl bg-background shadow-md">
			<CardHeader>
				<CardTitle className="text-xl">Mail settings: {domainName}</CardTitle>
				<CardDescription>
					Catch-all routes unknown addresses to a mailbox local part.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 py-8 border-t">
				<Form {...form}>
					<form
						onSubmit={onSubmit}
						className="flex flex-wrap gap-2 items-end max-w-xl"
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
						<Button type="submit" isLoading={savePending}>
							Save catch-all
						</Button>
					</form>
				</Form>
			</CardContent>
		</div>
	</Card>
)
