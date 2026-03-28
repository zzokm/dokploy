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

type TlsFormValues = { domain: string }

type MailTlsExtractCardProps = {
	domainPlaceholder: string
	form: UseFormReturn<TlsFormValues>
	onSubmitTls: (e: FormEvent) => void
	extractPending: boolean
}

export const MailTlsExtractCard = ({
	domainPlaceholder,
	form,
	onSubmitTls,
	extractPending,
}: MailTlsExtractCardProps) => (
	<Card className="h-full p-2.5 rounded-xl max-w-5xl mx-auto w-full">
		<div className="rounded-xl bg-background shadow-md">
			<CardHeader>
				<CardTitle className="text-xl">Mail TLS (from Traefik ACME)</CardTitle>
				<CardDescription>
					Extracts certificate and key from Traefik&apos;s acme.json for this
					hostname (mount into Exim/Dovecot on the host).
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 py-8 border-t">
				<Form {...form}>
					<form
						onSubmit={onSubmitTls}
						className="flex flex-wrap gap-2 items-end max-w-xl"
					>
						<FormField
							control={form.control}
							name="domain"
							render={({ field }) => (
								<FormItem className="flex-1 min-w-[200px]">
									<FormLabel>Domain name (cert subject)</FormLabel>
									<FormControl>
										<Input placeholder={domainPlaceholder} {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button type="submit" isLoading={extractPending}>
							Extract mail TLS
						</Button>
					</form>
				</Form>
			</CardContent>
		</div>
	</Card>
)
