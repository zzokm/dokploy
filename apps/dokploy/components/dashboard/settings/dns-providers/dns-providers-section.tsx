"use client";

import { KeyRound, Network } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type ConnectableDnsProviderId,
	DNS_PROVIDER_LABELS,
	dnsProviderScopeHint,
	isConnectableDnsProvider,
} from "@/components/dashboard/domains/dns-connectable-providers";
import { DnsProviderPicker } from "@/components/dashboard/domains/dns-provider-picker";
import { DnsProviderLogoChrome } from "@/components/dashboard/domains/logos/dns-provider-logo-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/utils/api";

type VaultCred = {
	id: string;
	provider: string;
	label: string;
	secretLast4: string;
	legacyCloudflare?: boolean;
};

/**
 * Provider-agnostic DNS providers settings section.
 * Every connect adds another vault account (label required for all providers).
 */
export const DnsProvidersSection = () => {
	const utils = api.useUtils();
	const { data: capabilities } = api.dnsProviders.listCapabilities.useQuery();
	const { data: vaultCreds } = api.dnsProviders.list.useQuery();

	const [open, setOpen] = useState(false);
	const [rotateCred, setRotateCred] = useState<VaultCred | null>(null);
	const [provider, setProvider] =
		useState<ConnectableDnsProviderId>("cloudflare");
	const [label, setLabel] = useState("Default");
	const [secret, setSecret] = useState("");
	const [accessKeyId, setAccessKeyId] = useState("");
	const [secretAccessKey, setSecretAccessKey] = useState("");

	const resetForm = () => {
		setSecret("");
		setAccessKeyId("");
		setSecretAccessKey("");
		setLabel("Default");
		setProvider("cloudflare");
	};

	const setVault = api.dnsProviders.setCredential.useMutation({
		onSuccess: async () => {
			toast.success("DNS provider account added");
			resetForm();
			setOpen(false);
			await utils.dnsProviders.list.invalidate();
			await utils.dnsProviders.listZones.invalidate();
			await utils.cloudflareSettings.get.invalidate();
			await utils.cloudflareSettings.listZones.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const rotateVault = api.dnsProviders.rotateCredential.useMutation({
		onSuccess: async () => {
			toast.success("Credential rotated");
			setSecret("");
			setRotateCred(null);
			await utils.dnsProviders.list.invalidate();
			await utils.cloudflareSettings.get.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteVault = api.dnsProviders.deleteCredential.useMutation({
		onSuccess: async () => {
			toast.success("Account disconnected");
			await utils.dnsProviders.list.invalidate();
			await utils.dnsProviders.listZones.invalidate();
			await utils.cloudflareSettings.get.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const buildSecretPayload = (
		selected: ConnectableDnsProviderId,
	): string | null => {
		if (selected === "route53") {
			const fromJson = secret.trim();
			if (fromJson.startsWith("{")) return fromJson;
			const keyId = accessKeyId.trim();
			const keySecret = secretAccessKey.trim();
			if (!keyId || !keySecret) {
				toast.error("Access key id and secret access key are required");
				return null;
			}
			return JSON.stringify({
				accessKeyId: keyId,
				secretAccessKey: keySecret,
			});
		}

		if (selected === "gcloud") {
			const json = secret.trim();
			if (!json) {
				toast.error("Service account JSON is required");
				return null;
			}
			try {
				JSON.parse(json);
			} catch {
				toast.error("Service account must be valid JSON");
				return null;
			}
			return json;
		}

		const next = secret.trim();
		if (!next) {
			toast.error(
				selected === "ns1"
					? "API key is required"
					: "API token / secret is required",
			);
			return null;
		}
		return next;
	};

	const handleConnect = () => {
		const nextLabel = label.trim();
		if (!nextLabel) {
			toast.error("Label is required");
			return;
		}
		const payload = buildSecretPayload(provider);
		if (!payload) return;
		setVault.mutate({
			provider,
			label: nextLabel,
			secret: payload,
		});
	};

	const handleRotate = () => {
		if (!rotateCred) return;
		const selected = rotateCred.provider as ConnectableDnsProviderId;
		const payload = buildSecretPayload(selected);
		if (!payload) return;
		rotateVault.mutate({
			credentialId: rotateCred.id,
			secret: payload,
			label: label.trim() || rotateCred.label,
		});
	};

	const secretFieldLabel =
		provider === "gcloud"
			? "Service account JSON"
			: provider === "route53"
				? "Credentials JSON (optional if using fields below)"
				: provider === "ns1"
					? "API key"
					: "API token / secret";

	const rotateProvider = (rotateCred?.provider ??
		"cloudflare") as ConnectableDnsProviderId;

	return (
		<>
			<Card className="h-full min-w-0 w-full overflow-hidden rounded-xl border border-border bg-sidebar p-2.5 shadow-none">
				<div className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-xl bg-background shadow-md duration-300">
					<CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0 space-y-1">
							<CardTitle className="flex flex-row items-center gap-2 text-lg sm:text-xl">
								<Network
									className="size-6 shrink-0 text-muted-foreground"
									aria-hidden
								/>
								DNS providers
							</CardTitle>
							<CardDescription className="text-xs sm:text-sm">
								Connect a provider for managed DNS: zones, records, and
								hostnames. Multiple accounts per provider are supported.
							</CardDescription>
						</div>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="w-full sm:w-auto"
							onClick={() => {
								resetForm();
								setOpen(true);
							}}
						>
							Add provider
						</Button>
					</CardHeader>

					<div className="space-y-2 border-t px-6 py-4">
						{(vaultCreds?.length ?? 0) === 0 ? (
							<p className="text-sm text-muted-foreground">
								No DNS provider accounts yet. Add a provider to enable managed
								DNS.
							</p>
						) : (
							(vaultCreds ?? []).map((cred, index) => {
								const providerId = isConnectableDnsProvider(cred.provider)
									? cred.provider
									: null;
								const providerName = providerId
									? DNS_PROVIDER_LABELS[providerId]
									: cred.provider;
								return (
									<div
										key={cred.id}
										className="flex animate-in fade-in-0 slide-in-from-bottom-1 flex-col gap-3 rounded-lg border bg-sidebar/60 p-3 fill-mode-both duration-200 sm:flex-row sm:items-center sm:justify-between"
										style={{
											animationDelay: `${Math.min(index, 8) * 35}ms`,
										}}
									>
										<div className="flex min-w-0 items-center gap-3">
											{providerId ? (
												<DnsProviderLogoChrome id={providerId} />
											) : null}
											<div className="min-w-0 space-y-0.5">
												<p className="truncate text-sm font-medium leading-snug text-foreground">
													{providerName}
												</p>
												<p className="truncate text-xs text-muted-foreground">
													{cred.label}
													<span className="font-mono">
														{" "}
														· ****{cred.secretLast4}
													</span>
													{cred.legacyCloudflare ? " · legacy" : ""}
												</p>
											</div>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<Badge variant="green">Connected</Badge>
											{capabilities?.find((c) => c.id === cred.provider)
												?.requiresDns01WhenManaged ? (
												<Badge variant="outline">DNS-01</Badge>
											) : (
												<Badge variant="outline">HTTP-01</Badge>
											)}
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => {
													setLabel(cred.label);
													setSecret("");
													setAccessKeyId("");
													setSecretAccessKey("");
													setRotateCred(cred);
												}}
											>
												Rotate
											</Button>
											<Button
												type="button"
												variant="outline"
												size="sm"
												isLoading={deleteVault.isPending}
												onClick={() =>
													deleteVault.mutate({ credentialId: cred.id })
												}
											>
												Disconnect
											</Button>
										</div>
									</div>
								);
							})
						)}
					</div>
				</div>
			</Card>

			<Dialog
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (!next) resetForm();
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<KeyRound className="size-5 text-muted-foreground" aria-hidden />
							Add DNS provider account
						</DialogTitle>
						<DialogDescription>
							Adds another account. Credentials are sealed at rest. Only a short
							suffix is shown for identification.
						</DialogDescription>
					</DialogHeader>

					<div className="animate-in fade-in-0 slide-in-from-bottom-1 space-y-4 duration-300">
						<div className="space-y-2">
							<Label>Provider</Label>
							<DnsProviderPicker value={provider} onChange={setProvider} />
						</div>

						<div className="space-y-2">
							<Label htmlFor="dns-label">Label</Label>
							<Input
								id="dns-label"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								placeholder="Production"
							/>
							<p className="text-xs text-muted-foreground">
								Must be unique per provider in this organization.
							</p>
						</div>

						{provider === "route53" ? (
							<>
								<div className="space-y-2">
									<Label htmlFor="dns-access-key-id">Access key id</Label>
									<Input
										id="dns-access-key-id"
										value={accessKeyId}
										onChange={(e) => setAccessKeyId(e.target.value)}
										autoComplete="off"
										className="font-mono text-sm"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="dns-secret-access-key">
										Secret access key
									</Label>
									<Input
										id="dns-secret-access-key"
										type="password"
										value={secretAccessKey}
										onChange={(e) => setSecretAccessKey(e.target.value)}
										autoComplete="off"
										className="font-mono text-sm"
									/>
								</div>
							</>
						) : null}

						<div className="space-y-2">
							<Label htmlFor="dns-secret">{secretFieldLabel}</Label>
							{provider === "gcloud" || provider === "route53" ? (
								<Textarea
									id="dns-secret"
									value={secret}
									onChange={(e) => setSecret(e.target.value)}
									placeholder={
										provider === "gcloud"
											? '{"type":"service_account",...}'
											: '{"accessKeyId":"...","secretAccessKey":"..."}'
									}
									autoComplete="off"
									className="min-h-28 font-mono text-sm"
								/>
							) : (
								<Input
									id="dns-secret"
									value={secret}
									onChange={(e) => setSecret(e.target.value)}
									placeholder="Paste secret"
									autoComplete="off"
									className="font-mono text-sm"
								/>
							)}
							<p className="text-xs text-muted-foreground">
								{dnsProviderScopeHint(provider)}
							</p>
						</div>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							isLoading={setVault.isPending}
							onClick={handleConnect}
						>
							Add account
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={!!rotateCred}
				onOpenChange={(next) => {
					if (!next) {
						setRotateCred(null);
						setSecret("");
					}
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Rotate credential</DialogTitle>
						<DialogDescription>
							Updates the sealed secret for{" "}
							<span className="font-medium text-foreground">
								{rotateCred?.label}
							</span>
							. Does not create a new account.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="dns-rotate-label">Label</Label>
							<Input
								id="dns-rotate-label"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
							/>
						</div>
						{rotateProvider === "route53" ? (
							<>
								<div className="space-y-2">
									<Label htmlFor="dns-rotate-access-key">Access key id</Label>
									<Input
										id="dns-rotate-access-key"
										value={accessKeyId}
										onChange={(e) => setAccessKeyId(e.target.value)}
										autoComplete="off"
										className="font-mono text-sm"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="dns-rotate-secret-key">
										Secret access key
									</Label>
									<Input
										id="dns-rotate-secret-key"
										type="password"
										value={secretAccessKey}
										onChange={(e) => setSecretAccessKey(e.target.value)}
										autoComplete="off"
										className="font-mono text-sm"
									/>
								</div>
							</>
						) : null}
						<div className="space-y-2">
							<Label htmlFor="dns-rotate-secret">New secret</Label>
							{rotateProvider === "gcloud" || rotateProvider === "route53" ? (
								<Textarea
									id="dns-rotate-secret"
									value={secret}
									onChange={(e) => setSecret(e.target.value)}
									className="min-h-28 font-mono text-sm"
								/>
							) : (
								<Input
									id="dns-rotate-secret"
									value={secret}
									onChange={(e) => setSecret(e.target.value)}
									autoComplete="off"
									className="font-mono text-sm"
								/>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setRotateCred(null)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							isLoading={rotateVault.isPending}
							onClick={handleRotate}
						>
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
};
