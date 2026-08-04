"use client";

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { Globe2, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
	inventoryDnsBadgeFromCfStatus,
	inventorySslLabel,
} from "@/components/dashboard/domains/domain-inventory-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api, type RouterOutputs } from "@/utils/api";

export type InventoryRow =
	RouterOutputs["domain"]["listInventory"][number];

const formatRelative = (iso: string | null) => {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return formatDistanceToNow(date, { addSuffix: true });
};

const sslLabel = (row: InventoryRow) =>
	inventorySslLabel({
		certificateType: row.certificateType,
		https: row.https,
	});

const dnsLabel = (row: InventoryRow) =>
	inventoryDnsBadgeFromCfStatus({
		dnsProvider: row.dnsProvider,
		cfStatus: row.cfStatus,
	});

const dnsVariant = (
	row: InventoryRow,
): "default" | "secondary" | "destructive" | "outline" => {
	const label = dnsLabel(row);
	if (label === "Valid") return "default";
	if (label === "Failed") return "destructive";
	if (label === "Pending") return "secondary";
	return "outline";
};

const kindLabel = (kind: InventoryRow["kind"]) => {
	if (kind === "web-server") return "Web server";
	if (kind === "compose") return "Compose";
	if (kind === "preview") return "Preview";
	return "Application";
};

export const DomainsInventoryTable = () => {
	const { data, isPending } = api.domain.listInventory.useQuery();
	const [sorting, setSorting] = useState<SortingState>([
		{ id: "host", desc: false },
	]);
	const [hostFilter, setHostFilter] = useState("");

	const columns = useMemo<ColumnDef<InventoryRow>[]>(
		() => [
			{
				accessorKey: "host",
				header: "Host",
				cell: ({ row }) => (
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className="truncate font-mono text-sm">
							{row.original.host}
						</span>
						<span className="text-xs text-muted-foreground">
							{kindLabel(row.original.kind)}
						</span>
					</div>
				),
			},
			{
				accessorKey: "serviceName",
				header: "Linked service",
				cell: ({ row }) => (
					<span className="truncate text-sm">{row.original.serviceName}</span>
				),
			},
			{
				id: "dns",
				header: "DNS",
				cell: ({ row }) => (
					<Badge variant={dnsVariant(row.original)}>
						{dnsLabel(row.original)}
					</Badge>
				),
			},
			{
				id: "ssl",
				header: "SSL",
				cell: ({ row }) => (
					<span className="text-sm text-muted-foreground">
						{sslLabel(row.original)}
					</span>
				),
			},
			{
				id: "proxy",
				header: "Proxy",
				cell: ({ row }) => {
					if (row.original.cfProxied === null) {
						return <span className="text-sm text-muted-foreground">—</span>;
					}
					return (
						<Badge variant={row.original.cfProxied ? "default" : "outline"}>
							{row.original.cfProxied ? "Proxied" : "DNS only"}
						</Badge>
					);
				},
			},
			{
				id: "lastSync",
				header: "Last sync",
				cell: ({ row }) => (
					<span className="whitespace-nowrap text-sm text-muted-foreground">
						{formatRelative(row.original.lastSyncedAt)}
					</span>
				),
			},
		],
		[],
	);

	const filtered = useMemo(() => {
		const rows = data ?? [];
		const q = hostFilter.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter(
			(row) =>
				row.host.toLowerCase().includes(q) ||
				row.serviceName.toLowerCase().includes(q),
		);
	}, [data, hostFilter]);

	const table = useReactTable({
		data: filtered,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		initialState: { pagination: { pageSize: 12 } },
	});

	if (isPending) {
		return (
			<div className="flex min-h-[20vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground sm:flex-row">
				<Loader2 className="size-5 animate-spin" aria-hidden />
				<span>Loading domains…</span>
			</div>
		);
	}

	if (!data?.length) {
		return (
			<div className="flex min-h-[20vh] flex-col items-center justify-center gap-3 px-2 text-center">
				<Globe2 className="size-8 text-muted-foreground" aria-hidden />
				<span className="max-w-md text-base text-muted-foreground">
					No application domains yet. Attach a hostname from a project service.
				</span>
			</div>
		);
	}

	return (
		<div className="flex w-full flex-col gap-4">
			<div className="relative max-w-sm">
				<Search
					className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden
				/>
				<Input
					value={hostFilter}
					onChange={(e) => setHostFilter(e.target.value)}
					placeholder="Filter by host or service…"
					className="pl-8"
				/>
			</div>
			<div className="w-full overflow-auto rounded-lg border">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										className={
											header.id === "proxy" || header.id === "lastSync"
												? "hidden md:table-cell"
												: header.id === "ssl"
													? "hidden sm:table-cell"
													: undefined
										}
									>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.length ? (
							table.getRowModel().rows.map((row, index) => (
								<TableRow
									key={row.id}
									className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-300"
									style={{
										animationDelay: `${Math.min(index, 8) * 30}ms`,
									}}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell
											key={cell.id}
											className={
												cell.column.id === "proxy" ||
												cell.column.id === "lastSync"
													? "hidden md:table-cell"
													: cell.column.id === "ssl"
														? "hidden sm:table-cell"
														: undefined
											}
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-24 text-center text-muted-foreground"
								>
									No domains match this filter.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			{filtered.length > 12 ? (
				<div className="flex items-center justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => table.previousPage()}
						disabled={!table.getCanPreviousPage()}
					>
						Previous
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => table.nextPage()}
						disabled={!table.getCanNextPage()}
					>
						Next
					</Button>
				</div>
			) : null}
		</div>
	);
};
