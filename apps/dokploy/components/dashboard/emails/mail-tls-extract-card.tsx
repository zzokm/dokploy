"use client"

import { Shield } from "lucide-react"
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
	<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
		<div className="rounded-xl bg-background shadow-md">
			<CardHeader>
				<CardTitle className="text-xl flex flex-row gap-2 items-center">
					<Shield className="size-6 text-muted-foreground shrink-0" aria-hidden />
					Mail TLS (Traefik ACME)
				</CardTitle>
				<CardDescription>
					Extracts certificate and key from Traefik&apos;s acme.json for this
					hostname (mount into Exim/Dovecot on the host).
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 py-6 sm:py-8 border-t">
				<Form {...form}>
					<form
						onSubmit={onSubmitTls}
						className="flex flex-col sm:flex-row flex-wrap gap-4 sm:gap-3 sm:items-end max-w-xl"
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
						<Button type="submit" className="w-full sm:w-auto" isLoading={extractPending}>
							Extract mail TLS
						</Button>
					</form>
				</Form>
			</CardContent>
		</div>
	</Card>
)
