"use client";

import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	type DnsProxyState,
	deriveDnsProxyState,
	dnsProxyStateHint,
	dnsProxyStateLabel,
	dnsRecordManagedByLabel,
	isProxyableDnsRecordType,
	parseDnsTtl,
} from "@/components/dashboard/domains/domain-inventory-utils";
import { AlertBlock } from "@/components/shared/alert-block";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";

type ZoneRecord = {
	cfRecordId: string;
	type: string;
	name: string;
	content: string;
	ttl: number;
	proxied: boolean;
	priority: number | null;
	managedBy: "app_domain" | "mail_stack" | "manual";
	lastSyncedAt: Date | string | null;
};

const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX"] as const;

type RecordType = (typeof RECORD_TYPES)[number];

type FormState = {
	type: RecordType;
	name: string;
	content: string;
	ttl: string;
	proxied: boolean;
	priority: string;
};

const emptyForm = (): FormState => ({
	type: "A",
	name: "",
	content: "",
	ttl: "1",
	proxied: false,
	priority: "10",
});

const formFromRecord = (record: ZoneRecord): FormState => ({
	type: (RECORD_TYPES as readonly string[]).includes(record.type)
		? (record.type as RecordType)
		: "A",
	name: record.name,
	content: record.content,
	ttl: String(record.ttl || 1),
	proxied: !!record.proxied,
	priority: String(record.priority ?? 10),
});

const proxyBadgeVariant = (state: DnsProxyState) =>
	state === "proxied" ? "default" : "outline";

const ProxyStateCell = ({ record }: { record: ZoneRecord }) => {
	const state = deriveDnsProxyState({
		type: record.type,
		proxied: record.proxied,
	});
	const label = dnsProxyStateLabel(state);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex cursor-default">
					{state === "not_proxyable" ? (
						<span className="text-xs text-muted-foreground">{label}</span>
					) : (
						<Badge variant={proxyBadgeVariant(state)}>{label}</Badge>
					)}
				</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">
				<p className="text-xs">{dnsProxyStateHint(state)}</p>
			</TooltipContent>
		</Tooltip>
	);
};

type ZoneDnsRecordsPanelProps = {
	id?: string;
	cfZoneId: string;
	zoneName: string;
	/** Provider id; defaults to cloudflare for legacy call sites. */
	provider?: string;
	credentialId?: string | null;
};

/**
 * Inline DNS record manager beneath a zone row (any Auto DNS provider).
 */
export const ZoneDnsRecordsPanel = ({
	id,
	cfZoneId,
	zoneName,
	provider = "cloudflare",
	credentialId,
}: ZoneDnsRecordsPanelProps) => {
	const utils = api.useUtils();
	const isCloudflare = provider === "cloudflare";

	const cfQuery = api.cloudflareSettings.listZoneDnsRecords.useQuery(
		{ cfZoneId },
		{ enabled: isCloudflare },
	);
	const genericQuery = api.dnsProviders.listZoneRecords.useQuery(
		{
			provider: provider as
				| "cloudflare"
				| "digitalocean"
				| "hetzner"
				| "route53"
				| "gcloud"
				| "ns1"
				| "akamai",
			zoneExternalId: cfZoneId,
			credentialId: credentialId ?? undefined,
			live: true,
		},
		{ enabled: !isCloudflare },
	);

	const data = isCloudflare ? cfQuery.data : genericQuery.data;
	const isPending = isCloudflare ? cfQuery.isPending : genericQuery.isPending;
	const isError = isCloudflare ? cfQuery.isError : genericQuery.isError;
	const error = isCloudflare ? cfQuery.error : genericQuery.error;
	const refetch = isCloudflare ? cfQuery.refetch : genericQuery.refetch;

	const [isRefreshing, setIsRefreshing] = useState(false);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editing, setEditing] = useState<ZoneRecord | null>(null);
	const [form, setForm] = useState<FormState>(emptyForm);
	const [deleteTarget, setDeleteTarget] = useState<ZoneRecord | null>(null);

	const afterMutation = async () => {
		if (isCloudflare) {
			await utils.cloudflareSettings.listZoneDnsRecords.invalidate({ cfZoneId });
		} else {
			await utils.dnsProviders.listZoneRecords.invalidate();
		}
		await utils.domain.listInventory.invalidate();
	};

	const createMutation = api.cloudflareSettings.createZoneDnsRecord.useMutation({
		onSuccess: async () => {
			toast.success("DNS record created");
			setEditorOpen(false);
			await afterMutation();
		},
		onError: (e) => toast.error(e.message),
	});

	const updateMutation = api.cloudflareSettings.updateZoneDnsRecord.useMutation({
		onSuccess: async () => {
			toast.success("DNS record updated");
			setEditorOpen(false);
			await afterMutation();
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteMutation = api.cloudflareSettings.deleteZoneDnsRecord.useMutation({
		onSuccess: async () => {
			toast.success("DNS record deleted");
			setDeleteTarget(null);
			await afterMutation();
		},
		onError: (e) => toast.error(e.message),
	});

	const upsertGeneric = api.dnsProviders.upsertZoneRecord.useMutation({
		onSuccess: async () => {
			toast.success(editing ? "DNS record updated" : "DNS record created");
			setEditorOpen(false);
			await afterMutation();
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteGeneric = api.dnsProviders.deleteZoneRecord.useMutation({
		onSuccess: async () => {
			toast.success("DNS record deleted");
			setDeleteTarget(null);
			await afterMutation();
		},
		onError: (e) => toast.error(e.message),
	});

	const titleZone =
		(isCloudflare ? cfQuery.data?.zoneName : undefined) || zoneName;
	const records = (data?.records ?? []) as ZoneRecord[];
	const canProxy = isCloudflare && isProxyableDnsRecordType(form.type);
	const isSaving =
		createMutation.isPending ||
		updateMutation.isPending ||
		upsertGeneric.isPending;

	const handleRefresh = async () => {
		setIsRefreshing(true);
		try {
			const result = await refetch();
			if (result.error) {
				throw new Error(result.error.message);
			}
			toast.success("DNS records refreshed");
		} catch (e) {
			toast.error(
				e instanceof Error ? e.message : "Could not refresh DNS records",
			);
		} finally {
			setIsRefreshing(false);
		}
	};

	const openCreate = () => {
		setEditing(null);
		setForm(emptyForm());
		setEditorOpen(true);
	};

	const openEdit = (record: ZoneRecord) => {
		setEditing(record);
		setForm(formFromRecord(record));
		setEditorOpen(true);
	};

	const submitForm = () => {
		const name = form.name.trim();
		const content = form.content.trim();
		if (!name || !content) {
			toast.error("Name and content are required");
			return;
		}
		if (form.type === "MX" && form.priority.trim() === "") {
			toast.error("MX records require a priority");
			return;
		}

		const payload = {
			type: form.type,
			name,
			content,
			ttl: parseDnsTtl(form.ttl),
			proxied: canProxy ? true : undefined,
			priority: form.type === "MX" ? Number(form.priority) || 0 : undefined,
		};

		if (!isCloudflare) {
			upsertGeneric.mutate({
				provider: provider as
					| "digitalocean"
					| "hetzner"
					| "route53"
					| "gcloud"
					| "ns1"
					| "akamai"
					| "cloudflare",
				zoneExternalId: cfZoneId,
				credentialId: credentialId ?? undefined,
				name,
				type: form.type,
				content,
				ttl: parseDnsTtl(form.ttl),
				priority: form.type === "MX" ? Number(form.priority) || 0 : undefined,
			});
			return;
		}

		if (editing) {
			updateMutation.mutate({
				cfZoneId,
				cfRecordId: editing.cfRecordId,
				record: payload,
			});
		} else {
			createMutation.mutate({ cfZoneId, record: payload });
		}
	};

	const ttlHint = useMemo(
		() => (form.ttl === "1" ? "Auto" : `${form.ttl}s`),
		[form.ttl],
	);

	return (
		<TooltipProvider>
			<div
				id={id}
				className="animate-in fade-in-0 slide-in-from-top-1 border-t bg-muted/20 duration-200"
			>
				<div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-xs text-muted-foreground">
						{data
							? `${records.length} record${records.length === 1 ? "" : "s"} · `
							: null}
						Provider is the source of truth
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-8"
							isLoading={isRefreshing}
							onClick={() => void handleRefresh()}
						>
							<RefreshCw className="mr-1.5 size-3.5" aria-hidden />
							Refresh
						</Button>
						<Button
							type="button"
							size="sm"
							className="h-8"
							onClick={openCreate}
						>
							<Plus className="mr-1.5 size-3.5" aria-hidden />
							Add record
						</Button>
					</div>
				</div>

				<div className="px-4 pb-4">
					{isPending ? (
						<div className="flex min-h-[8rem] items-center justify-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" aria-hidden />
							<span>Loading DNS records…</span>
						</div>
					) : isError ? (
						<AlertBlock type="error">
							{error?.message || "Could not load DNS records."}
						</AlertBlock>
					) : !records.length ? (
						<div className="flex min-h-[8rem] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
							<p className="max-w-sm px-4 text-sm text-muted-foreground">
								No DNS records in this domain yet.
							</p>
							<Button type="button" size="sm" onClick={openCreate}>
								<Plus className="mr-1.5 size-3.5" aria-hidden />
								Add record
							</Button>
						</div>
					) : (
						<div className="w-full overflow-x-auto rounded-lg border bg-background">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-[1%] whitespace-nowrap">
											Type
										</TableHead>
										<TableHead>Name</TableHead>
										<TableHead>Content</TableHead>
										<TableHead className="w-[1%] whitespace-nowrap">
											Proxy
										</TableHead>
										<TableHead className="hidden w-[1%] whitespace-nowrap md:table-cell">
											TTL
										</TableHead>
										<TableHead className="w-[1%] text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{records.map((record) => (
										<TableRow key={record.cfRecordId}>
											<TableCell className="align-top">
												<div className="flex flex-col gap-1">
													<Badge variant="outline" className="font-mono">
														{record.type}
													</Badge>
													{record.type === "MX" && record.priority != null ? (
														<span className="text-[11px] text-muted-foreground">
															prio {record.priority}
														</span>
													) : null}
												</div>
											</TableCell>
											<TableCell className="max-w-[12rem] align-top">
												<div className="flex min-w-0 flex-col gap-1">
													<span
														className="truncate font-mono text-xs"
														title={record.name}
													>
														{record.name}
													</span>
													{record.managedBy === "app_domain" ? (
														<span className="text-[11px] text-muted-foreground">
															{dnsRecordManagedByLabel(record.managedBy)}
														</span>
													) : null}
												</div>
											</TableCell>
											<TableCell className="max-w-[14rem] align-top">
												<span
													className="block truncate font-mono text-xs"
													title={record.content}
												>
													{record.content}
												</span>
											</TableCell>
											<TableCell className="align-top">
												<ProxyStateCell record={record} />
											</TableCell>
											<TableCell className="hidden align-top text-xs text-muted-foreground md:table-cell">
												{record.ttl === 1 ? "Auto" : `${record.ttl}s`}
											</TableCell>
											<TableCell className="align-top text-right">
												<div className="flex justify-end gap-1">
													<Button
														type="button"
														variant="ghost"
														size="icon-sm"
														onClick={() => openEdit(record)}
													>
														<Pencil className="size-3.5" aria-hidden />
														<span className="sr-only">
															Edit {record.type} {record.name}
														</span>
													</Button>
													<Button
														type="button"
														variant="ghost"
														size="icon-sm"
														className="text-destructive"
														onClick={() => setDeleteTarget(record)}
													>
														<Trash2 className="size-3.5" aria-hidden />
														<span className="sr-only">
															Delete {record.type} {record.name}
														</span>
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</div>
			</div>

			<Dialog open={editorOpen} onOpenChange={setEditorOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>
							{editing ? "Edit DNS record" : "Add DNS record"}
						</DialogTitle>
						<DialogDescription>
							Changes are applied in Cloudflare for {titleZone}.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-2">
						<div className="grid gap-2">
							<Label htmlFor="zone-dns-type">Type</Label>
							<Select
								value={form.type}
								onValueChange={(value) =>
									setForm((prev) => ({
										...prev,
										type: value as RecordType,
										proxied: isProxyableDnsRecordType(value)
											? prev.proxied
											: false,
									}))
								}
							>
								<SelectTrigger id="zone-dns-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{RECORD_TYPES.map((t) => (
										<SelectItem key={t} value={t}>
											{t}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="zone-dns-name">Name</Label>
							<Input
								id="zone-dns-name"
								className="font-mono text-sm"
								placeholder="@ or subdomain"
								value={form.name}
								onChange={(e) =>
									setForm((prev) => ({ ...prev, name: e.target.value }))
								}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="zone-dns-content">Content</Label>
							<Input
								id="zone-dns-content"
								className="font-mono text-sm"
								placeholder={
									form.type === "MX"
										? "mail.example.com"
										: form.type === "TXT"
											? "v=spf1 …"
											: "1.2.3.4"
								}
								value={form.content}
								onChange={(e) =>
									setForm((prev) => ({ ...prev, content: e.target.value }))
								}
							/>
						</div>
						{form.type === "MX" ? (
							<div className="grid gap-2">
								<Label htmlFor="zone-dns-priority">Priority</Label>
								<Input
									id="zone-dns-priority"
									type="number"
									min={0}
									max={65535}
									value={form.priority}
									onChange={(e) =>
										setForm((prev) => ({ ...prev, priority: e.target.value }))
									}
								/>
							</div>
						) : null}
						<div className="grid gap-2">
							<Label htmlFor="zone-dns-ttl">TTL ({ttlHint})</Label>
							<Input
								id="zone-dns-ttl"
								className="font-mono text-sm"
								placeholder="1 = Auto"
								value={form.ttl}
								onChange={(e) =>
									setForm((prev) => ({ ...prev, ttl: e.target.value }))
								}
							/>
						</div>
						{canProxy ? (
							<p className="text-xs text-muted-foreground">
								Cloudflare records are always proxied (provider policy).
							</p>
						) : (
							<p className="text-xs text-muted-foreground">
								{dnsProxyStateHint("not_proxyable")}
							</p>
						)}
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setEditorOpen(false)}
						>
							Cancel
						</Button>
						<Button type="button" isLoading={isSaving} onClick={submitForm}>
							{editing ? "Save changes" : "Create record"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={!!deleteTarget}
				onOpenChange={(next) => {
					if (!next) setDeleteTarget(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete DNS record?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes{" "}
							<span className="font-mono">
								{deleteTarget?.type} {deleteTarget?.name}
							</span>{" "}
							from {isCloudflare ? "Cloudflare" : "the DNS provider"}. This
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending || deleteGeneric.isPending}
							onClick={(event) => {
								event.preventDefault();
								if (!deleteTarget) return;
								if (!isCloudflare) {
									deleteGeneric.mutate({
										provider: provider as
											| "digitalocean"
											| "hetzner"
											| "route53"
											| "gcloud"
											| "ns1"
											| "akamai"
											| "cloudflare",
										zoneExternalId: cfZoneId,
										recordExternalId: deleteTarget.cfRecordId,
										credentialId: credentialId ?? undefined,
									});
									return;
								}
								deleteMutation.mutate({
									cfZoneId,
									cfRecordId: deleteTarget.cfRecordId,
								});
							}}
						>
							{deleteMutation.isPending || deleteGeneric.isPending
								? "Deleting…"
								: "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</TooltipProvider>
	);
};
