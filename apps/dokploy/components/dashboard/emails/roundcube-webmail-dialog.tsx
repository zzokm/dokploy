"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const postRoundcubeLogin = (webmailOrigin: string, email: string, password: string) => {
	const form = document.createElement("form")
	form.method = "POST"
	form.action = `${webmailOrigin.replace(/\/$/, "")}/`
	form.target = "_blank"
	const add = (name: string, value: string) => {
		const input = document.createElement("input")
		input.type = "hidden"
		input.name = name
		input.value = value
		form.appendChild(input)
	}
	add("_task", "login")
	add("_action", "login")
	add("_user", email)
	add("_pass", password)
	add("_url", "")
	document.body.appendChild(form)
	form.submit()
	document.body.removeChild(form)
}

export type RoundcubeWebmailDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	email: string
	apexDomain: string
}

export const RoundcubeWebmailDialog = ({
	open,
	onOpenChange,
	email,
	apexDomain,
}: RoundcubeWebmailDialogProps) => {
	const [password, setPassword] = useState("")
	const webmailOrigin = `https://webmail.${apexDomain}`

	const handleOpenLoginPageOnly = () => {
		const url = `${webmailOrigin}/?_task=login&_user=${encodeURIComponent(email)}`
		window.open(url, "_blank", "noopener,noreferrer")
		onOpenChange(false)
	}

	const handleSubmit = () => {
		const trimmed = password.trim()
		if (!trimmed) {
			toast.error("Enter your mailbox password")
			return
		}
		try {
			postRoundcubeLogin(webmailOrigin, email, trimmed)
			setPassword("")
			onOpenChange(false)
			toast.success("Opening webmail in a new tab")
		} catch {
			toast.error("Could not open webmail")
		}
	}

	if (!email) {
		return null
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) {
					setPassword("")
				}
				onOpenChange(o)
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Open Roundcube webmail</DialogTitle>
					<DialogDescription>
						Passwords cannot be read from the panel (they are stored as Argon2
						hashes). Enter your mailbox password to sign in. It is sent only to{" "}
						<span className="font-mono text-foreground">{webmailOrigin}</span>{" "}
						in a POST request.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3 py-2">
					<div className="space-y-1.5">
						<Label htmlFor="rc-email">Email</Label>
						<Input id="rc-email" readOnly value={email} className="font-mono" />
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="rc-pass">Password</Label>
						<Input
							id="rc-pass"
							type="password"
							autoComplete="current-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault()
									handleSubmit()
								}
							}}
						/>
					</div>
				</div>
				<DialogFooter className="flex-col sm:flex-row gap-2">
					<Button type="button" variant="outline" onClick={handleOpenLoginPageOnly}>
						Open login page only
					</Button>
					<Button type="button" onClick={handleSubmit}>
						Open and sign in
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
