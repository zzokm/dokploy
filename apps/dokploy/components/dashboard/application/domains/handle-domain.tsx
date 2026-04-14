import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { Cloud, DatabaseZap, Dices, Globe, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import z from "zod";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form"
import { Input, NumberInput } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";

export type CacheType = "fetch" | "cache";

type HostInputMode = "manual" | "cloudflare"

const buildHostFromCloudflareZone = (zoneName: string, subdomain: string) => {
	const zone = zoneName.trim().toLowerCase()
	const raw = subdomain.trim().toLowerCase()
	if (!raw || raw === "@" || raw === zone) {
		return zone
	}
	const cleaned = raw.replace(/\.$/, "").replace(new RegExp(`\\.${zone.replace(/\./g, "\\.")}$`), "")
	if (!cleaned) {
		return zone
	}
	return `${cleaned}.${zone}`
}

export const domain = z
	.object({
		host: z
			.string()
			.min(1, { message: "Add a hostname" })
			.refine((val) => val === val.trim(), {
				message: "Domain name cannot have leading or trailing spaces",
			})
			.transform((val) => val.trim()),
		path: z.string().min(1).optional(),
		internalPath: z.string().optional(),
		stripPath: z.boolean().optional(),
		port: z
			.number()
			.min(1, { message: "Port must be at least 1" })
			.max(65535, { message: "Port must be 65535 or below" })
			.optional(),
		https: z.boolean().optional(),
		certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
		customCertResolver: z.string().optional(),
		serviceName: z.string().optional(),
		domainType: z.enum(["application", "compose", "preview"]).optional(),
	})
	.superRefine((input, ctx) => {
		if (input.https && !input.certificateType) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["certificateType"],
				message: "Required",
			});
		}

		if (input.certificateType === "custom" && !input.customCertResolver) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["customCertResolver"],
				message: "Required",
			});
		}

		if (input.domainType === "compose" && !input.serviceName) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["serviceName"],
				message: "Required",
			});
		}

		// Validate stripPath requires a valid path
		if (input.stripPath && (!input.path || input.path === "/")) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["stripPath"],
				message:
					"Strip path can only be enabled when a path other than '/' is specified",
			});
		}

		// Validate internalPath starts with /
		if (
			input.internalPath &&
			input.internalPath !== "/" &&
			!input.internalPath.startsWith("/")
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["internalPath"],
				message: "Internal path must start with '/'",
			});
		}
	});

type Domain = z.infer<typeof domain>;

interface Props {
	id: string;
	type: "application" | "compose";
	domainId?: string;
	children: React.ReactNode;
}

export const AddDomain = ({ id, type, domainId = "", children }: Props) => {
	const [isOpen, setIsOpen] = useState(false);
	const [cacheType, setCacheType] = useState<CacheType>("cache");
	const [isManualInput, setIsManualInput] = useState(false);
	const [hostInputMode, setHostInputMode] = useState<HostInputMode>("manual");
	const [selectedCfZoneId, setSelectedCfZoneId] = useState("");
	const [subdomainLabel, setSubdomainLabel] = useState("");
	const [cfProxiedOnCreate, setCfProxiedOnCreate] = useState(true);

	const utils = api.useUtils();
	const { data: cfSettings } = api.cloudflareSettings.get.useQuery(undefined, {
		enabled: isOpen,
	});
	const { data: cfZones } = api.cloudflareSettings.listZones.useQuery(undefined, {
		enabled: isOpen && !!cfSettings?.connected && hostInputMode === "cloudflare",
	});
	const { data, refetch } = api.domain.one.useQuery(
		{
			domainId,
		},
		{
			enabled: !!domainId,
		},
	);

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

	const { mutateAsync, isError, error, isPending } = domainId
		? api.domain.update.useMutation()
		: api.domain.create.useMutation();

	const { mutateAsync: generateDomain, isPending: isLoadingGenerate } =
		api.domain.generateDomain.useMutation();

	const { data: canGenerateTraefikMeDomains } =
		api.domain.canGenerateTraefikMeDomains.useQuery({
			serverId: application?.serverId || "",
		});

	const {
		data: services,
		isFetching: isLoadingServices,
		error: errorServices,
		refetch: refetchServices,
	} = api.compose.loadServices.useQuery(
		{
			composeId: id,
			type: cacheType,
		},
		{
			retry: false,
			refetchOnWindowFocus: false,
			enabled: type === "compose" && !!id,
		},
	);

	const form = useForm<Domain>({
		resolver: zodResolver(domain),
		defaultValues: {
			host: "",
			path: undefined,
			internalPath: undefined,
			stripPath: false,
			port: undefined,
			https: false,
			certificateType: undefined,
			customCertResolver: undefined,
			serviceName: undefined,
			domainType: type,
		},
		mode: "onChange",
	});

	const certificateType = form.watch("certificateType");
	const https = form.watch("https");
	const domainType = form.watch("domainType");
	const host = form.watch("host");
	const isTraefikMeDomain = host?.includes("traefik.me") || false;

	const enabledCfZones =
		cfZones?.filter((z) => z.status !== "disabled" && !z.paused) ?? []

	const selectedZone = enabledCfZones.find((z) => z.cfZoneId === selectedCfZoneId)

	useEffect(() => {
		if (!isOpen || domainId) {
			return
		}
		if (hostInputMode !== "cloudflare" || !selectedZone) {
			return
		}
		form.setValue(
			"host",
			buildHostFromCloudflareZone(selectedZone.name, subdomainLabel),
		)
	}, [
		isOpen,
		domainId,
		hostInputMode,
		selectedZone,
		subdomainLabel,
		form,
	])

	useEffect(() => {
		if (!isOpen || domainId) {
			return
		}
		setHostInputMode("manual")
		setSelectedCfZoneId("")
		setSubdomainLabel("")
		setCfProxiedOnCreate(true)
	}, [isOpen, domainId])

	useEffect(() => {
		if (!domainId && hostInputMode === "cloudflare") {
			form.setValue("https", true)
			form.setValue("certificateType", "letsencrypt")
		}
	}, [domainId, hostInputMode, form])

	useEffect(() => {
		if (data) {
			form.reset({
				...data,
				/* Convert null to undefined */
				path: data?.path || undefined,
				internalPath: data?.internalPath || undefined,
				stripPath: data?.stripPath || false,
				port: data?.port || undefined,
				certificateType: data?.certificateType || undefined,
				customCertResolver: data?.customCertResolver || undefined,
				serviceName: data?.serviceName || undefined,
				domainType: data?.domainType || type,
			});
		}

		if (!domainId) {
			form.reset({
				host: "",
				path: undefined,
				internalPath: undefined,
				stripPath: false,
				port: undefined,
				https: false,
				certificateType: undefined,
				customCertResolver: undefined,
				domainType: type,
			});
		}
	}, [form, data, isPending, domainId]);

	// Separate effect for handling custom cert resolver validation
	useEffect(() => {
		if (certificateType === "custom") {
			form.trigger("customCertResolver");
		}
	}, [certificateType, form]);

	const dictionary = {
		success: domainId ? "Domain Updated" : "Domain Created",
		error: domainId ? "Error updating the domain" : "Error creating the domain",
		submit: domainId ? "Update" : "Create",
		dialogDescription: domainId
			? "In this section you can edit a domain"
			: "In this section you can add domains",
	};

	const onSubmit = async (data: Domain) => {
		let finalHost = data.host
		if (!domainId && hostInputMode === "cloudflare") {
			if (!cfSettings?.connected) {
				toast.error("Connect Cloudflare under Domains first")
				return
			}
			if (!selectedZone) {
				toast.error("Select a Cloudflare zone")
				return
			}
			const sub = subdomainLabel.trim()
			if (sub && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(sub)) {
				toast.error("Use letters, numbers, hyphens, and dots only for the hostname prefix")
				return
			}
			finalHost = buildHostFromCloudflareZone(selectedZone.name, sub)
		}

		const isCloudflareCreate = !domainId && hostInputMode === "cloudflare"

		await mutateAsync({
			domainId,
			...(data.domainType === "application" && {
				applicationId: id,
			}),
			...(data.domainType === "compose" && {
				composeId: id,
			}),
			...data,
			host: finalHost,
			...(isCloudflareCreate
				? {
						dnsProvider: "cloudflare" as const,
						cfProxied: cfProxiedOnCreate,
						cloudflareProxied: cfProxiedOnCreate,
						https: true,
						certificateType: "letsencrypt" as const,
						customCertResolver: undefined,
					}
				: !domainId
					? {
							dnsProvider: "none" as const,
						}
					: {}),
		})
			.then(async () => {
				toast.success(dictionary.success);

				if (data.domainType === "application") {
					await utils.domain.byApplicationId.invalidate({
						applicationId: id,
					});
					await utils.application.readTraefikConfig.invalidate({
						applicationId: id,
					});
				} else if (data.domainType === "compose") {
					await utils.domain.byComposeId.invalidate({
						composeId: id,
					});
				}

				if (domainId) {
					refetch();
				}
				setIsOpen(false);
			})
			.catch((e) => {
				console.log(e);
				toast.error(dictionary.error);
			});
	};
	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger className="" asChild>
				{children}
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-xl">
						<Globe className="size-5 text-muted-foreground shrink-0" aria-hidden />
						Domain
					</DialogTitle>
					<DialogDescription>{dictionary.dialogDescription}</DialogDescription>
				</DialogHeader>
				{isError && <AlertBlock type="error">{error?.message}</AlertBlock>}

				{type === "compose" && (
					<AlertBlock type="info" className="mb-4">
						Whenever you make changes to domains, remember to redeploy your
						compose to apply the changes.
					</AlertBlock>
				)}

				{!domainId && (
					<div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3 mb-2">
						<div className="text-sm font-medium">Hostname</div>
						<Select
							value={hostInputMode}
							onValueChange={(v) => {
								const next = v as HostInputMode
								setHostInputMode(next)
								if (next === "manual") {
									form.setValue("host", "")
								}
							}}
						>
							<SelectTrigger aria-label="How to enter hostname">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="manual">Custom hostname (full domain)</SelectItem>
								<SelectItem value="cloudflare">
									Cloudflare zone (managed DNS and SSL)
								</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							{hostInputMode === "cloudflare"
								? "Pick a synced zone and a label (e.g. app → app.example.com). DNS and certificates are handled for you."
								: "Enter any hostname. You can use Cloudflare or another DNS provider yourself."}
						</p>
					</div>
				)}

				<Form {...form}>
					<form
						id="hook-form"
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-8 "
					>
						<div className="flex flex-col gap-4">
							<div className="flex flex-col gap-2">
								<div className="flex flex-row items-end w-full gap-4">
									{domainType === "compose" && (
										<div className="flex flex-col gap-2 w-full">
											{errorServices && (
												<AlertBlock
													type="warning"
													className="[overflow-wrap:anywhere]"
												>
													{errorServices?.message}
												</AlertBlock>
											)}
											<FormField
												control={form.control}
												name="serviceName"
												render={({ field }) => (
													<FormItem className="w-full">
														<FormLabel>Service Name</FormLabel>
														<div className="flex gap-2">
															{isManualInput ? (
																<FormControl>
																	<Input
																		placeholder="Enter service name manually"
																		{...field}
																		className="w-full"
																	/>
																</FormControl>
															) : (
																<Select
																	onValueChange={field.onChange}
																	defaultValue={field.value || ""}
																>
																	<FormControl>
																		<SelectTrigger>
																			<SelectValue placeholder="Select a service name" />
																		</SelectTrigger>
																	</FormControl>

																	<SelectContent>
																		{services?.map((service, index) => (
																			<SelectItem
																				value={service}
																				key={`${service}-${index}`}
																			>
																				{service}
																			</SelectItem>
																		))}
																		<SelectItem value="none" disabled>
																			Empty
																		</SelectItem>
																	</SelectContent>
																</Select>
															)}
															{!isManualInput && (
																<>
																	<TooltipProvider delayDuration={0}>
																		<Tooltip>
																			<TooltipTrigger asChild>
																				<Button
																					variant="secondary"
																					type="button"
																					isLoading={isLoadingServices}
																					onClick={() => {
																						if (cacheType === "fetch") {
																							refetchServices();
																						} else {
																							setCacheType("fetch");
																						}
																					}}
																				>
																					<RefreshCw className="size-4 text-muted-foreground" />
																				</Button>
																			</TooltipTrigger>
																			<TooltipContent
																				side="left"
																				sideOffset={5}
																				className="max-w-[10rem]"
																			>
																				<p>
																					Fetch: Will clone the repository and
																					load the services
																				</p>
																			</TooltipContent>
																		</Tooltip>
																	</TooltipProvider>
																	<TooltipProvider delayDuration={0}>
																		<Tooltip>
																			<TooltipTrigger asChild>
																				<Button
																					variant="secondary"
																					type="button"
																					isLoading={isLoadingServices}
																					onClick={() => {
																						if (cacheType === "cache") {
																							refetchServices();
																						} else {
																							setCacheType("cache");
																						}
																					}}
																				>
																					<DatabaseZap className="size-4 text-muted-foreground" />
																				</Button>
																			</TooltipTrigger>
																			<TooltipContent
																				side="left"
																				sideOffset={5}
																				className="max-w-[10rem]"
																			>
																				<p>
																					Cache: If you previously deployed this
																					compose, it will read the services
																					from the last deployment/fetch from
																					the repository
																				</p>
																			</TooltipContent>
																		</Tooltip>
																	</TooltipProvider>
																</>
															)}
															<TooltipProvider delayDuration={0}>
																<Tooltip>
																	<TooltipTrigger asChild>
																		<Button
																			variant="secondary"
																			type="button"
																			onClick={() => {
																				setIsManualInput(!isManualInput);
																				if (!isManualInput) {
																					field.onChange("");
																				}
																			}}
																		>
																			{isManualInput ? (
																				<RefreshCw className="size-4 text-muted-foreground" />
																			) : (
																				<span className="text-xs text-muted-foreground">
																					Manual
																				</span>
																			)}
																		</Button>
																	</TooltipTrigger>
																	<TooltipContent
																		side="left"
																		sideOffset={5}
																		className="max-w-[10rem]"
																	>
																		<p>
																			{isManualInput
																				? "Switch to service selection"
																				: "Enter service name manually"}
																		</p>
																	</TooltipContent>
																</Tooltip>
															</TooltipProvider>
														</div>

														<FormMessage />
													</FormItem>
												)}
											/>
										</div>
									)}
								</div>
								{!domainId && hostInputMode === "cloudflare" ? (
									<div className="space-y-3">
										{!cfSettings?.connected ? (
											<AlertBlock type="warning">
												Connect your Cloudflare API token on the{" "}
												<Link href="/dashboard/domains" className="text-primary underline">
													Domains
												</Link>{" "}
												page, then sync zones.
											</AlertBlock>
										) : null}
										<div className="space-y-2">
											<div className="text-sm font-medium flex items-center gap-2">
												<Cloud className="size-4 text-muted-foreground" aria-hidden />
												Cloudflare zone
											</div>
											<Select
												value={selectedCfZoneId}
												onValueChange={setSelectedCfZoneId}
												disabled={!enabledCfZones.length}
											>
												<SelectTrigger aria-label="Cloudflare zone">
													<SelectValue placeholder="Select a zone" />
												</SelectTrigger>
												<SelectContent>
													{enabledCfZones.map((z) => (
														<SelectItem key={z.cfZoneId} value={z.cfZoneId}>
															{z.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											{!enabledCfZones.length && cfSettings?.connected ? (
												<p className="text-xs text-muted-foreground">
													No zones yet. Open Domains and click Sync now.
												</p>
											) : null}
										</div>
										<div className="space-y-2">
											<div className="text-sm font-medium">Hostname</div>
											<div className="flex flex-col sm:flex-row sm:items-center gap-2">
												<Input
													placeholder="app or www"
													value={subdomainLabel}
													onChange={(e) => setSubdomainLabel(e.target.value)}
													aria-label="Subdomain or hostname prefix"
													disabled={!selectedCfZoneId}
													className="sm:max-w-[240px]"
												/>
												<span className="text-sm text-muted-foreground font-mono sm:pt-0">
													{selectedZone ? `.${selectedZone.name}` : ".your-zone.com"}
												</span>
											</div>
											<p className="text-xs text-muted-foreground">
												Leave empty for the zone apex ({selectedZone?.name ?? "example.com"}).
												Traefik routes by Host header; your container port is set below.
											</p>
										</div>
										<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 border border-border rounded-xl bg-background/80">
											<div className="space-y-0.5 min-w-0">
												<FormLabel>Cloudflare proxy (orange cloud)</FormLabel>
												<FormDescription>
													Recommended. Traffic hits your server on 80/443; Traefik forwards to
													the container port you configure.
												</FormDescription>
											</div>
											<Switch
												checked={cfProxiedOnCreate}
												onCheckedChange={setCfProxiedOnCreate}
												aria-label="Cloudflare proxy enabled"
												className="shrink-0"
											/>
										</div>
										<FormField
											control={form.control}
											name="host"
											render={({ field }) => (
												<FormItem className="hidden">
													<FormControl>
														<Input type="hidden" {...field} />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										{selectedZone ? (
											<div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm font-mono break-all">
												{host}
											</div>
										) : null}
									</div>
								) : (
								<FormField
									control={form.control}
									name="host"
									render={({ field }) => (
										<FormItem>
											{!canGenerateTraefikMeDomains &&
												field.value.includes("traefik.me") && (
													<AlertBlock type="warning">
														You need to set an IP address in your{" "}
														<Link
															href="/dashboard/settings/server"
															className="text-primary"
														>
															{application?.serverId
																? "Remote Servers -> Server -> Edit Server -> Update IP Address"
																: "Web Server -> Server -> Update Server IP"}
														</Link>{" "}
														to make your traefik.me domain work.
													</AlertBlock>
												)}
											{isTraefikMeDomain && (
												<AlertBlock type="info">
													<strong>Note:</strong> traefik.me is a public HTTP
													service and does not support SSL/HTTPS. HTTPS and
													certificate options will not have any effect.
												</AlertBlock>
											)}
											<FormLabel>Host</FormLabel>
											<div className="flex gap-2">
												<FormControl>
													<Input placeholder="api.dokploy.com" {...field} />
												</FormControl>
												<TooltipProvider delayDuration={0}>
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																variant="secondary"
																type="button"
																isLoading={isLoadingGenerate}
																onClick={() => {
																	generateDomain({
																		appName: application?.appName || "",
																		serverId: application?.serverId || "",
																	})
																		.then((domain) => {
																			field.onChange(domain);
																		})
																		.catch((err) => {
																			toast.error(err.message);
																		});
																}}
															>
																<Dices className="size-4 text-muted-foreground" />
															</Button>
														</TooltipTrigger>
														<TooltipContent
															side="left"
															sideOffset={5}
															className="max-w-[10rem]"
														>
															<p>Generate traefik.me domain</p>
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											</div>

											<FormMessage />
										</FormItem>
									)}
								/>
								)}

								<FormField
									control={form.control}
									name="path"
									render={({ field }) => {
										return (
											<FormItem>
												<FormLabel>Path</FormLabel>
												<FormControl>
													<Input placeholder={"/"} {...field} />
												</FormControl>
												<FormMessage />
											</FormItem>
										);
									}}
								/>

								<FormField
									control={form.control}
									name="internalPath"
									render={({ field }) => {
										return (
											<FormItem>
												<FormLabel>Internal Path</FormLabel>
												<FormDescription>
													The path where your application expects to receive
													requests internally (defaults to "/")
												</FormDescription>
												<FormControl>
													<Input placeholder={"/"} {...field} />
												</FormControl>
												<FormMessage />
											</FormItem>
										);
									}}
								/>

								<FormField
									control={form.control}
									name="stripPath"
									render={({ field }) => (
										<FormItem className="flex flex-row items-center justify-between p-3 border rounded-lg shadow-sm">
											<div className="space-y-0.5">
												<FormLabel>Strip Path</FormLabel>
												<FormDescription>
													Remove the external path from the request before
													forwarding to the application
												</FormDescription>
												<FormMessage />
											</div>
											<FormControl>
												<Switch
													checked={field.value}
													onCheckedChange={field.onChange}
												/>
											</FormControl>
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="port"
									render={({ field }) => {
										return (
											<FormItem>
												<FormLabel>Container Port</FormLabel>
												<FormDescription>
													The port where your application is running inside the
													container (e.g., 3000 for Node.js, 80 for Nginx, 8080
													for Java)
												</FormDescription>
												<FormControl>
													<NumberInput placeholder={"3000"} {...field} />
												</FormControl>
												<FormMessage />
											</FormItem>
										);
									}}
								/>

								{!(!domainId && hostInputMode === "cloudflare") ? (
								<FormField
									control={form.control}
									name="https"
									render={({ field }) => (
										<FormItem className="flex flex-row items-center justify-between p-3 mt-4 border rounded-lg shadow-sm">
											<div className="space-y-0.5">
												<FormLabel>HTTPS</FormLabel>
												<FormDescription>
													Automatically provision SSL Certificate.
												</FormDescription>
												<FormMessage />
											</div>
											<FormControl>
												<Switch
													checked={field.value}
													onCheckedChange={field.onChange}
												/>
											</FormControl>
										</FormItem>
									)}
								/>
								) : null}

								{https && !(!domainId && hostInputMode === "cloudflare") && (
									<>
										<FormField
											control={form.control}
											name="certificateType"
											render={({ field }) => {
												return (
													<FormItem>
														<FormLabel>Certificate Provider</FormLabel>
														<Select
															onValueChange={(value) => {
																field.onChange(value);
																if (value !== "custom") {
																	form.setValue(
																		"customCertResolver",
																		undefined,
																	);
																}
															}}
															value={field.value}
														>
															<FormControl>
																<SelectTrigger>
																	<SelectValue placeholder="Select a certificate provider" />
																</SelectTrigger>
															</FormControl>
															<SelectContent>
																<SelectItem value={"none"}>None</SelectItem>
																<SelectItem value={"letsencrypt"}>
																	Let's Encrypt
																</SelectItem>
																<SelectItem value={"custom"}>Custom</SelectItem>
															</SelectContent>
														</Select>
														<FormMessage />
													</FormItem>
												);
											}}
										/>

										{certificateType === "custom" && (
											<FormField
												control={form.control}
												name="customCertResolver"
												render={({ field }) => {
													return (
														<FormItem>
															<FormLabel>Custom Certificate Resolver</FormLabel>
															<FormControl>
																<Input
																	className="w-full"
																	placeholder="Enter your custom certificate resolver"
																	{...field}
																	value={field.value || ""}
																	onChange={(e) => {
																		field.onChange(e);
																		form.trigger("customCertResolver");
																	}}
																/>
															</FormControl>
															<FormMessage />
														</FormItem>
													);
												}}
											/>
										)}
									</>
								)}
							</div>
						</div>
					</form>

					<DialogFooter>
						<Button isLoading={isPending} form="hook-form" type="submit">
							{dictionary.submit}
						</Button>
					</DialogFooter>
				</Form>
			</DialogContent>
		</Dialog>
	);
};
