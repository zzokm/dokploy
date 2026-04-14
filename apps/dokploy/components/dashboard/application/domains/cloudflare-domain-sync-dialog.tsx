"use client"

import { ArrowRight, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
	AlertDialog,
	AlertDialogCancel,
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
	const { data: preview, isFetching } = api.cloudflareSettings.previewAppDnsForDomain.useQuery(
		{ domainId },
		{ enabled: open && !!domainId },
	)

	const apply = api.cloudflareSettings.applyAppDnsSelections.useMutation({
		onSuccess: async () => {
			toast.success("DNS updated")
			await utils.domain.one.invalidate({ domainId })
			await utils.domain.byApplicationId.invalidate()
			await utils.domain.byComposeId.invalidate()
			await utils.cloudflareSettings.previewAppDns.invalidate()
			await utils.cloudflareSettings.previewAppDnsForDomain.invalidate({ domainId })
			onOpenChange(false)
		},
		onError: (e) => toast.error(e.message),
	})

	const handleApply = () => {
		apply.mutate({
			selections: [{ domainId, apply: true }],
		})
	}

	const current = preview?.currentIp ?? "—"
	const desired = preview?.desiredIp ?? "—"

	const canApply =
		preview &&
		preview.state !== "ok" &&
		!!preview.desiredIp &&
		preview.state !== "no_zone" &&
		preview.state !== "no_target"

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Sync DNS for this domain</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3 text-left text-sm text-muted-foreground">
							{isFetching ? (
								<div className="flex items-center gap-2 py-4">
									<Loader2 className="size-4 animate-spin" aria-hidden />
									<span>Checking Cloudflare…</span>
								</div>
							) : preview ? (
								<>
									{preview.state === "ok" ? (
										<p>
											The A record for <span className="font-mono text-foreground">{preview.host}</span>{" "}
											already points at this Dokploy server ({desired}).
										</p>
									) : preview.state === "no_zone" ? (
										<p>
											No synced Cloudflare zone matches <span className="font-mono text-foreground">{preview.host}</span>.
											Open Domains and run <span className="font-medium text-foreground">Sync zones</span>, or
											check that the hostname sits under a zone in this account.
										</p>
									) : preview.state === "no_target" ? (
										<p>
											This Dokploy install has no public IP for this app (no server IP and no panel
											fallback). Assign a server or set the panel IP before syncing DNS.
										</p>
									) : (
										<>
											<p>
												Cloudflare will update the A record for{" "}
												<span className="font-mono text-foreground">{preview.host}</span> so traffic
												reaches this node.
											</p>
											<div className="flex flex-wrap items-center gap-2 font-mono text-xs text-foreground bg-muted/50 rounded-md px-3 py-2">
												<span>{current}</span>
												<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
												<span>{desired}</span>
											</div>
											{preview.errorMessage ? (
												<p className="text-destructive text-xs">{preview.errorMessage}</p>
											) : null}
										</>
									)}
								</>
							) : (
								<p>Could not load preview.</p>
							)}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel type="button">Cancel</AlertDialogCancel>
					{canApply ? (
						<Button
							type="button"
							isLoading={apply.isPending}
							disabled={isFetching}
							onClick={handleApply}
						>
							Apply update
						</Button>
					) : (
						<Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
							Close
						</Button>
					)}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
