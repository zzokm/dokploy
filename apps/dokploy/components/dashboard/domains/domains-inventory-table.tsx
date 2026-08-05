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
import {
	ExternalLink,
	FolderOpen,
	Globe2,
	Loader2,
	Search,
	Settings2,
} from "lucide-react";
import { useRouter } from "next/router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	buildDomainEditHref,
	buildHostnameExternalUrl,
	deriveInventoryWarnings,
	inventoryDnsBadgeFromCfStatus,
	inventoryDnsBadgeFromValidation,
	inventorySslBadge,
	openProjectButtonLabel,
	sanitizeDnsValidationError,
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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api, type RouterOutputs } from "@/utils/api";

export type InventoryRow =
	RouterOutputs["domain"]["listInventory"][number];

type DnsHealthState = {
	isLoading: boolean;
	isValid?: boolean;
	error?: string;
};

type DnsHealthMap = Record<string, DnsHealthState>;

const healthVariant = (
	label: string,
): "default" | "secondary" | "destructive" | "outline" => {
	if (label === "Valid") {
		return "default";
	}
	if (
		label === "Failed" ||
		label === "Redeploy required" ||
		label === "Host publish port"
	) {
		return "destructive";
	}
	if (label === "Pending" || label === "Cert pending") return "secondary";
	return "outline";
};

const kindLabel = (kind: InventoryRow["kind"]) => {
	if (kind === "web-server") return "Web server";
	if (kind === "compose") return "Compose";
	if (kind === "preview") return "Preview";
	return "Application";
};

const HealthBadgeCell = ({
	label,
	hint,
}: {
	label: string;
	hint?: string;
}) => {
	const badge = <Badge variant={healthVariant(label)}>{label}</Badge>;
	if (!hint) return badge;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex cursor-default">{badge}</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">
				<p className="text-xs">{hint}</p>
			</TooltipContent>
		</Tooltip>
	);
};

export const DomainsInventoryTable = ({
	emptyContent,
}: {
	emptyContent?: ReactNode;
}) => {
	const router = useRouter();
	const { data, isPending } = api.domain.listInventory.useQuery();
	const { mutateAsync: validateDomain } =
		api.domain.validateDomain.useMutation();
	const [sorting, setSorting] = useState<SortingState>([
		{ id: "host", desc: false },
	]);
	const [hostFilter, setHostFilter] = useState("");
	const [dnsHealth, setDnsHealth] = useState<DnsHealthMap>({});
	const validatedKeyRef = useRef<string>("");

	const openProject = (row: InventoryRow) => {
		const href = buildDomainEditHref({
			kind: row.kind,
			projectId: row.projectId,
			environmentId: row.environmentId,
			applicationId: row.applicationId,
			composeId: row.composeId,
			domainId: row.domainId,
		});
		if (!href) return;
		void router.push(href);
	};

	useEffect(() => {
		if (!data?.length) {
			setDnsHealth({});
			validatedKeyRef.current = "";
			return;
		}

		const key = data.map((row) => `${row.domainId}:${row.host}`).join("|");
		if (key === validatedKeyRef.current) {
			return;
		}
		validatedKeyRef.current = key;

		let cancelled = false;
		const initial: DnsHealthMap = {};
		for (const row of data) {
			initial[row.domainId] = { isLoading: true };
		}
		setDnsHealth(initial);

		const run = async () => {
			const concurrency = 4;
			let index = 0;

			const worker = async () => {
				while (index < data.length && !cancelled) {
					const current = index++;
					const row = data[current];
					if (!row) continue;
					try {
						const result = await validateDomain({
							domain: row.host,
							serverIp: row.expectedServerIp || undefined,
						});
						if (cancelled) return;
						setDnsHealth((prev) => ({
							...prev,
							[row.domainId]: {
								isLoading: false,
								isValid: result.isValid,
								error: result.isValid
									? undefined
									: sanitizeDnsValidationError(result.error),
							},
						}));
					} catch (err) {
						if (cancelled) return;
						const message =
							err instanceof Error ? err.message : "Failed to validate domain";
						setDnsHealth((prev) => ({
							...prev,
							[row.domainId]: {
								isLoading: false,
								isValid: false,
								error: sanitizeDnsValidationError(message),
							},
						}));
					}
				}
			};

			await Promise.all(
				Array.from({ length: Math.min(concurrency, data.length) }, () =>
					worker(),
				),
			);
		};

		void run();
		return () => {
			cancelled = true;
		};
	}, [data, validateDomain]);

	const columns = useMemo<ColumnDef<InventoryRow>[]>(
		() => [
			{
				accessorKey: "host",
				header: "Host",
				cell: ({ row }) => {
					const warnings = deriveInventoryWarnings({
						kind: row.original.kind,
						createdAt: row.original.createdAt,
						lastSuccessfulDeployAt: row.original.lastSuccessfulDeployAt,
						certificateType: row.original.certificateType,
						https: row.original.https,
						portLooksLikeHostPublish: row.original.portLooksLikeHostPublish,
						port: row.original.port,
						tlsReachable: row.original.tlsReachable,
					});
					const externalUrl = buildHostnameExternalUrl({
						host: row.original.host,
						https: row.original.https,
					});
					return (
						<div className="flex min-w-0 flex-col gap-0.5">
							<a
								href={externalUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="group inline-flex max-w-full items-center gap-1 truncate font-mono text-sm underline-offset-2 hover:underline"
								onClick={(event) => event.stopPropagation()}
							>
								<span className="truncate">{row.original.host}</span>
								<ExternalLink
									className="size-3 shrink-0 text-muted-foreground opacity-70 transition-opacity group-hover:opacity-100"
									aria-hidden
								/>
								<span className="sr-only">Open hostname in new tab</span>
							</a>
							<span className="text-xs text-muted-foreground">
								{kindLabel(row.original.kind)}
							</span>
							{warnings.length ? (
								<div className="mt-1 flex flex-wrap gap-1">
									{warnings.map((warning) => (
										<HealthBadgeCell
											key={warning.kind}
											label={warning.label}
											hint={warning.hint}
										/>
									))}
								</div>
							) : null}
						</div>
					);
				},
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
				cell: ({ row }) => {
					const health = dnsHealth[row.original.domainId];
					const label = health
						? inventoryDnsBadgeFromValidation(health)
						: inventoryDnsBadgeFromCfStatus({
								dnsProvider: row.original.dnsProvider,
								cfStatus: row.original.cfStatus,
							});
					return (
						<HealthBadgeCell
							label={label}
							hint={
								health?.error ||
								(label === "Manual"
									? "Not using Cloudflare DNS automation"
									: undefined)
							}
						/>
					);
				},
			},
			{
				id: "ssl",
				header: "SSL",
				cell: ({ row }) => {
					const label = inventorySslBadge({
						certificateType: row.original.certificateType,
						https: row.original.https,
						createdAt: row.original.createdAt,
						tlsReachable: row.original.tlsReachable,
					});
					const display = label === "Pending" ? "Cert pending" : label;
					return (
						<HealthBadgeCell
							label={display}
							hint={
								label === "Pending"
									? "Let's Encrypt certificate is still being issued. This usually finishes within a few minutes."
									: label === "Failed"
										? "HTTPS is configured but TLS could not be verified on port 443."
										: undefined
							}
						/>
					);
				},
			},
			{
				id: "actions",
				header: "Actions",
				cell: ({ row }) => {
					const href = buildDomainEditHref({
						kind: row.original.kind,
						projectId: row.original.projectId,
						environmentId: row.original.environmentId,
						applicationId: row.original.applicationId,
						composeId: row.original.composeId,
						domainId: row.original.domainId,
					});
					const label = openProjectButtonLabel(row.original.kind);
					const Icon =
						row.original.kind === "web-server" ? Settings2 : FolderOpen;
					return (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="h-8 whitespace-nowrap"
							disabled={!href}
							onClick={() => openProject(row.original)}
						>
							<Icon className="mr-1.5 size-3.5" aria-hidden />
							{label}
						</Button>
					);
				},
			},
		],
		[dnsHealth],
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
		if (emptyContent) {
			return <>{emptyContent}</>;
		}
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
		<TooltipProvider>
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
												header.id === "ssl" ? "hidden sm:table-cell" : undefined
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
										className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-300 hover:bg-muted/40"
										style={{
											animationDelay: `${Math.min(index, 8) * 30}ms`,
										}}
									>
										{row.getVisibleCells().map((cell) => (
											<TableCell
												key={cell.id}
												className={
													cell.column.id === "ssl"
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
		</TooltipProvider>
	);
};
