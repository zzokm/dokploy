"use client";

import { formatDistanceToNow } from "date-fns";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { dnsRecordManagedByLabel } from "@/components/dashboard/domains/domain-inventory-utils";
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
import { api, type RouterOutputs } from "@/utils/api";

type ZoneRecord =
	RouterOutputs["cloudflareSettings"]["listZoneDnsRecords"]["records"][number];

type RecordType = "A" | "AAAA" | "CNAME" | "TXT" | "MX";

type FormState = {
	type: RecordType;
	name: string;
	content: string;
	ttl: string;
	proxied: boolean;
	priority: string;
};

const PROXYABLE = new Set<RecordType>(["A", "AAAA", "CNAME"]);

const emptyForm = (): FormState => ({
	type: "A",
	name: "",
	content: "",
	ttl: "1",
	proxied: false,
	priority: "10",
});

const formFromRecord = (record: ZoneRecord): FormState => ({
	type: (["A", "AAAA", "CNAME", "TXT", "MX"].includes(record.type)
		? record.type
		: "A") as RecordType,
	name: record.name,
	content: record.content,
	ttl: String(record.ttl || 1),
	proxied: !!record.proxied,
	priority: String(record.priority ?? 10),
});

const formatRelative = (iso: string | null) => {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return formatDistanceToNow(date, { addSuffix: true });
};

const parseTtl = (value: string): 1 | number => {
	const n = Number(value);
	if (n === 1) return 1;
	if (Number.isFinite(n) && n >= 60) return Math.floor(n);
	return 1;
};

type ZoneDnsRecordsSheetProps = {
	cfZoneId: string | null;
	zoneName?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export const ZoneDnsRecordsSheet = ({
	cfZoneId,
	zoneName,
	open,
	onOpenChange,
}: ZoneDnsRecordsSheetProps) => {
	const utils = api.useUtils();
	const { data, isPending, isError, error, refetch } =
		api.cloudflareSettings.listZoneDnsRecords.useQuery(
			{ cfZoneId: cfZoneId ?? "" },
			{ enabled: open && !!cfZoneId },
		);

	const [editorOpen, setEditorOpen] = useState(false);
	const [editing, setEditing] = useState<ZoneRecord | null>(null);
	const [form, setForm] = useState<FormState>(emptyForm);
	const [deleteTarget, setDeleteTarget] = useState<ZoneRecord | null>(null);

	const createMutation = api.cloudflareSettings.createZoneDnsRecord.useMutation({
		onSuccess: async () => {
			toast.success("DNS record created");
			setEditorOpen(false);
			await utils.cloudflareSettings.listZoneDnsRecords.invalidate();
			await utils.domain.listInventory.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const updateMutation = api.cloudflareSettings.updateZoneDnsRecord.useMutation({
		onSuccess: async () => {
			toast.success("DNS record updated");
			setEditorOpen(false);
			await utils.cloudflareSettings.listZoneDnsRecords.invalidate();
			await utils.domain.listInventory.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteMutation = api.cloudflareSettings.deleteZoneDnsRecord.useMutation({
		onSuccess: async () => {
			toast.success("DNS record deleted");
			setDeleteTarget(null);
			await utils.cloudflareSettings.listZoneDnsRecords.invalidate();
			await utils.domain.listInventory.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	useEffect(() => {
		if (!open) {
			setEditorOpen(false);
			setEditing(null);
			setDeleteTarget(null);
			setForm(emptyForm());
		}
	}, [open]);

	const titleZone = data?.zoneName || zoneName || "Domain";
	const records = data?.records ?? [];
	const canProxy = PROXYABLE.has(form.type);
	const isSaving = createMutation.isPending || updateMutation.isPending;

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
		if (!cfZoneId) return;
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
			ttl: parseTtl(form.ttl),
			proxied: canProxy ? form.proxied : undefined,
			priority:
				form.type === "MX" ? Number(form.priority) || 0 : undefined,
		};

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
		<>
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent className="flex w-full flex-col sm:max-w-[720px]!">
					<SheetHeader>
						<SheetTitle>DNS records</SheetTitle>
						<SheetDescription>
							Manage Cloudflare DNS for{" "}
							<span className="font-mono text-foreground">{titleZone}</span>.
							Cloudflare is the source of truth; local mirrors update after
							changes.
						</SheetDescription>
					</SheetHeader>

					<div className="mt-4 flex items-center justify-between gap-2">
						<p className="text-xs text-muted-foreground">
							{records.length} record{records.length === 1 ? "" : "s"}
						</p>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void refetch()}
							>
								Refresh
							</Button>
							<Button type="button" size="sm" onClick={openCreate}>
								<Plus className="mr-1 size-3.5" aria-hidden />
								Add record
							</Button>
						</div>
					</div>

					<div className="mt-3 grow overflow-auto">
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
							<div className="flex min-h-[8rem] flex-col items-center justify-center gap-3 px-2 text-center animate-in fade-in-0 duration-300">
								<p className="max-w-sm text-sm text-muted-foreground">
									No DNS records in this zone yet.
								</p>
								<Button type="button" size="sm" onClick={openCreate}>
									<Plus className="mr-1 size-3.5" aria-hidden />
									Add record
								</Button>
							</div>
						) : (
							<div className="overflow-hidden rounded-lg border animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Type</TableHead>
											<TableHead>Name</TableHead>
											<TableHead>Content</TableHead>
											<TableHead className="hidden sm:table-cell">
												Proxy
											</TableHead>
											<TableHead className="hidden md:table-cell">
												TTL
											</TableHead>
											<TableHead className="w-[1%] text-right">
												Actions
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
													<div className="flex flex-col gap-0.5">
														<Badge variant="outline" className="w-fit font-mono">
															{record.type}
														</Badge>
														{record.type === "MX" && record.priority != null ? (
															<span className="text-[11px] text-muted-foreground">
																prio {record.priority}
															</span>
														) : null}
													</div>
												</TableCell>
												<TableCell className="max-w-[10rem] truncate font-mono text-xs">
													{record.name}
												</TableCell>
												<TableCell className="max-w-[12rem] truncate font-mono text-xs">
													{record.content}
												</TableCell>
												<TableCell className="hidden sm:table-cell">
													{PROXYABLE.has(record.type as RecordType) ? (
														<Badge
															variant={record.proxied ? "default" : "outline"}
														>
															{record.proxied ? "Proxied" : "DNS only"}
														</Badge>
													) : (
														<span className="text-xs text-muted-foreground">
															—
														</span>
													)}
												</TableCell>
												<TableCell className="hidden space-y-0.5 md:table-cell">
													<span className="block text-xs text-muted-foreground">
														{record.ttl === 1 ? "Auto" : record.ttl}
													</span>
													{record.managedBy ? (
														<span className="block text-[11px] text-muted-foreground">
															{dnsRecordManagedByLabel(record.managedBy)}
															{record.lastSyncedAt
																? ` · ${formatRelative(record.lastSyncedAt)}`
																: ""}
														</span>
													) : null}
												</TableCell>
												<TableCell className="text-right">
													<div className="flex justify-end gap-1">
														<Button
															type="button"
															variant="ghost"
															size="sm"
															className="h-7 px-2"
															onClick={() => openEdit(record)}
														>
															<Pencil className="size-3.5" aria-hidden />
															<span className="sr-only">Edit</span>
														</Button>
														<Button
															type="button"
															variant="ghost"
															size="sm"
															className="h-7 px-2 text-destructive"
															onClick={() => setDeleteTarget(record)}
														>
															<Trash2 className="size-3.5" aria-hidden />
															<span className="sr-only">Delete</span>
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
				</SheetContent>
			</Sheet>

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
										proxied: PROXYABLE.has(value as RecordType)
											? prev.proxied
											: false,
									}))
								}
							>
								<SelectTrigger id="zone-dns-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{(["A", "AAAA", "CNAME", "TXT", "MX"] as const).map((t) => (
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
							<div className="flex items-center gap-2">
								<Checkbox
									id="zone-dns-proxied"
									checked={form.proxied}
									onCheckedChange={(checked) =>
										setForm((prev) => ({
											...prev,
											proxied: checked === true,
										}))
									}
								/>
								<Label htmlFor="zone-dns-proxied" className="font-normal">
									Proxy through Cloudflare
								</Label>
							</div>
						) : null}
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
							from Cloudflare. This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
							onClick={(event) => {
								event.preventDefault();
								if (!cfZoneId || !deleteTarget) return;
								deleteMutation.mutate({
									cfZoneId,
									cfRecordId: deleteTarget.cfRecordId,
								});
							}}
						>
							{deleteMutation.isPending ? "Deleting…" : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
};
