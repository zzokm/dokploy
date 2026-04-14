"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { AlertBlock } from "@/components/shared/alert-block"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api } from "@/utils/api"
import { ShowModalLogs } from "../../web-server/show-modal-logs"

type Props = {
	serverId?: string
}

const serviceLabel = (name: string) => {
	if (name === "bind") return "BIND (DNS)"
	if (name === "exim") return "Exim (SMTP)"
	if (name === "dovecot") return "Dovecot (IMAP)"
	if (name === "roundcube") return "Roundcube (Webmail)"
	return name
}

export const ShowCoreServicesActions = ({ serverId }: Props) => {
	const [menuOpen, setMenuOpen] = useState(false)
	const { data, refetch, isFetching } = api.settings.getCoreServicesStatus.useQuery(
		{ serverId },
		{ refetchOnWindowFocus: false },
	)

	const { mutateAsync: reconcile, isPending } =
		api.settings.reconcileCoreServices.useMutation()

	const overall = useMemo(() => {
		const services = data?.services ?? []
		const anyMissing = services.some((s) => !s.exists)
		const anyStopped = services.some((s) => s.exists && !s.running)
		if (anyMissing) return "missing"
		if (anyStopped) return "stopped"
		return "running"
	}, [data])

	return (
		<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
			<DropdownMenuTrigger asChild disabled={isPending || isFetching}>
				<Button isLoading={isPending || isFetching} variant="outline">
					Core services
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-72" align="start">
				<DropdownMenuLabel>Status</DropdownMenuLabel>
				<div className="px-2 pb-2">
					{overall === "running" ? (
						<AlertBlock type="success">All core services are running.</AlertBlock>
					) : overall === "stopped" ? (
						<AlertBlock type="warning">
							Some core services are stopped. Reconcile will start them.
						</AlertBlock>
					) : (
						<AlertBlock type="warning">
							Some core services are missing. Reconcile will deploy them.
						</AlertBlock>
					)}
					{data?.networkName ? (
						<div className="mt-2 text-xs text-muted-foreground">
							Network: {data.networkName}
						</div>
					) : null}
				</div>

				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						className="cursor-pointer"
						onClick={async () => {
							try {
								await reconcile({ serverId })
								toast.success("Core services reconciled")
								await refetch()
								setMenuOpen(false)
							} catch (e) {
								const msg = e instanceof Error ? e.message : "Failed to reconcile"
								toast.error(msg)
							}
						}}
					>
						Reconcile (deploy/start)
					</DropdownMenuItem>
				</DropdownMenuGroup>

				{(data?.services?.length ?? 0) > 0 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>Services</DropdownMenuLabel>
						<DropdownMenuGroup>
							{data?.services?.map((s) => (
								<div key={s.containerName} className="px-2 py-1.5">
									<div className="flex items-center justify-between gap-2">
										<span className="text-sm font-medium">
											{serviceLabel(s.name)}
										</span>
										<span className="text-xs text-muted-foreground">
											{s.exists ? (s.running ? "Running" : "Stopped") : "Missing"}
										</span>
									</div>
									<div className="text-xs text-muted-foreground">
										{s.containerName}
									</div>
									{s.exists ? (
										<div className="mt-1 flex gap-2">
											<ShowModalLogs
												appName={s.containerName}
												serverId={serverId}
												type="standalone"
											>
												<Button
													variant="secondary"
													size="sm"
													onClick={(e) => e.preventDefault()}
												>
													Logs
												</Button>
											</ShowModalLogs>
										</div>
									) : null}
								</div>
							))}
						</DropdownMenuGroup>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

