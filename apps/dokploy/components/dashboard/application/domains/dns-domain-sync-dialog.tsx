"use client"

import { ArrowRight, Loader2 } from "lucide-react"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { api } from "@/utils/api"

type CloudflareDomainSyncDialogProps = {
	domainId: string
	open: boolean
	onOpenChange: (open: boolean) => void
}

export const CloudflareDomainSyncDialog = ({
	domainId,
	open,
	onOpenChange,
}: CloudflareDomainSyncDialogProps) => {
	const utils = api.useUtils()
	const { data: preview, isFetching } =
		api.cloudflareSettings.previewAppDnsForDomain.useQuery(
			{ domainId },
			{ enabled: open && !!domainId },
		)

	const didAutoApply = useRef(false)

	const apply = api.cloudflareSettings.applyAppDnsSelections.useMutation({
		onSuccess: async () => {
			toast.success("DNS updated")
			await utils.domain.one.invalidate({ domainId })
			await utils.domain.byApplicationId.invalidate()
			await utils.domain.byComposeId.invalidate()
			await utils.cloudflareSettings.previewAppDns.invalidate()
			await utils.cloudflareSettings.previewAppDnsForDomain.invalidate({
				domainId,
			})
			onOpenChange(false)
		},
		onError: (e) => toast.error(e.message),
	})

	const current = preview?.currentIp ?? "—"
	const desired = preview?.desiredIp ?? "—"

	const canApply =
		preview &&
		preview.state !== "ok" &&
		!!preview.desiredIp &&
		preview.state !== "no_zone" &&
		preview.state !== "no_target"

	useEffect(() => {
		if (!open) {
			didAutoApply.current = false
			return
		}
		if (!canApply || apply.isPending || didAutoApply.current) {
			return
		}
		didAutoApply.current = true
		apply.mutate({
			selections: [{ domainId, apply: true }],
		})
	}, [open, canApply, apply, domainId])

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Sync DNS for this domain</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3 text-left text-sm text-muted-foreground">
							{isFetching || apply.isPending ? (
								<div className="flex min-h-[5rem] items-center justify-center gap-2 py-4">
									<Loader2 className="size-4 animate-spin" aria-hidden />
									<span>
										{apply.isPending
											? "Updating Cloudflare…"
											: "Checking Cloudflare…"}
									</span>
								</div>
							) : preview ? (
								<div className="animate-in fade-in-0 slide-in-from-bottom-1 space-y-3 duration-300">
									{preview.state === "ok" ? (
										<p>
											The A record for{" "}
											<span className="font-mono text-foreground">
												{preview.host}
											</span>{" "}
											already points at this Dokploy server ({desired}).
										</p>
									) : preview.state === "no_zone" ? (
										<p>
											No synced Cloudflare domain matches{" "}
											<span className="font-mono text-foreground">
												{preview.host}
											</span>
											. Open Domains and run{" "}
											<span className="font-medium text-foreground">
												Sync domains
											</span>
											, or check that the hostname sits under a domain in this
											account.
										</p>
									) : preview.state === "no_target" ? (
										<p>
											This Dokploy install has no public IP for this app (no
											server IP and no panel fallback). Assign a server or set
											the panel IP before syncing DNS.
										</p>
									) : (
										<>
											<p>
												Cloudflare will update the A record for{" "}
												<span className="font-mono text-foreground">
													{preview.host}
												</span>{" "}
												so traffic reaches this node.
											</p>
											<div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 font-mono text-xs text-foreground">
												<span>{current}</span>
												<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
												<span>{desired}</span>
											</div>
											{preview.errorMessage ? (
												<p className="text-xs text-destructive">
													{preview.errorMessage}
												</p>
											) : null}
										</>
									)}
								</div>
							) : (
								<p>Could not load preview.</p>
							)}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<Button
						type="button"
						variant="secondary"
						onClick={() => onOpenChange(false)}
						disabled={apply.isPending}
					>
						Close
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
