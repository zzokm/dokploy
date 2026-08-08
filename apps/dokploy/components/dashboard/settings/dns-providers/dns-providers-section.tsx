"use client";

import { Cloud, KeyRound, Network } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";

const PROVIDER_LABELS: Record<string, string> = {
	cloudflare: "Cloudflare",
	digitalocean: "DigitalOcean",
	hetzner: "Hetzner DNS",
	route53: "Amazon Route 53",
	gcloud: "Google Cloud DNS",
};

const CONNECTABLE = ["cloudflare", "digitalocean", "hetzner"] as const;

type ConnectableProvider = (typeof CONNECTABLE)[number];

/**
 * Provider-agnostic DNS providers settings section.
 * Cloudflare still uses the legacy cloudflareSettings connect path for zone sync;
 * DO/Hetzner write to the sealed vault.
 */
export const DnsProvidersSection = () => {
	const utils = api.useUtils();
	const { data: capabilities } = api.dnsProviders.listCapabilities.useQuery();
	const { data: vaultCreds } = api.dnsProviders.list.useQuery();
	const { data: cfSettings } = api.cloudflareSettings.get.useQuery();

	const [open, setOpen] = useState(false);
	const [provider, setProvider] = useState<ConnectableProvider>("cloudflare");
	const [label, setLabel] = useState("Default");
	const [secret, setSecret] = useState("");

	const setCfToken = api.cloudflareSettings.setToken.useMutation({
		onSuccess: async (result) => {
			toast.success("Cloudflare connected");
			if (result.validation?.warning) toast.message(result.validation.warning);
			setSecret("");
			setOpen(false);
			await utils.cloudflareSettings.get.invalidate();
			await utils.cloudflareSettings.listZones.invalidate();
			await utils.dnsProviders.list.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const setVault = api.dnsProviders.setCredential.useMutation({
		onSuccess: async () => {
			toast.success("DNS provider connected");
			setSecret("");
			setOpen(false);
			await utils.dnsProviders.list.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const disconnectCf = api.cloudflareSettings.disconnect.useMutation({
		onSuccess: async () => {
			toast.success("Cloudflare disconnected");
			await utils.cloudflareSettings.get.invalidate();
			await utils.dnsProviders.list.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteVault = api.dnsProviders.deleteCredential.useMutation({
		onSuccess: async () => {
			toast.success("Provider disconnected");
			await utils.dnsProviders.list.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const handleConnect = () => {
		const next = secret.trim();
		if (!next) {
			toast.error("API token / secret is required");
			return;
		}
		if (provider === "cloudflare") {
			setCfToken.mutate({ apiToken: next });
			return;
		}
		setVault.mutate({
			provider,
			label: label.trim() || PROVIDER_LABELS[provider] || provider,
			secret: next,
		});
	};

	const isPending = setCfToken.isPending || setVault.isPending;
	const cfConnected = !!cfSettings?.connected;
	const otherCreds =
		vaultCreds?.filter((c) => c.provider !== "cloudflare") ?? [];

	const scopeHint =
		provider === "cloudflare"
			? "Zone → Zone → Read and Zone → DNS → Edit. Always proxied + DNS-01."
			: provider === "digitalocean"
				? "Personal access token with domain scope. HTTP-01 ACME by default."
				: "Hetzner DNS Console token (dns.hetzner.com), not the Cloud token.";

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
								hostnames.
							</CardDescription>
						</div>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="w-full sm:w-auto"
							onClick={() => setOpen(true)}
						>
							Add provider
						</Button>
					</CardHeader>

					<div className="space-y-2 border-t px-6 py-4">
						{cfConnected ? (
							<div className="flex flex-col gap-2 rounded-lg border bg-sidebar/60 p-3 sm:flex-row sm:items-center sm:justify-between">
								<div className="flex min-w-0 items-center gap-2">
									<Cloud className="size-4 shrink-0 text-muted-foreground" />
									<div className="min-w-0">
										<p className="text-sm font-medium">Cloudflare</p>
										<p className="font-mono text-xs text-muted-foreground">
											****{cfSettings?.apiTokenLast4}
										</p>
									</div>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="green">Connected</Badge>
									<Badge variant="outline">DNS-01</Badge>
									<Button
										type="button"
										variant="outline"
										size="sm"
										isLoading={disconnectCf.isPending}
										onClick={() => disconnectCf.mutate()}
									>
										Disconnect
									</Button>
								</div>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								No Cloudflare credential yet. Add a provider to enable managed
								DNS.
							</p>
						)}

						{otherCreds.map((cred) => (
							<div
								key={cred.id}
								className="flex flex-col gap-2 rounded-lg border bg-sidebar/60 p-3 sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="min-w-0">
									<p className="text-sm font-medium">
										{PROVIDER_LABELS[cred.provider] ?? cred.provider}
										{cred.label ? (
											<span className="text-muted-foreground">
												{" "}
												· {cred.label}
											</span>
										) : null}
									</p>
									<p className="font-mono text-xs text-muted-foreground">
										****{cred.secretLast4}
									</p>
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
										isLoading={deleteVault.isPending}
										onClick={() =>
											deleteVault.mutate({ credentialId: cred.id })
										}
									>
										Disconnect
									</Button>
								</div>
							</div>
						))}
					</div>
				</div>
			</Card>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<KeyRound className="size-5 text-muted-foreground" aria-hidden />
							Add DNS provider
						</DialogTitle>
						<DialogDescription>
							Tokens are sealed at rest. Responses expose last4 only.
						</DialogDescription>
					</DialogHeader>

					<div className="animate-in fade-in-0 slide-in-from-bottom-1 space-y-4 duration-300">
						<div className="space-y-2">
							<Label>Provider</Label>
							<Select
								value={provider}
								onValueChange={(v) => setProvider(v as ConnectableProvider)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CONNECTABLE.map((id) => (
										<SelectItem key={id} value={id}>
											{PROVIDER_LABELS[id]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{provider !== "cloudflare" ? (
							<div className="space-y-2">
								<Label htmlFor="dns-label">Label</Label>
								<Input
									id="dns-label"
									value={label}
									onChange={(e) => setLabel(e.target.value)}
									placeholder="Production"
								/>
							</div>
						) : null}

						<div className="space-y-2">
							<Label htmlFor="dns-secret">API token / secret</Label>
							<Input
								id="dns-secret"
								value={secret}
								onChange={(e) => setSecret(e.target.value)}
								placeholder="Paste secret"
								autoComplete="off"
								className="font-mono text-sm"
							/>
							<p className="text-xs text-muted-foreground">{scopeHint}</p>
						</div>
					</div>

					<DialogFooter>
						<Button type="button" variant="secondary" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="button" isLoading={isPending} onClick={handleConnect}>
							Connect
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
};
