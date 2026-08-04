import {
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table";
import {
	CheckCircle2,
	ChevronDown,
	ExternalLink,
	GlobeIcon,
	InfoIcon,
	LayoutGrid,
	LayoutList,
	Loader2,
	PenBoxIcon,
	RefreshCw,
	Server,
	Trash2,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { DialogAction } from "@/components/shared/dialog-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { api } from "@/utils/api";
import { CloudflareDomainControls } from "./cloudflare-domain-controls";
import { createColumns } from "./columns";
import { DnsHelperModal } from "./dns-helper-modal";
import { DomainConnectionPanel } from "./domain-connection-panel";
import { AddDomain } from "./handle-domain";
import { HandleForwardAuth } from "./handle-forward-auth";

export type ValidationState = {
	isLoading: boolean;
	isValid?: boolean;
	error?: string;
	resolvedIp?: string;
	message?: string;
	cdnProvider?: string;
};

export type ValidationStates = Record<string, ValidationState>;

interface Props {
	id: string;
	type: "application" | "compose";
}

export const ShowDomains = ({ id, type }: Props) => {
	const { data: permissions } = api.user.getPermissions.useQuery();
	const canCreateDomain = permissions?.domain.create ?? false;
	const canDeleteDomain = permissions?.domain.delete ?? false;
	const { data: application } =
		type === "application"
			? api.application.one.useQuery(
					{
						applicationId: id,
					},
					{
						enabled: !!id,
					},
				)
			: api.compose.one.useQuery(
					{
						composeId: id,
					},
					{
						enabled: !!id,
					},
				);
	const [validationStates, setValidationStates] = useState<ValidationStates>(
		{},
	);
	const [viewMode, setViewMode] = useState<"grid" | "table">(() => {
		if (typeof window !== "undefined") {
			return (
				(localStorage.getItem("domains-view-mode") as "grid" | "table") ??
				"grid"
			);
		}
		return "grid";
	});
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [rowSelection, setRowSelection] = useState({});
	const { data: ip } = api.settings.getIp.useQuery();

	const {
		data,
		refetch,
		isLoading: isLoadingDomains,
	} = type === "application"
		? api.domain.byApplicationId.useQuery(
				{
					applicationId: id,
				},
				{
					enabled: !!id,
				},
			)
		: api.domain.byComposeId.useQuery(
				{
					composeId: id,
				},
				{
					enabled: !!id,
				},
			);

	const { mutateAsync: validateDomain } =
		api.domain.validateDomain.useMutation();
	const { mutateAsync: deleteDomain, isPending: isRemoving } =
		api.domain.delete.useMutation();

	const handleDeleteDomain = async (domainId: string) => {
		try {
			await deleteDomain({ domainId });
			refetch();
			toast.success("Domain deleted successfully");
		} catch {
			toast.error("Error deleting domain");
		}
	};

	const handleValidateDomain = async (host: string) => {
		setValidationStates((prev) => ({
			...prev,
			[host]: { isLoading: true },
		}));

		try {
			const result = await validateDomain({
				domain: host,
				serverIp:
					application?.server?.ipAddress?.toString() || ip?.toString() || "",
			});

			setValidationStates((prev) => ({
				...prev,
				[host]: {
					isLoading: false,
					isValid: result.isValid,
					error: result.error,
					resolvedIp: result.resolvedIp,
					cdnProvider: result.cdnProvider,
					message: result.error && result.isValid ? result.error : undefined,
				},
			}));
		} catch (err) {
			const error = err as Error;
			setValidationStates((prev) => ({
				...prev,
				[host]: {
					isLoading: false,
					isValid: false,
					error: error.message || "Failed to validate domain",
				},
			}));
		}
	};

	const columns = createColumns({
		id,
		type,
		validationStates,
		handleValidateDomain,
		handleDeleteDomain,
		isDeleting: isRemoving,
		serverIp: application?.server?.ipAddress?.toString() || ip?.toString(),
		canCreateDomain,
		canDeleteDomain,
	});

	const table = useReactTable({
		data: data ?? [],
		columns,
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onColumnVisibilityChange: setColumnVisibility,
		onRowSelectionChange: setRowSelection,
		state: {
			sorting,
			columnFilters,
			columnVisibility,
			rowSelection,
		},
	});

	return (
		<div className="flex w-full animate-in fade-in-0 slide-in-from-bottom-2 flex-col gap-5 duration-300">
			<Card className="w-full bg-background">
				<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-1">
						<CardTitle className="flex items-center gap-2 text-xl">
							<GlobeIcon className="size-5 text-muted-foreground" aria-hidden />
							Domains
						</CardTitle>
						<CardDescription>
							Hostnames used to reach this application, with optional Cloudflare
							DNS automation.
						</CardDescription>
					</div>

					<div className="flex flex-row flex-wrap gap-2">
						{data && data?.length > 0 && (
							<>
								<Button
									variant="outline"
									size="icon"
									onClick={() => {
										const next = viewMode === "grid" ? "table" : "grid";
										localStorage.setItem("domains-view-mode", next);
										setViewMode(next);
									}}
								>
									{viewMode === "grid" ? (
										<LayoutList className="size-4" />
									) : (
										<LayoutGrid className="size-4" />
									)}
								</Button>
								{canCreateDomain && (
									<AddDomain id={id} type={type}>
										<Button>
											<GlobeIcon className="size-4" /> Add Domain
										</Button>
									</AddDomain>
								)}
							</>
						)}
					</div>
				</CardHeader>
				<CardContent className="flex w-full flex-col gap-4">
					{isLoadingDomains ? (
						<div className="flex min-h-[40vh] w-full flex-row items-center justify-center gap-3">
							<Loader2 className="size-5 animate-spin text-muted-foreground" />
							<span className="text-base text-muted-foreground">
								Loading domains…
							</span>
						</div>
					) : data?.length === 0 ? (
						<div className="flex min-h-[40vh] w-full flex-col items-center justify-center gap-3">
							<div className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted/40">
								<GlobeIcon
									className="size-6 text-muted-foreground"
									aria-hidden
								/>
							</div>
							<span className="max-w-sm text-center text-base text-muted-foreground">
								Add at least one domain so traffic can reach this application.
							</span>
							{canCreateDomain && (
								<div className="flex flex-row flex-wrap gap-4">
									<AddDomain id={id} type={type}>
										<Button>
											<GlobeIcon className="size-4" /> Add Domain
										</Button>
									</AddDomain>
								</div>
							)}
						</div>
					) : viewMode === "table" ? (
						<div className="flex flex-col gap-4 w-full">
							<div className="flex items-center gap-2 max-sm:flex-wrap">
								<Input
									placeholder="Filter by host..."
									value={
										(table.getColumn("host")?.getFilterValue() as string) ?? ""
									}
									onChange={(event) =>
										table.getColumn("host")?.setFilterValue(event.target.value)
									}
									className="md:max-w-sm"
								/>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="outline"
											className="sm:ml-auto max-sm:w-full"
										>
											Columns <ChevronDown className="ml-2 h-4 w-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										{table
											.getAllColumns()
											.filter((column) => column.getCanHide())
											.map((column) => {
												return (
													<DropdownMenuCheckboxItem
														key={column.id}
														className="capitalize"
														checked={column.getIsVisible()}
														onCheckedChange={(value) =>
															column.toggleVisibility(!!value)
														}
													>
														{column.id}
													</DropdownMenuCheckboxItem>
												);
											})}
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
							<div className="w-full overflow-x-auto rounded-md border">
								<Table>
									<TableHeader>
										{table.getHeaderGroups().map((headerGroup) => (
											<TableRow key={headerGroup.id}>
												{headerGroup.headers.map((header) => {
													return (
														<TableHead key={header.id}>
															{header.isPlaceholder
																? null
																: flexRender(
																		header.column.columnDef.header,
																		header.getContext(),
																	)}
														</TableHead>
													);
												})}
											</TableRow>
										))}
									</TableHeader>
									<TableBody>
										{table?.getRowModel()?.rows?.length ? (
											table.getRowModel().rows.map((row) => (
												<TableRow
													key={row.id}
													data-state={row.getIsSelected() && "selected"}
												>
													{row.getVisibleCells().map((cell) => (
														<TableCell key={cell.id}>
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
													className="h-24 text-center"
												>
													No results.
												</TableCell>
											</TableRow>
										)}
									</TableBody>
								</Table>
							</div>
							{data && data?.length > 0 && (
								<div className="flex items-center justify-end space-x-2 py-4">
									<div className="space-x-2 flex flex-wrap">
										<Button
											variant="outline"
											size="sm"
											onClick={() => table.previousPage()}
											disabled={!table.getCanPreviousPage()}
										>
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => table.nextPage()}
											disabled={!table.getCanNextPage()}
										>
											Next
										</Button>
									</div>
								</div>
							)}
						</div>
					) : (
						<div className="grid min-h-[40vh] w-full grid-cols-1 gap-4 xl:grid-cols-2">
							{data?.map((item, index) => {
								const validationState = validationStates[item.host];
								return (
									<Card
										key={item.domainId}
										className="relative h-fit w-full animate-in fade-in-0 slide-in-from-bottom-2 overflow-hidden border bg-transparent transition-all duration-300 fill-mode-both hover:shadow-md"
										style={{
											animationDelay: `${Math.min(index, 8) * 40}ms`,
										}}
									>
										<CardContent className="p-6">
											<div className="flex flex-col gap-4">
												{/* Service & Domain Info */}
												<div className="flex items-center justify-between flex-wrap gap-y-2">
													{item.serviceName && (
														<Badge variant="outline" className="w-fit">
															<Server className="size-3 mr-1" />
															{item.serviceName}
														</Badge>
													)}
													<div className="flex gap-2 flex-wrap">
														{!item.host.includes("sslip.io") && (
															<DnsHelperModal
																domain={{
																	host: item.host,
																	https: item.https,
																	path: item.path || undefined,
																}}
																serverIp={
																	application?.server?.ipAddress?.toString() ||
																	ip?.toString()
																}
															/>
														)}
														{canCreateDomain && (
															<AddDomain
																id={id}
																type={type}
																domainId={item.domainId}
															>
																<Button
																	variant="ghost"
																	size="icon"
																	className="group hover:bg-blue-500/10"
																>
																	<PenBoxIcon className="size-3.5 text-primary group-hover:text-blue-500" />
																</Button>
															</AddDomain>
														)}
														{canCreateDomain && type === "application" && (
															<HandleForwardAuth
																domainId={item.domainId}
																applicationId={id}
															/>
														)}
														{canDeleteDomain && (
															<DialogAction
																title="Delete Domain"
																description="Are you sure you want to delete this domain?"
																type="destructive"
																onClick={async () => {
																	await deleteDomain({
																		domainId: item.domainId,
																	})
																		.then((_data) => {
																			refetch();
																			toast.success(
																				"Domain deleted successfully",
																			);
																		})
																		.catch(() => {
																			toast.error("Error deleting domain");
																		});
																}}
															>
																<Button
																	variant="ghost"
																	size="icon"
																	className="group hover:bg-red-500/10"
																	isLoading={isRemoving}
																>
																	<Trash2 className="size-4 text-primary group-hover:text-red-500" />
																</Button>
															</DialogAction>
														)}
													</div>
												</div>
												<div className="w-full break-all">
													<Link
														className="flex items-center gap-2 text-base font-medium hover:underline"
														target="_blank"
														href={`${item.https ? "https" : "http"}://${item.host}${item.path}`}
													>
														{item.host}
														<ExternalLink className="size-4 min-w-4" />
													</Link>
												</div>

												{/* Domain Details */}
												<div className="flex flex-wrap gap-3">
													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<Badge variant="secondary">
																	<InfoIcon className="size-3 mr-1" />
																	Path: {item.path || "/"}
																</Badge>
															</TooltipTrigger>
															<TooltipContent>
																<p>URL path for this service</p>
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>

													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<Badge variant="secondary">
																	<InfoIcon className="size-3 mr-1" />
																	Port: {item.port}
																</Badge>
															</TooltipTrigger>
															<TooltipContent>
																<p>Container port exposed</p>
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>

													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<Badge
																	variant={item.https ? "outline" : "secondary"}
																>
																	{item.https ? "HTTPS" : "HTTP"}
																</Badge>
															</TooltipTrigger>
															<TooltipContent>
																<p>
																	{item.https
																		? "Secure HTTPS connection"
																		: "Standard HTTP connection"}
																</p>
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>

													{item.certificateType && (
														<TooltipProvider>
															<Tooltip>
																<TooltipTrigger asChild>
																	<Badge variant="outline">
																		Cert: {item.certificateType}
																	</Badge>
																</TooltipTrigger>
																<TooltipContent>
																	<p>SSL Certificate Provider</p>
																</TooltipContent>
															</Tooltip>
														</TooltipProvider>
													)}

													{item.middlewares?.map((middleware, index) => (
														<TooltipProvider key={`${middleware}-${index}`}>
															<Tooltip>
																<TooltipTrigger asChild>
																	<Badge variant="secondary">
																		<InfoIcon className="size-3 mr-1" />
																		Middleware: {middleware}
																	</Badge>
																</TooltipTrigger>
																<TooltipContent>
																	<p>Traefik middleware reference</p>
																</TooltipContent>
															</Tooltip>
														</TooltipProvider>
													))}

													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<Badge
																	variant="outline"
																	className={
																		validationState?.isValid
																			? "bg-green-500/10 text-green-500 cursor-pointer"
																			: validationState?.error
																				? "bg-red-500/10 text-red-500 cursor-pointer"
																				: "bg-yellow-500/10 text-yellow-500 cursor-pointer"
																	}
																	onClick={() =>
																		handleValidateDomain(item.host)
																	}
																>
																	{validationState?.isLoading ? (
																		<>
																			<Loader2 className="size-3 mr-1 animate-spin" />
																			Checking DNS...
																		</>
																	) : validationState?.isValid ? (
																		<>
																			<CheckCircle2 className="size-3 mr-1" />
																			{validationState.message &&
																			validationState.cdnProvider
																				? `Behind ${validationState.cdnProvider}`
																				: "DNS Valid"}
																		</>
																	) : validationState?.error ? (
																		<>
																			<XCircle className="size-3 mr-1" />
																			{validationState.error}
																		</>
																	) : (
																		<>
																			<RefreshCw className="size-3 mr-1" />
																			Validate DNS
																		</>
																	)}
																</Badge>
															</TooltipTrigger>
															<TooltipContent className="max-w-xs">
																{validationState?.isValid &&
																validationState?.message ? (
																	<p>{validationState.message}</p>
																) : validationState?.error ? (
																	<div className="flex flex-col gap-1">
																		<p className="font-medium text-red-500">
																			Error:
																		</p>
																		<p>{validationState.error}</p>
																	</div>
																) : (
																	"Click to validate DNS configuration"
																)}
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>
												</div>

												{!item.host.includes("traefik.me") &&
												item.dnsProvider !== "cloudflare" ? (
													<DomainConnectionPanel domainId={item.domainId} />
												) : null}

												{!item.host.includes("traefik.me") ? (
													<CloudflareDomainControls
														domainId={item.domainId}
														currentDnsProvider={item.dnsProvider}
														currentProxied={
															item.cfProxied ?? true
														}
													/>
												) : null}
											</div>
										</CardContent>
									</Card>
								);
							})}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
};
