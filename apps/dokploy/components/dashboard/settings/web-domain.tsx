import {
	INVALID_HOSTNAME_MESSAGE,
	VALID_HOSTNAME_REGEX,
} from "@dokploy/server/utils/hostname-validation";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { GlobeIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { CloudflareHostnameLabelField } from "@/components/dashboard/domains/dns-hostname-label-field";
import { matchHostToCloudflareZone } from "@/components/dashboard/settings/web-server/match-host-to-dns-zone";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/utils/api";

type HostInputMode = "manual" | "cloudflare";

const addServerDomain = z
	.object({
		domain: z
			.string()
			.trim()
			.toLowerCase()
			// empty clears the server domain and reverts to IP-only access
			.refine((val) => val === "" || VALID_HOSTNAME_REGEX.test(val), {
				message: INVALID_HOSTNAME_MESSAGE,
			}),
		letsEncryptEmail: z.string(),
		https: z.boolean().optional(),
		certificateType: z.enum(["letsencrypt", "none", "custom"]),
	})
	.superRefine((data, ctx) => {
		if (data.domain && data.https && !data.certificateType) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["certificateType"],
				message: "Required",
			});
		}
		if (
			data.domain &&
			data.https &&
			data.certificateType === "letsencrypt" &&
			!data.letsEncryptEmail
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"LetsEncrypt email is required when certificate type is letsencrypt",
				path: ["letsEncryptEmail"],
			});
		}
	});

type AddServerDomain = z.infer<typeof addServerDomain>;

export const WebDomain = () => {
	const utils = api.useUtils();
	const { data, refetch } = api.settings.getWebServerSettings.useQuery();
	const { mutateAsync, isPending } =
		api.settings.assignDomainServer.useMutation();
	const { data: cfSettings } = api.cloudflareSettings.get.useQuery();
	const { data: cfZones, isPending: cfZonesPending } =
		api.cloudflareSettings.listZones.useQuery(undefined, {
			enabled: !!cfSettings?.connected,
		});
	const { data: serverDnsPreview } =
		api.cloudflareSettings.previewServerDomainDns.useQuery(undefined, {
			enabled: !!cfSettings?.connected && !!data?.host,
		});

	const [hostInputMode, setHostInputMode] = useState<HostInputMode>("manual");
	const [selectedCfZoneId, setSelectedCfZoneId] = useState("");
	const [cfHostnameLabel, setCfHostnameLabel] = useState("@");
	const [userDisabledCfMode, setUserDisabledCfMode] = useState(false);
	const hydratedHostRef = useRef<string>("");
	const syncDnsAfterSave = true;

	const form = useForm<AddServerDomain>({
		defaultValues: {
			domain: "",
			certificateType: "none",
			letsEncryptEmail: "",
			https: false,
		},
		resolver: zodResolver(addServerDomain),
	});
	const https = form.watch("https");
	const domain = form.watch("domain") || "";
	const host = data?.host || "";
	const hasChanged = domain !== host;

	const enabledCfZones = useMemo(
		() =>
			(cfZones ?? []).filter(
				(z) => z.status === "active" && !z.paused && !!z.cfZoneId,
			),
		[cfZones],
	);

	const selectedZone = useMemo(
		() => enabledCfZones.find((z) => z.cfZoneId === selectedCfZoneId) ?? null,
		[enabledCfZones, selectedCfZoneId],
	);

	const savedHostZoneMatch = useMemo(
		() => matchHostToCloudflareZone(host, enabledCfZones),
		[host, enabledCfZones],
	);

	const hasMirroredCloudflareDns =
		!!serverDnsPreview &&
		!!serverDnsPreview.host &&
		(serverDnsPreview.state === "ok" ||
			serverDnsPreview.state === "drift" ||
			serverDnsPreview.state === "missing" ||
			!!serverDnsPreview.currentRecordId);

	const isCloudflareManagedHost =
		!!cfSettings?.connected &&
		!!host.trim() &&
		(!!savedHostZoneMatch || hasMirroredCloudflareDns);

	const cloudflareModeEnabled =
		hostInputMode === "cloudflare" ||
		(!userDisabledCfMode && isCloudflareManagedHost && cfZonesPending);

	useEffect(() => {
		if (data) {
			form.reset({
				domain: data?.host || "",
				certificateType: data?.certificateType || "none",
				letsEncryptEmail: data?.letsEncryptEmail || "",
				https: data?.https || false,
			});
		}
	}, [form, form.reset, data]);

	// Derive managed DNS toggle from zone/mirror state, not a stale local flag.
	useEffect(() => {
		if (!cfSettings?.connected) {
			setHostInputMode("manual");
			hydratedHostRef.current = "";
			return;
		}
		if (cfZonesPending) {
			return;
		}

		const nextHost = host.trim().toLowerCase();
		if (hydratedHostRef.current !== nextHost) {
			hydratedHostRef.current = nextHost;
			setUserDisabledCfMode(false);
		}

		if (userDisabledCfMode) {
			return;
		}

		if (!isCloudflareManagedHost) {
			return;
		}

		setHostInputMode("cloudflare");
		if (savedHostZoneMatch) {
			setSelectedCfZoneId(savedHostZoneMatch.cfZoneId);
			setCfHostnameLabel(savedHostZoneMatch.label);
		}
	}, [
		cfSettings?.connected,
		cfZonesPending,
		host,
		isCloudflareManagedHost,
		savedHostZoneMatch,
		userDisabledCfMode,
	]);

	useEffect(() => {
		if (hostInputMode !== "cloudflare" || !selectedZone) {
			return;
		}
		const label = cfHostnameLabel.trim().toLowerCase().replace(/\.$/, "");
		const nextHost =
			!label || label === "@"
				? selectedZone.name.toLowerCase()
				: `${label}.${selectedZone.name.toLowerCase()}`;
		form.setValue("domain", nextHost, {
			shouldValidate: true,
			shouldDirty: true,
		});
	}, [hostInputMode, selectedZone, cfHostnameLabel, form]);

	const applyDns = api.cloudflareSettings.applyServerDomainDns.useMutation();

	const onSubmit = async (formData: AddServerDomain) => {
		await mutateAsync({
			host: formData.domain,
			letsEncryptEmail: formData.letsEncryptEmail,
			certificateType: formData.certificateType,
			https: formData.https,
		})
			.then(async () => {
				await refetch();
				toast.success("Domain Assigned");

				const shouldSync =
					hostInputMode === "cloudflare" &&
					syncDnsAfterSave &&
					!!cfSettings?.connected &&
					!!formData.domain.trim();

				if (shouldSync) {
					try {
						await applyDns.mutateAsync({ proxied: true });
						await utils.cloudflareSettings.previewServerDomainDns.invalidate();
						toast.success("Cloudflare DNS synced");
					} catch (e) {
						toast.error(
							e instanceof Error
								? e.message
								: "Domain saved, but Cloudflare DNS sync failed",
						);
					}
				}
			})
			.catch(() => {
				toast.error("Error assigning the domain");
			});
	};

	const showCloudflareToggle =
		!!cfSettings?.connected && (!cfZonesPending || isCloudflareManagedHost);

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar  p-2.5 rounded-xl  max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md ">
					<CardHeader className="flex flex-row gap-2 flex-wrap justify-between items-center">
						<div className="flex flex-col gap-1">
							<CardTitle className="text-xl flex flex-row gap-2">
								<GlobeIcon className="size-6 text-muted-foreground self-center" />
								Server Domain
							</CardTitle>
							<CardDescription>
								Add a domain to your server application.
							</CardDescription>
						</div>
					</CardHeader>
					<CardContent className="space-y-2 py-6 border-t">
						{/* Warning for GitHub webhook URL changes */}
						{hasChanged && (
							<AlertBlock type="warning">
								<div className="space-y-2">
									<p className="font-medium">Important: URL Change Impact</p>
									<p>
										If you change the Dokploy Server URL make sure to update
										your Github Apps to keep the auto-deploy working and preview
										deployments working.
									</p>
								</div>
							</AlertBlock>
						)}
						<Form {...form}>
							<form
								onSubmit={form.handleSubmit(onSubmit)}
								className="grid w-full gap-4 grid-cols-2"
							>
								{showCloudflareToggle ? (
									<div className="col-span-2 flex flex-row items-center justify-between gap-4 rounded-lg border p-3 shadow-xs">
										<div className="min-w-0 space-y-0.5">
											<p className="text-sm font-medium leading-none">
												Managed DNS domain
											</p>
											<p className="text-xs text-muted-foreground">
												Build the hostname from a synced DNS domain.
											</p>
										</div>
										<Switch
											checked={cloudflareModeEnabled}
											onCheckedChange={(checked) => {
												const next: HostInputMode = checked
													? "cloudflare"
													: "manual";
												setHostInputMode(next);
												setUserDisabledCfMode(!checked);
												if (!checked) {
													form.setValue("domain", host || "", {
														shouldValidate: true,
													});
												} else if (savedHostZoneMatch) {
													setSelectedCfZoneId(savedHostZoneMatch.cfZoneId);
													setCfHostnameLabel(savedHostZoneMatch.label);
												}
											}}
											aria-label="Managed DNS domain"
											className="shrink-0"
										/>
									</div>
								) : null}

								{hostInputMode === "cloudflare" && cfSettings?.connected ? (
									<div className="col-span-2 animate-in fade-in-0 slide-in-from-bottom-1 grid gap-4 duration-300 md:grid-cols-2">
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
													No DNS domains yet. Open Domains and click Sync DNS
													domains.
												</p>
											) : null}
										</div>
										<CloudflareHostnameLabelField
											value={cfHostnameLabel}
											onChange={setCfHostnameLabel}
											placeholder="@ or dokploy"
											ariaLabel="Hostname label"
											disabled={!selectedZone}
											inputClassName="text-sm"
											suffix={
												selectedZone ? `.${selectedZone.name}` : ".domain.com"
											}
										/>
									</div>
								) : null}

								<FormField
									control={form.control}
									name="domain"
									render={({ field }) => {
										return (
											<FormItem className="col-span-2 md:col-span-1">
												<FormLabel>Domain</FormLabel>
												<FormControl>
													<Input
														className="w-full font-mono"
														placeholder={"dokploy.com"}
														{...field}
														disabled={hostInputMode === "cloudflare"}
														readOnly={hostInputMode === "cloudflare"}
													/>
												</FormControl>
												{hostInputMode === "cloudflare" ? (
													<FormDescription>
														Filled from the domain and label above. DNS syncs on
														save when possible.
													</FormDescription>
												) : null}
												<FormMessage />
											</FormItem>
										);
									}}
								/>

								<FormField
									control={form.control}
									name="letsEncryptEmail"
									render={({ field }) => {
										return (
											<FormItem className="col-span-2 md:col-span-1">
												<FormLabel>Let's Encrypt Email</FormLabel>
												<FormControl>
													<Input
														className="w-full"
														placeholder={"Dp4kz@example.com"}
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										);
									}}
								/>
								<FormField
									control={form.control}
									name="https"
									render={({ field }) => (
										<FormItem className="col-span-2 flex flex-row items-center justify-between gap-4 space-y-0 rounded-lg border p-3 shadow-xs">
											<div className="min-w-0 space-y-0.5">
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
													className="shrink-0"
												/>
											</FormControl>
										</FormItem>
									)}
								/>
								{https && (
									<FormField
										control={form.control}
										name="certificateType"
										render={({ field }) => {
											return (
												<FormItem className="col-span-2">
													<FormLabel>Certificate Provider</FormLabel>
													<Select
														onValueChange={field.onChange}
														value={field.value}
													>
														<FormControl>
															<SelectTrigger>
																<SelectValue placeholder="Select a certificate" />
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															<SelectItem value={"none"}>None</SelectItem>
															<SelectItem value={"letsencrypt"}>
																Let's Encrypt
															</SelectItem>
														</SelectContent>
													</Select>
													<FormMessage />
												</FormItem>
											);
										}}
									/>
								)}

								<div className="flex w-full justify-end col-span-2">
									<Button
										isLoading={isPending || applyDns.isPending}
										type="submit"
									>
										Save
									</Button>
								</div>
							</form>
						</Form>
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
