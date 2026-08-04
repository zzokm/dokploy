"use client"

import { ArrowRight, Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
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
import { Label } from "@/components/ui/label"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { api } from "@/utils/api"

type PreviewRow = {
	domainId: string
	host: string
	zoneName: string
	isRequired: boolean
	desiredIp: string | null
	desiredProxied: boolean
	currentRecordId: string | null
	currentIp: string | null
	currentProxied: boolean | null
	state: "no_target" | "no_zone" | "ok" | "missing" | "drift" | "error"
	wouldChange: boolean
	errorMessage?: string | null
}

type CloudflareDnsPreviewDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	rows: PreviewRow[] | undefined
	isLoading: boolean
	onApplied?: () => void
}

const stateLabel = (state: PreviewRow["state"]) => {
	switch (state) {
		case "ok":
			return "Up to date"
		case "missing":
			return "Missing record"
		case "drift":
			return "Different target"
		case "no_zone":
			return "No matching zone"
		case "no_target":
			return "No server IP"
		case "error":
			return "Error"
		default:
			return state
	}
}

const stateBadgeVariant = (state: PreviewRow["state"]) => {
	switch (state) {
		case "ok":
			return "secondary" as const
		case "drift":
		case "missing":
			return "default" as const
		case "error":
		case "no_zone":
		case "no_target":
			return "destructive" as const
		default:
			return "outline" as const
	}
}

export const CloudflareDnsPreviewDialog = ({
	open,
	onOpenChange,
	rows,
	isLoading,
	onApplied,
}: CloudflareDnsPreviewDialogProps) => {
	const utils = api.useUtils()
	const apply = api.cloudflareSettings.applyAppDnsSelections.useMutation({
		onSuccess: async (data) => {
			const errCount = data.errors.length
			if (data.applied.length) {
				toast.success(
					`Updated DNS for ${data.applied.length} domain${data.applied.length === 1 ? "" : "s"}`,
				)
			}
			if (errCount) {
				toast.error(
					`${errCount} domain(s) could not be updated — see details in the table.`,
				)
			}
			await utils.cloudflareSettings.previewAppDns.invalidate()
			await utils.cloudflareSettings.previewAppDnsForDomain.invalidate()
			await utils.domain.byApplicationId.invalidate()
			await utils.domain.byComposeId.invalidate()
			onApplied?.()
			onOpenChange(false)
		},
		onError: (e) => toast.error(e.message),
	})

	const actionable = useMemo(
		() => (rows ?? []).filter((r) => r.state !== "ok"),
		[rows],
	)

	const okCount = useMemo(
		() => (rows ?? []).filter((r) => r.state === "ok").length,
		[rows],
	)

	const [applyIds, setApplyIds] = useState<Record<string, boolean>>({})

	useEffect(() => {
		if (!open || !actionable.length) {
			return
		}
		const next: Record<string, boolean> = {}
		for (const r of actionable) {
			const canApply =
				r.state === "drift" ||
				r.state === "missing" ||
				(r.state === "error" && r.wouldChange)
			next[r.domainId] = canApply
		}
		setApplyIds(next)
	}, [open, actionable])

	const handleToggle = (domainId: string, checked: boolean) => {
		setApplyIds((prev) => ({ ...prev, [domainId]: checked }))
	}

	const handleApply = () => {
		const selections = actionable.map((r) => ({
			domainId: r.domainId,
			apply: applyIds[r.domainId] ?? false,
		}))
		if (!selections.some((s) => s.apply)) {
			toast.message(
				"Select at least one domain to update, or close this dialog.",
			)
			return
		}
		apply.mutate({ selections })
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Review Cloudflare DNS targets</DialogTitle>
					<DialogDescription>
						Compare existing A records with this Dokploy server&apos;s IP.
						Select which hostnames to update so traffic reaches this node.
					</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="flex min-h-[10rem] items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
						<Loader2 className="size-5 animate-spin" aria-hidden />
						<span>Checking Cloudflare records…</span>
					</div>
				) : !rows?.length ? (
					<div className="flex min-h-[8rem] flex-col items-center justify-center gap-2 py-6 text-center">
						<p className="text-sm text-muted-foreground">
							No Cloudflare-managed application domains in this organization
							yet.
						</p>
					</div>
				) : (
					<div className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-4 duration-300">
						{okCount > 0 ? (
							<p className="text-sm text-muted-foreground">
								<span className="font-medium text-foreground">{okCount}</span>{" "}
								hostname{okCount === 1 ? "" : "s"} already match this
								server&apos;s target.
							</p>
						) : null}

						{actionable.length > 0 ? (
							<div className="overflow-hidden rounded-lg border">
								<div className="overflow-x-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead className="w-[52px]"> </TableHead>
												<TableHead>Hostname</TableHead>
												<TableHead>A record target</TableHead>
												<TableHead className="hidden sm:table-cell">
													Proxy
												</TableHead>
												<TableHead>Status</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{actionable.map((r, index) => {
												const canToggle =
													r.state === "drift" ||
													r.state === "missing" ||
													(r.state === "error" && r.wouldChange)
												const desired = r.desiredIp ?? "—"
												const current = r.currentIp ?? "—"
												const showArrow =
													r.state === "drift" ||
													r.state === "missing" ||
													(r.currentIp &&
														r.desiredIp &&
														r.currentIp !== r.desiredIp)

												return (
													<TableRow
														key={r.domainId}
														className="animate-in fade-in-0 duration-300 fill-mode-both"
														style={{
															animationDelay: `${Math.min(index, 10) * 30}ms`,
														}}
													>
														<TableCell>
															{canToggle ? (
																<Checkbox
																	checked={applyIds[r.domainId] ?? false}
																	onCheckedChange={(c) =>
																		handleToggle(r.domainId, c === true)
																	}
																	aria-label={`Apply DNS update for ${r.host}`}
																/>
															) : (
																<span className="text-muted-foreground">—</span>
															)}
														</TableCell>
														<TableCell className="break-all font-medium">
															{r.host}
															{r.zoneName ? (
																<div className="text-xs font-normal text-muted-foreground">
																	Zone: {r.zoneName}
																</div>
															) : null}
														</TableCell>
														<TableCell className="font-mono text-xs">
															<div className="flex flex-wrap items-center gap-1.5">
																<span
																	className={
																		r.currentIp ? "" : "text-muted-foreground"
																	}
																>
																	{current}
																</span>
																{showArrow && r.desiredIp ? (
																	<>
																		<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
																		<span>{desired}</span>
																	</>
																) : r.state === "missing" && r.desiredIp ? (
																	<>
																		<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
																		<span>{desired}</span>
																	</>
																) : null}
															</div>
															{r.errorMessage ? (
																<p className="mt-1 font-sans text-[11px] text-destructive">
																	{r.errorMessage}
																</p>
															) : null}
														</TableCell>
														<TableCell className="hidden text-xs sm:table-cell">
															{r.currentProxied === null ? (
																<span className="text-muted-foreground">—</span>
															) : (
																<span>
																	{r.currentProxied ? "On" : "Off"}
																	{r.currentProxied !== r.desiredProxied ? (
																		<>
																			{" "}
																			<ArrowRight className="inline size-3 align-middle" />
																			{r.desiredProxied ? " On" : " Off"}
																		</>
																	) : null}
																</span>
															)}
														</TableCell>
														<TableCell>
															<Badge variant={stateBadgeVariant(r.state)}>
																{stateLabel(r.state)}
															</Badge>
														</TableCell>
													</TableRow>
												)
											})}
										</TableBody>
									</Table>
								</div>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								All Cloudflare app domains already point at this server.
							</p>
						)}

						<div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
							<Label className="text-xs text-foreground">
								Required for routing
							</Label>
							<p className="leading-relaxed">
								The A record for each hostname must target this Dokploy server
								for HTTP(S) to arrive here. Skipped updates keep traffic on the
								old IP until DNS is changed manually.
							</p>
						</div>
					</div>
				)}

				<DialogFooter className="gap-2 sm:gap-0">
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						Close
					</Button>
					<Button
						type="button"
						disabled={isLoading || !actionable.length || apply.isPending}
						isLoading={apply.isPending}
						onClick={handleApply}
					>
						Apply selected updates
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
