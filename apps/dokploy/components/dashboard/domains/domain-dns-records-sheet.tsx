"use client";

import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import {
	dnsRecordManagedByLabel,
	isPreviewableDnsRecordType,
} from "@/components/dashboard/domains/domain-inventory-utils";
import { Badge } from "@/components/ui/badge";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api } from "@/utils/api";

const formatRelative = (iso: string | null) => {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return formatDistanceToNow(date, { addSuffix: true });
};

type DomainDnsRecordsSheetProps = {
	domainId: string | null;
	host?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export const DomainDnsRecordsSheet = ({
	domainId,
	host,
	open,
	onOpenChange,
}: DomainDnsRecordsSheetProps) => {
	const { data, isPending, isError, error } = api.domain.listDnsRecords.useQuery(
		{ domainId: domainId ?? "" },
		{ enabled: open && !!domainId },
	);

	const titleHost = data?.host || host || "Domain";
	const records = (data?.records ?? []).filter((record) =>
		isPreviewableDnsRecordType(record.type),
	);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="flex w-full flex-col sm:max-w-[640px]!">
				<SheetHeader>
					<SheetTitle>DNS records</SheetTitle>
					<SheetDescription>
						Read-only Cloudflare records for{" "}
						<span className="font-mono text-foreground">{titleHost}</span>
						{data?.zoneName ? (
							<>
								{" "}
								in zone{" "}
								<span className="font-mono text-foreground">
									{data.zoneName}
								</span>
							</>
						) : null}
						.
					</SheetDescription>
				</SheetHeader>

				<div className="mt-4 grow overflow-auto">
					{isPending ? (
						<div className="flex min-h-[10rem] items-center justify-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-5 animate-spin" aria-hidden />
							<span>Loading DNS records…</span>
						</div>
					) : isError ? (
						<p className="text-sm text-destructive">
							{error.message || "Could not load DNS records."}
						</p>
					) : !records.length ? (
						<div className="flex min-h-[8rem] flex-col items-center justify-center gap-2 px-2 text-center animate-in fade-in-0 duration-300">
							<p className="max-w-sm text-sm text-muted-foreground">
								No mirrored Cloudflare A/CNAME records for this hostname yet.
								Sync DNS from the inventory to populate them.
							</p>
						</div>
					) : (
						<div className="overflow-hidden rounded-lg border animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Type</TableHead>
										<TableHead>Name</TableHead>
										<TableHead>Target</TableHead>
										<TableHead className="hidden sm:table-cell">
											Proxy
										</TableHead>
										<TableHead className="hidden md:table-cell">
											Synced
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{records.map((record, index) => (
										<TableRow
											key={record.cfRecordId}
											className="animate-in fade-in-0 duration-300 fill-mode-both"
											style={{
												animationDelay: `${Math.min(index, 8) * 30}ms`,
											}}
										>
											<TableCell>
												<Badge variant="outline" className="font-mono">
													{record.type}
												</Badge>
											</TableCell>
											<TableCell className="max-w-[10rem] truncate font-mono text-xs">
												{record.name}
											</TableCell>
											<TableCell className="max-w-[12rem] truncate font-mono text-xs">
												{record.content}
											</TableCell>
											<TableCell className="hidden sm:table-cell">
												<Badge
													variant={record.proxied ? "default" : "outline"}
												>
													{record.proxied ? "Proxied" : "DNS only"}
												</Badge>
											</TableCell>
											<TableCell className="hidden space-y-0.5 md:table-cell">
												<span className="block text-xs text-muted-foreground">
													{formatRelative(record.lastSyncedAt)}
												</span>
												<span className="block text-[11px] text-muted-foreground">
													{dnsRecordManagedByLabel(record.managedBy)}
												</span>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
};
