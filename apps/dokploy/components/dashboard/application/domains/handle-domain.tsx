import {
	INVALID_HOSTNAME_MESSAGE,
	VALID_HOSTNAME_REGEX,
} from "@dokploy/server/utils/hostname-validation";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { DatabaseZap, Dices, Globe, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import z from "zod";
import { CloudflareDomainControls } from "@/components/dashboard/application/domains/dns-domain-controls";
import {
	type DomainPortHints,
	deriveDomainPortGuidance,
	suggestDomainPort,
} from "@/components/dashboard/application/domains/domain-port-guidance";
import { CloudflareHostnameLabelField } from "@/components/dashboard/domains/dns-hostname-label-field";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/form";
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
import { COMPOSE_REDEPLOY_TOAST, ComposeRedeployAlert } from "./redeploy-hint";

export type CacheType = "fetch" | "cache";

type HostInputMode = "manual" | "cloudflare";

const buildHostFromCloudflareZone = (zoneName: string, subdomain: string) => {
	const zone = zoneName.trim().toLowerCase();
	const raw = subdomain.trim().toLowerCase();
	if (!raw || raw === "@" || raw === zone) {
		return zone;
	}
	const cleaned = raw
		.replace(/\.$/, "")
		.replace(new RegExp(`\\.${zone.replace(/\./g, "\\.")}$`), "");
	if (!cleaned) {
		return zone;
	}
	return `${cleaned}.${zone}`;
};

export const domain = z
	.object({
		host: z
			.string()
			.min(1, { message: "Add a hostname" })
			.refine((val) => val === val.trim(), {
				message: "Domain name cannot have leading or trailing spaces",
			})
			.transform((val) => val.trim())
			.refine((val) => VALID_HOSTNAME_REGEX.test(val), {
				message: INVALID_HOSTNAME_MESSAGE,
			}),
		path: z.string().min(1).optional(),
		internalPath: z.string().optional(),
		stripPath: z.boolean().optional(),
		port: z
			.number()
			.min(1, { message: "Port must be at least 1" })
			.max(65535, { message: "Port must be 65535 or below" })
			.optional(),
		useCustomEntrypoint: z.boolean(),
		customEntrypoint: z.string().optional(),
		https: z.boolean().optional(),
		certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
		customCertResolver: z.string().optional(),
		serviceName: z.string().optional(),
		domainType: z.enum(["application", "compose", "preview"]).optional(),
		middlewares: z.array(z.string()).optional(),
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

		if (input.useCustomEntrypoint && !input.customEntrypoint) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["customEntrypoint"],
				message: "Custom entry point must be specified",
			});
		}
	});

type Domain = z.infer<typeof domain>;

interface Props {
	id: string;
	type: "application" | "compose";
	domainId?: string;
	children: React.ReactNode;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Fired after a successful save so the parent can prompt to apply routing. */
	onSaved?: () => void;
	/** Prefill hostname when opening create flow (e.g. Attach from inventory). */
	initialHost?: string;
	/** Prefill compose serviceName when attaching. */
	initialServiceName?: string;
}

export const AddDomain = ({
	id,
	type,
	domainId = "",
	children,
	defaultOpen = false,
	onOpenChange,
	onSaved,
	initialHost = "",
	initialServiceName = "",
}: Props) => {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	const [cacheType, setCacheType] = useState<CacheType>("cache");
	const [isManualInput, setIsManualInput] = useState(false);
	const [hostInputMode, setHostInputMode] = useState<HostInputMode>("manual");
	const [selectedCfZoneId, setSelectedCfZoneId] = useState("");
	const [subdomainLabel, setSubdomainLabel] = useState("");

	const utils = api.useUtils();
	const { data: cfSettings } = api.cloudflareSettings.get.useQuery(undefined, {
		enabled: isOpen,
	});
	const { data: cfZones } = api.cloudflareSettings.listZones.useQuery(
		undefined,
		{
			enabled:
				isOpen && !!cfSettings?.connected && hostInputMode === "cloudflare",
		},
	);
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

	const applicationPorts =
		type === "application" && application && "ports" in application
			? application.ports
			: [];

	const form = useForm<Domain>({
		resolver: zodResolver(domain),
		defaultValues: {
			host: initialHost.trim(),
			path: undefined,
			internalPath: undefined,
			stripPath: false,
			port: undefined,
			useCustomEntrypoint: false,
			customEntrypoint: undefined,
			https: false,
			certificateType: undefined,
			customCertResolver: undefined,
			serviceName: initialServiceName.trim() || undefined,
			domainType: type,
			middlewares: [],
		},
		mode: "onChange",
	});

	const certificateType = form.watch("certificateType");
	const useCustomEntrypoint = form.watch("useCustomEntrypoint");
	const https = form.watch("https");
	const domainType = form.watch("domainType");
	const host = form.watch("host");
	const serviceName = form.watch("serviceName");
	const portValue = form.watch("port");
	const isTraefikMeDomain = host?.includes("sslip.io") || false;

	const { data: composePortHints } = api.compose.loadServicePorts.useQuery(
		{
			composeId: id,
			serviceName: serviceName ?? "",
			type: "cache",
		},
		{
			retry: false,
			refetchOnWindowFocus: false,
			enabled: type === "compose" && !!id && !!serviceName,
		},
	);

	const portHints: DomainPortHints | null =
		type === "compose"
			? (composePortHints ?? null)
			: applicationPorts.length
				? {
						containerPorts: applicationPorts.map((p) => p.targetPort),
						hostPublishedPorts: applicationPorts.map((p) => p.publishedPort),
					}
				: null;

	const portGuidance = deriveDomainPortGuidance({
		port: portValue ?? null,
		hints: portHints,
	});
	const suggestedPort = suggestDomainPort(portHints);
	const cloudflareHostnamePlaceholder = `@ or ${serviceName?.trim() || "api"}`;

	const hideHttpsForCloudflareAutomation =
		!domainId &&
		(hostInputMode === "cloudflare" ||
			(hostInputMode === "manual" &&
				!!cfSettings?.connected &&
				!isTraefikMeDomain));

	const enabledCfZones =
		cfZones?.filter((z) => z.status !== "disabled" && !z.paused) ?? [];

	const selectedZone = enabledCfZones.find(
		(z) => z.cfZoneId === selectedCfZoneId,
	);

	useEffect(() => {
		if (!isOpen || domainId) {
			return;
		}
		if (hostInputMode !== "cloudflare" || !selectedZone) {
			return;
		}
		form.setValue(
			"host",
			buildHostFromCloudflareZone(selectedZone.name, subdomainLabel),
		);
	}, [isOpen, domainId, hostInputMode, selectedZone, subdomainLabel, form]);

	useEffect(() => {
		if (!isOpen || domainId) {
			return;
		}
		const prefill = initialHost.trim().toLowerCase().replace(/\.$/, "");
		const zones =
			cfZones?.filter((z) => z.status !== "disabled" && !z.paused) ?? [];
		if (prefill && cfSettings?.connected && zones.length) {
			const zone = zones
				.slice()
				.sort((a, b) => b.name.length - a.name.length)
				.find(
					(z) =>
						prefill === z.name.toLowerCase() ||
						prefill.endsWith(`.${z.name.toLowerCase()}`),
				);
			if (zone) {
				const zoneName = zone.name.toLowerCase();
				const label =
					prefill === zoneName
						? "@"
						: prefill.slice(0, -(zoneName.length + 1));
				setHostInputMode("cloudflare");
				setSelectedCfZoneId(zone.cfZoneId);
				setSubdomainLabel(label);
				form.setValue("host", prefill);
				form.setValue("https", true);
				form.setValue("certificateType", "letsencrypt");
				if (initialServiceName.trim()) {
					form.setValue("serviceName", initialServiceName.trim());
				}
				return;
			}
		}
		setHostInputMode("manual");
		setSelectedCfZoneId("");
		setSubdomainLabel("");
		if (prefill) {
			form.setValue("host", prefill);
		}
		if (initialServiceName.trim()) {
			form.setValue("serviceName", initialServiceName.trim());
		}
	}, [
		isOpen,
		domainId,
		initialHost,
		initialServiceName,
		cfSettings?.connected,
		cfZones,
		form,
	]);

	useEffect(() => {
		if (!domainId && hostInputMode === "cloudflare") {
			form.setValue("https", true);
			form.setValue("certificateType", "letsencrypt");
		}
		if (
			!domainId &&
			hostInputMode === "manual" &&
			cfSettings?.connected &&
			!isTraefikMeDomain
		) {
			form.setValue("https", true);
			form.setValue("certificateType", "letsencrypt");
		}
	}, [domainId, hostInputMode, cfSettings?.connected, isTraefikMeDomain, form]);

	useEffect(() => {
		if (data) {
			form.reset({
				...data,
				/* Convert null to undefined */
				path: data?.path || undefined,
				internalPath: data?.internalPath || undefined,
				stripPath: data?.stripPath || false,
				port: data?.port || undefined,
				useCustomEntrypoint: !!data.customEntrypoint,
				customEntrypoint: data.customEntrypoint || undefined,
				certificateType: data?.certificateType || undefined,
				customCertResolver: data?.customCertResolver || undefined,
				serviceName: data?.serviceName || undefined,
				domainType: data?.domainType || type,
				middlewares: data?.middlewares || [],
			});
			// Restore managed-DNS mode from persisted dnsProvider on edit.
			if (domainId && data.dnsProvider && data.dnsProvider !== "none") {
				setHostInputMode("cloudflare");
			} else if (domainId) {
				setHostInputMode("manual");
			}
		}

		if (!domainId) {
			form.reset({
				host: initialHost.trim(),
				path: undefined,
				internalPath: undefined,
				stripPath: false,
				port: undefined,
				useCustomEntrypoint: false,
				customEntrypoint: undefined,
				https: false,
				certificateType: undefined,
				customCertResolver: undefined,
				serviceName: initialServiceName.trim() || undefined,
				domainType: type,
				middlewares: [],
			});
		}
	}, [form, data, isPending, domainId, initialHost, initialServiceName, type]);

	// Separate effect for handling custom cert resolver validation
	useEffect(() => {
		if (certificateType === "custom") {
			form.trigger("customCertResolver");
		}
	}, [certificateType, form]);

	// Default to the port the service actually listens on, so the user never has
	// to guess (and never reaches for the host publish port).
	useEffect(() => {
		if (suggestedPort == null) return;
		if (form.getValues("port") != null) return;
		form.setValue("port", suggestedPort, { shouldValidate: true });
	}, [suggestedPort, form]);

	const dictionary = {
		success: domainId ? "Domain Updated" : "Domain Created",
		error: domainId ? "Error updating the domain" : "Error creating the domain",
		submit: domainId ? "Update" : "Create",
		dialogDescription: domainId
			? "In this section you can edit a domain"
			: "In this section you can add domains",
	};

	const onSubmit = async (data: Domain) => {
		let finalHost = data.host;
		if (!domainId && hostInputMode === "cloudflare") {
			if (!cfSettings?.connected) {
				toast.error("Connect Cloudflare under Domains first");
				return;
			}
			if (!selectedZone) {
				toast.error("Select a Cloudflare domain");
				return;
			}
			const sub = subdomainLabel.trim();
			if (sub && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(sub)) {
				toast.error(
					"Use letters, numbers, hyphens, and dots only for the hostname prefix",
				);
				return;
			}
			finalHost = buildHostFromCloudflareZone(selectedZone.name, sub);
		}

		const traefikMeHost = finalHost.includes("traefik.me");
		// Managed DNS is opt-in via the toggle (hostInputMode), not merely CF connected.
		const wantsManagedDns =
			!domainId && !traefikMeHost && hostInputMode === "cloudflare";

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
			customEntrypoint: data.useCustomEntrypoint ? data.customEntrypoint : null,
			...(wantsManagedDns
				? {
						dnsProvider: "cloudflare" as const,
						cfProxied: true,
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
				toast.success(
					dictionary.success,
					data.domainType === "compose"
						? { description: COMPOSE_REDEPLOY_TOAST }
						: undefined,
				);

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
					await utils.domain.one.invalidate({ domainId });
					await refetch();
				}
				onSaved?.();
				setIsOpen(false);
			})
			.catch((e) => {
				console.log(e);
				toast.error(dictionary.error);
			});
	};
	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				setIsOpen(open);
				onOpenChange?.(open);
			}}
		>
			<DialogTrigger className="" asChild>
				{children}
			</DialogTrigger>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-xl">
						<Globe
							className="size-5 shrink-0 text-muted-foreground"
							aria-hidden
						/>
						Domain
					</DialogTitle>
					<DialogDescription className="leading-relaxed">
						{dictionary.dialogDescription}
					</DialogDescription>
				</DialogHeader>
				{isError && <AlertBlock type="error">{error?.message}</AlertBlock>}

				{type === "compose" && <ComposeRedeployAlert className="mb-4" />}

				{!domainId && cfSettings?.connected ? (
					<div className="mb-2 flex flex-row items-center justify-between gap-4 rounded-lg border p-3 shadow-xs">
						<div className="min-w-0 space-y-0.5">
							<p className="text-sm font-medium leading-none">
								Managed DNS domain
							</p>
							<p className="text-xs text-muted-foreground">
								Build the hostname from a synced DNS domain.
							</p>
						</div>
						<Switch
							checked={hostInputMode === "cloudflare"}
							onCheckedChange={(checked) => {
								const next: HostInputMode = checked ? "cloudflare" : "manual";
								setHostInputMode(next);
								if (!checked) {
									form.setValue("host", "");
								}
							}}
							aria-label="Managed DNS domain"
							className="shrink-0"
						/>
					</div>
				) : null}

				{domainId &&
				data &&
				!data.host.includes("traefik.me") &&
				(cfSettings?.connected || data.dnsProvider === "cloudflare") ? (
					<CloudflareDomainControls
						domainId={domainId}
						currentDnsProvider={data.dnsProvider}
						currentProxied={data.cfProxied ?? true}
					/>
				) : null}

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
												<AlertBlock type="warning" className="wrap-anywhere">
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
																				className="max-w-40"
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
																				className="max-w-40"
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
																		className="max-w-40"
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
								{!domainId &&
								hostInputMode === "cloudflare" &&
								cfSettings?.connected ? (
									<div className="animate-in fade-in-0 slide-in-from-bottom-1 space-y-4 duration-300">
										<div className="space-y-2">
											<p className="text-sm font-medium">Domain</p>
											<Select
												value={selectedCfZoneId}
												onValueChange={setSelectedCfZoneId}
												disabled={!enabledCfZones.length}
											>
												<SelectTrigger aria-label="Cloudflare domain">
													<SelectValue placeholder="Select a domain" />
												</SelectTrigger>
												<SelectContent>
													{enabledCfZones.map((z) => (
														<SelectItem key={z.cfZoneId} value={z.cfZoneId}>
															{z.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											{!enabledCfZones.length ? (
												<p className="text-xs text-muted-foreground">
													No domains yet. Open Domains and click Sync domains.
												</p>
											) : null}
										</div>
										<CloudflareHostnameLabelField
											value={subdomainLabel}
											onChange={setSubdomainLabel}
											placeholder={cloudflareHostnamePlaceholder}
											ariaLabel="Subdomain or hostname prefix"
											disabled={!selectedCfZoneId}
											inputClassName="text-sm"
											suffix={
												selectedZone ? `.${selectedZone.name}` : ".domain.com"
											}
										/>
										<FormField
											control={form.control}
											name="host"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Host</FormLabel>
													<FormControl>
														<Input
															className="font-mono"
															{...field}
															readOnly
															disabled
														/>
													</FormControl>
													<FormDescription>
														Filled from the domain and label above.
													</FormDescription>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
								) : (
									<FormField
										control={form.control}
										name="host"
										render={({ field }) => (
											<FormItem>
												{!canGenerateTraefikMeDomains &&
													field.value.includes("sslip.io") && (
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
															to make your sslip.io domain work.
														</AlertBlock>
													)}
												{isTraefikMeDomain && (
													<AlertBlock type="info">
														<strong>Note:</strong> sslip.io is a public HTTP
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
																className="max-w-40"
															>
																<p>Generate sslip.io domain</p>
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
										<FormItem className="flex flex-row items-center justify-between p-3 border rounded-lg shadow-xs">
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
													The port your app listens on <em>inside</em> the
													container â€” not a host publish port. Traefik reaches
													the container over <code>dokploy-network</code>.
												</FormDescription>
												<FormControl>
													<NumberInput placeholder={"3000"} {...field} />
												</FormControl>
												{portGuidance ? (
													<AlertBlock
														type={
															portGuidance.kind === "host_publish"
																? "warning"
																: "info"
														}
													>
														{portGuidance.message}
													</AlertBlock>
												) : null}
												<FormMessage />
											</FormItem>
										);
									}}
								/>

								{!hideHttpsForCloudflareAutomation ? (
									<>
										<FormField
											control={form.control}
											name="useCustomEntrypoint"
											render={({ field }) => (
												<FormItem className="flex flex-row items-center justify-between p-3 mt-4 border rounded-lg shadow-xs">
													<div className="space-y-0.5">
														<FormLabel>Custom Entrypoint</FormLabel>
														<FormDescription>
															Use custom entrypoint for domain
															<br />
															"web" and/or "websecure" is used by default.
														</FormDescription>
														<FormMessage />
													</div>
													<FormControl>
														<Switch
															checked={field.value}
															onCheckedChange={(checked) => {
																field.onChange(checked);
																if (!checked) {
																	form.setValue("customEntrypoint", undefined);
																}
															}}
														/>
													</FormControl>
												</FormItem>
											)}
										/>

										{useCustomEntrypoint && (
											<FormField
												control={form.control}
												name="customEntrypoint"
												render={({ field }) => (
													<FormItem className="w-full">
														<FormLabel>Entrypoint Name</FormLabel>
														<FormControl>
															<Input
																placeholder="Enter entrypoint name manually"
																{...field}
																className="w-full"
															/>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
										)}

										<FormField
											control={form.control}
											name="https"
											render={({ field }) => (
												<FormItem className="flex flex-row items-center justify-between p-3 mt-4 border rounded-lg shadow-xs">
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
									</>
								) : null}

								{https && !hideHttpsForCloudflareAutomation && (
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
														<FormDescription>
															{field.value === "none" && (
																<>
																	<strong>None</strong> serves TLS using any
																	certificate you created in the{" "}
																	<Link
																		href="/dashboard/settings/certificates"
																		className="text-primary"
																	>
																		Certificates
																	</Link>{" "}
																	section whose CN/SAN matches this host â€”
																	Traefik selects it automatically via SNI.
																</>
															)}
															{field.value === "letsencrypt" && (
																<>
																	<strong>Let's Encrypt</strong> auto-provisions
																	a certificate automatically for this host.
																</>
															)}
															{field.value === "custom" && (
																<>
																	<strong>Custom</strong> uses a Traefik cert
																	resolver by name (defined in your static
																	configuration).
																</>
															)}
															{!field.value &&
																"Select a certificate provider to see how TLS will be served for this host."}
														</FormDescription>
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
															<FormDescription>
																Enter the <strong>name</strong> of a Traefik
																cert resolver defined in your static
																configuration (e.g. <code>letsencrypt</code>) â€”
																not certificate or private key content. To use a
																certificate you pasted in the Certificates
																section, choose <strong>None</strong> instead
																and Traefik will match it by SNI.
															</FormDescription>
															<FormControl>
																<Input
																	className="w-full"
																	placeholder="e.g. letsencrypt"
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
								<FormField
									control={form.control}
									name="middlewares"
									render={({ field }) => (
										<FormItem>
											<div className="flex items-center gap-2">
												<FormLabel>Middlewares</FormLabel>
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger type="button">
															<div className="size-4 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
																?
															</div>
														</TooltipTrigger>
														<TooltipContent className="max-w-[300px]">
															<p>
																Add Traefik middleware references. Middlewares
																must be defined in your Traefik configuration.
															</p>
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											</div>
											<div className="flex flex-wrap gap-2 mb-2">
												{field.value?.map((name, index) => (
													<Badge key={index} variant="secondary">
														{name}
														<X
															className="ml-1 size-3 cursor-pointer"
															onClick={() => {
																const newMiddlewares = [...(field.value || [])];
																newMiddlewares.splice(index, 1);
																form.setValue("middlewares", newMiddlewares);
															}}
														/>
													</Badge>
												))}
											</div>
											<FormControl>
												<div className="flex gap-2">
													<Input
														placeholder="e.g., rate-limit@file, auth@file"
														onKeyDown={(e) => {
															if (e.key === "Enter") {
																e.preventDefault();
																const input = e.currentTarget;
																const value = input.value.trim();
																if (value && !field.value?.includes(value)) {
																	form.setValue("middlewares", [
																		...(field.value || []),
																		value,
																	]);
																	input.value = "";
																}
															}
														}}
													/>
													<Button
														type="button"
														variant="secondary"
														onClick={() => {
															const input = document.querySelector(
																'input[placeholder="e.g., rate-limit@file, auth@file"]',
															) as HTMLInputElement;
															const value = input.value.trim();
															if (value && !field.value?.includes(value)) {
																form.setValue("middlewares", [
																	...(field.value || []),
																	value,
																]);
																input.value = "";
															}
														}}
													>
														Add
													</Button>
												</div>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
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
