"use client"

import { useMemo, useState } from "react"
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
import { api } from "@/utils/api"

type ParsedRow = {
	email: string
	password: string
}

const normalizeHeader = (h: string) => h.trim().toLowerCase()

const parseCsvSimple = (raw: string): ParsedRow[] => {
	const lines = raw
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)

	if (lines.length < 2) {
		return []
	}

	const header = lines[0] ?? ""
	const cols = header.split(",").map((c) => normalizeHeader(c))
	const emailIdx = cols.indexOf("email")
	const passIdx = cols.indexOf("password")
	if (emailIdx === -1 || passIdx === -1) {
		throw new Error("CSV must include headers: Email, Password")
	}

	const rows: ParsedRow[] = []
	for (const line of lines.slice(1)) {
		const parts = line.split(",")
		const email = (parts[emailIdx] ?? "").trim()
		const password = (parts[passIdx] ?? "").trim()
		if (!email && !password) continue
		rows.push({ email, password })
	}
	return rows
}

type BulkImportMailboxesDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	domainId: string
	apexDomain: string
	onSuccess: () => void
}

export const BulkImportMailboxesDialog = ({
	open,
	onOpenChange,
	domainId,
	apexDomain,
	onSuccess,
}: BulkImportMailboxesDialogProps) => {
	const [fileName, setFileName] = useState<string | null>(null)
	const [csvText, setCsvText] = useState("")
	const [parsed, setParsed] = useState<ParsedRow[]>([])

	const bulk = api.mail.bulkCreateMailboxes.useMutation({
		onSuccess: (data) => {
			const bad = data.results.filter((r) => !r.ok).length
			if (bad) {
				toast.error(`${bad} row(s) failed to import`)
			} else {
				toast.success(`Imported ${data.okCount} mailbox(es)`)
			}
			onSuccess()
		},
		onError: (e) => toast.error(e.message),
	})

	const preview = useMemo(() => parsed.slice(0, 8), [parsed])

	const handleFile = async (file: File | null) => {
		setFileName(file?.name ?? null)
		setCsvText("")
		setParsed([])
		if (!file) return
		const text = await file.text()
		setCsvText(text)
		try {
			const next = parseCsvSimple(text)
			setParsed(next)
			if (!next.length) {
				toast.error("No rows found in CSV")
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to parse CSV")
		}
	}

	const handleImport = () => {
		if (!parsed.length) {
			toast.error("No rows to import")
			return
		}
		const invalid = parsed.find((r) => !r.email.trim() || !r.password.trim())
		if (invalid) {
			toast.error("Every row must include Email and Password")
			return
		}
		bulk.mutate({ domainId, rows: parsed })
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next)
				if (!next) {
					setFileName(null)
					setCsvText("")
					setParsed([])
				}
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Bulk import mailboxes (CSV)</DialogTitle>
					<DialogDescription>
						Upload a CSV with headers <span className="font-mono">Email</span> and{" "}
						<span className="font-mono">Password</span>. Emails must be under{" "}
						<span className="font-mono text-foreground">@{apexDomain}</span>.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-2">
					<Label htmlFor="csv">CSV file</Label>
					<Input
						id="csv"
						type="file"
						accept=".csv,text/csv"
						onChange={(e) => {
							const file = e.target.files?.[0] ?? null
							void handleFile(file)
						}}
						aria-label="Upload CSV"
					/>
					{fileName ? (
						<p className="text-xs text-muted-foreground">Selected: {fileName}</p>
					) : null}
				</div>

				{parsed.length ? (
					<div className="rounded-lg border bg-muted/30 p-3 space-y-2">
						<div className="text-sm font-medium">
							Preview ({parsed.length} row{parsed.length === 1 ? "" : "s"})
						</div>
						<div className="space-y-1">
							{preview.map((r) => (
								<div key={`${r.email}-${r.password}`} className="text-xs font-mono break-all">
									{r.email}
								</div>
							))}
							{parsed.length > preview.length ? (
								<div className="text-xs text-muted-foreground">
									…and {parsed.length - preview.length} more
								</div>
							) : null}
						</div>
					</div>
				) : csvText ? (
					<p className="text-xs text-muted-foreground">No valid rows parsed.</p>
				) : null}

				<DialogFooter>
					<Button
						type="button"
						variant="secondary"
						onClick={() => onOpenChange(false)}
						disabled={bulk.isPending}
					>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={handleImport}
						isLoading={bulk.isPending}
						disabled={!parsed.length}
					>
						Import
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

