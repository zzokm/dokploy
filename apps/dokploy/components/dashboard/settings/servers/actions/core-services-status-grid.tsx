"use client"

import { useMemo } from "react"
import { AlertCircle, CheckCircle2, CircleDashed } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/utils/api"
import { ShowModalLogs } from "../../web-server/show-modal-logs"

type Props = {
	serverId?: string
}

type ServiceKey = "bind" | "exim" | "dovecot" | "roundcube"

const labelFor = (name: ServiceKey) => {
	if (name === "bind") return "BIND (DNS)"
	if (name === "exim") return "Exim (SMTP)"
	if (name === "dovecot") return "Dovecot (IMAP)"
	if (name === "roundcube") return "Roundcube (Webmail)"
	return name
}

const sortOrder: Record<ServiceKey, number> = {
	bind: 0,
	exim: 1,
	dovecot: 2,
	roundcube: 3,
}

export const CoreServicesStatusGrid = ({ serverId }: Props) => {
	const { data, isFetching } = api.settings.getCoreServicesStatus.useQuery(
		{ serverId },
		{ refetchOnWindowFocus: false },
	)

	const rows = useMemo(() => {
		const services = (data?.services ?? [])
			.slice()
			.sort(
				(a, b) =>
					(sortOrder[a.name as ServiceKey] ?? 99) -
					(sortOrder[b.name as ServiceKey] ?? 99),
			)
		return services
	}, [data])

	return (
		<div className="grid md:grid-cols-2 gap-4">
			{rows.map((s) => {
				const title = labelFor(s.name as ServiceKey)
				const status = !s.exists ? "Missing" : s.running ? "Running" : "Stopped"
				const StatusIcon = !s.exists
					? AlertCircle
					: s.running
						? CheckCircle2
						: CircleDashed
				const statusTone = !s.exists
					? "text-destructive"
					: s.running
						? "text-emerald-600"
						: "text-muted-foreground"

				return (
					<Card key={s.containerName} className="bg-transparent">
						<CardHeader className="pb-3">
							<CardTitle className="text-base flex items-center justify-between gap-3">
								<span className="flex items-center gap-2">
									<StatusIcon className={`size-4 ${statusTone}`} aria-hidden />
									{title}
								</span>
								<span className="text-xs text-muted-foreground">
									{isFetching ? "Checking…" : status}
								</span>
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2">
							<div className="text-xs text-muted-foreground">{s.containerName}</div>
							{s.exists ? (
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
										View logs
									</Button>
								</ShowModalLogs>
							) : (
								<p className="text-xs text-muted-foreground">
									This service is expected to be managed automatically.
								</p>
							)}
						</CardContent>
					</Card>
				)
			})}
		</div>
	)
}

