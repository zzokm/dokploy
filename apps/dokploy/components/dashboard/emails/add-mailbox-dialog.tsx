"use client"

import {
	addMailboxDialogSchema,
	quotaBytesFromMailboxDialog,
	type AddMailboxDialogForm,
} from "@dokploy/server/validations/dns-mail-schemas"
import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { api } from "@/utils/api"

const defaultAddMailboxValues = (): AddMailboxDialogForm => ({
	localPart: "",
	password: "",
	quotaMode: "5gb",
	customQuotaMb: "",
	addAliasToMailbox: false,
	aliasSourceLocalPart: "",
	addForwardRedirect: false,
	forwardSourceLocalPart: "",
	forwardDestination: "",
})

export type AddMailboxDialogProps = {
	domainId: string
	domainName: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess: () => void
}

export const AddMailboxDialog = ({
	domainId,
	domainName,
	open,
	onOpenChange,
	onSuccess,
}: AddMailboxDialogProps) => {
	const [isSubmitting, setIsSubmitting] = useState(false)

	const createMailbox = api.mail.createMailbox.useMutation()
	const createAlias = api.mail.createAlias.useMutation()

	const form = useForm<AddMailboxDialogForm>({
		resolver: zodResolver(addMailboxDialogSchema),
		defaultValues: defaultAddMailboxValues(),
	})

	useEffect(() => {
		if (open) {
			form.reset(defaultAddMailboxValues())
		}
	}, [open, form])

	const quotaMode = form.watch("quotaMode")
	const addAlias = form.watch("addAliasToMailbox")
	const addForward = form.watch("addForwardRedirect")

	const handleSubmit = form.handleSubmit(async (values) => {
		setIsSubmitting(true)
		try {
			const quotaBytes = quotaBytesFromMailboxDialog(
				values.quotaMode,
				values.customQuotaMb,
			)
			const local = values.localPart.trim()
			const apex = domainName.trim().toLowerCase()

			try {
				await createMailbox.mutateAsync({
					domainId,
					localPart: local,
					password: values.password,
					quotaBytes,
				})
			} catch (e) {
				const msg = e instanceof Error ? e.message : "Could not create mailbox"
				toast.error(msg)
				return
			}

			let aliasWarning: string | null = null

			if (values.addAliasToMailbox) {
				try {
					await createAlias.mutateAsync({
						domainId,
						sourceLocalPart: values.aliasSourceLocalPart!.trim(),
						destination: `${local}@${apex}`,
					})
				} catch (e) {
					const msg = e instanceof Error ? e.message : "Alias failed"
					aliasWarning = msg
				}
			}

			if (values.addForwardRedirect) {
				try {
					await createAlias.mutateAsync({
						domainId,
						sourceLocalPart: values.forwardSourceLocalPart!.trim(),
						destination: values.forwardDestination!.trim(),
					})
				} catch (e) {
					const msg = e instanceof Error ? e.message : "Forward alias failed"
					aliasWarning = aliasWarning
						? `${aliasWarning}; ${msg}`
						: msg
				}
			}

			if (aliasWarning) {
				toast.warning(
					`Mailbox created, but routing could not be saved: ${aliasWarning}`,
				)
			} else {
				toast.success("Mailbox created")
			}

			onSuccess()
			onOpenChange(false)
			form.reset(defaultAddMailboxValues())
		} finally {
			setIsSubmitting(false)
		}
	})

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Add mailbox</DialogTitle>
					<DialogDescription>
						Create a mailbox for{" "}
						<span className="font-mono text-foreground">{domainName}</span>.
						Passwords are stored as Argon2id hashes only.
					</DialogDescription>
				</DialogHeader>

				<Form {...form}>
					<form onSubmit={handleSubmit} className="space-y-6">
						<div className="space-y-4">
							<FormField
								control={form.control}
								name="localPart"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Username (local part)</FormLabel>
										<FormControl>
											<Input
												autoComplete="off"
												placeholder="you"
												aria-label="Mailbox local part"
												{...field}
											/>
										</FormControl>
										<FormDescription>
											Full address will be{" "}
											<span className="font-mono">
												{field.value?.trim()
													? `${field.value.trim()}@${domainName}`
													: `…@${domainName}`}
											</span>
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="password"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Password</FormLabel>
										<FormControl>
											<Input
												type="password"
												autoComplete="new-password"
												aria-label="Mailbox password"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="quotaMode"
								render={({ field }) => (
									<FormItem className="space-y-3">
										<FormLabel>Storage quota</FormLabel>
										<FormControl>
											<RadioGroup
												onValueChange={field.onChange}
												value={field.value}
												className="grid gap-2"
												aria-label="Mailbox storage quota"
											>
												<div className="flex items-center gap-2">
													<RadioGroupItem value="unlimited" id="quota-unlimited" />
													<Label htmlFor="quota-unlimited" className="font-normal">
														Unlimited
													</Label>
												</div>
												<div className="flex items-center gap-2">
													<RadioGroupItem value="1gb" id="quota-1gb" />
													<Label htmlFor="quota-1gb" className="font-normal">
														1 GB
													</Label>
												</div>
												<div className="flex items-center gap-2">
													<RadioGroupItem value="5gb" id="quota-5gb" />
													<Label htmlFor="quota-5gb" className="font-normal">
														5 GB
													</Label>
												</div>
												<div className="flex items-center gap-2">
													<RadioGroupItem value="10gb" id="quota-10gb" />
													<Label htmlFor="quota-10gb" className="font-normal">
														10 GB
													</Label>
												</div>
												<div className="flex items-center gap-2">
													<RadioGroupItem value="custom" id="quota-custom" />
													<Label htmlFor="quota-custom" className="font-normal">
														Custom (MB)
													</Label>
												</div>
											</RadioGroup>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							{quotaMode === "custom" ? (
								<FormField
									control={form.control}
									name="customQuotaMb"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Custom quota (MB)</FormLabel>
											<FormControl>
												<Input
													type="number"
													min={1}
													step={1}
													inputMode="numeric"
													placeholder="512"
													aria-label="Custom quota in megabytes"
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							) : null}
						</div>

						<div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
							<p className="text-sm font-medium">Optional routing</p>

							<FormField
								control={form.control}
								name="addAliasToMailbox"
								render={({ field }) => (
									<FormItem className="flex flex-row items-start gap-3 space-y-0">
										<FormControl>
											<Checkbox
												checked={field.value}
												onCheckedChange={(c) => field.onChange(c === true)}
												aria-label="Add alias that delivers to this mailbox"
											/>
										</FormControl>
										<div className="space-y-1 leading-snug">
											<FormLabel className="font-medium cursor-pointer">
												Alias to this mailbox
											</FormLabel>
											<FormDescription>
												Another address on {domainName} that delivers to this mailbox.
											</FormDescription>
										</div>
									</FormItem>
								)}
							/>

							{addAlias ? (
								<FormField
									control={form.control}
									name="aliasSourceLocalPart"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Alias local part</FormLabel>
											<FormControl>
												<Input
													placeholder="contact"
													autoComplete="off"
													aria-label="Alias source local part"
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							) : null}

							<FormField
								control={form.control}
								name="addForwardRedirect"
								render={({ field }) => (
									<FormItem className="flex flex-row items-start gap-3 space-y-0">
										<FormControl>
											<Checkbox
												checked={field.value}
												onCheckedChange={(c) => field.onChange(c === true)}
												aria-label="Add forward-only address"
											/>
										</FormControl>
										<div className="space-y-1 leading-snug">
											<FormLabel className="font-medium cursor-pointer">
												Forward-only address
											</FormLabel>
											<FormDescription>
												Map a local part to an external inbox (no mailbox for that name).
											</FormDescription>
										</div>
									</FormItem>
								)}
							/>

							{addForward ? (
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
									<FormField
										control={form.control}
										name="forwardSourceLocalPart"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Local part</FormLabel>
												<FormControl>
													<Input
														placeholder="billing"
														autoComplete="off"
														aria-label="Forward source local part"
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="forwardDestination"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Destination email</FormLabel>
												<FormControl>
													<Input
														type="email"
														placeholder="team@example.com"
														autoComplete="off"
														aria-label="Forward destination email"
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
							) : null}
						</div>

						<DialogFooter className="gap-2 sm:gap-0">
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={isSubmitting}
							>
								Cancel
							</Button>
							<Button type="submit" isLoading={isSubmitting}>
								Create mailbox
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	)
}
