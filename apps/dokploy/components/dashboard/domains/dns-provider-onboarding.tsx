"use client";

import { ArrowLeft, Check, KeyRound, Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type ConnectableDnsProviderId,
	type DnsProviderOptionId,
	DNS_PROVIDER_LABELS,
	DNS_PROVIDER_OPTIONS,
} from "@/components/dashboard/domains/dns-connectable-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

type ConnectableProvider = ConnectableDnsProviderId;
type ProviderOptionId = DnsProviderOptionId;

const PROVIDERS = DNS_PROVIDER_OPTIONS;
const PROVIDER_LABELS = DNS_PROVIDER_LABELS;

const STEPS = [
	{ id: "choose", title: "Choose provider" },
	{ id: "credentials", title: "Create credentials" },
	{ id: "connect", title: "Connect" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

const ProviderLogo = ({
	id,
	className,
}: {
	id: ProviderOptionId;
	className?: string;
}) => {
	const common = cn("size-5 shrink-0", className);
	switch (id) {
		case "cloudflare":
			return (
				<svg viewBox="0 0 48 48" className={common} aria-hidden>
					<title>Cloudflare</title>
					<path
						fill="#F38020"
						d="M14.2 32.6h21.4c.5 0 .9-.2 1.2-.5.7-.7.8-1.8.3-2.7l-4.2-7.3c-.3-.5-.8-.8-1.4-.9l-1.4-.2c-.3-3.5-3.2-6.2-6.8-6.2-2.7 0-5.1 1.5-6.2 3.8-.7-.4-1.5-.6-2.4-.6-2.5 0-4.5 1.9-4.8 4.3-.1 0-.2 0-.3 0-2.6 0-4.7 2.1-4.7 4.7 0 .3 0 .5.1.8-.1 0-.1 0-.2 0-2.1 0-3.8 1.7-3.8 3.8 0 2 1.6 3.7 3.6 3.8h9.6z"
					/>
					<path
						fill="#FAAE40"
						d="M37.8 27.4c-.2-.8-.7-1.4-1.4-1.8l-9.9-5.2c-.3-.2-.7-.1-.9.2-.2.3-.1.7.2.9l9.9 5.2c.3.1.4.4.4.7 0 .1 0 .2-.1.3-.2.4-.7.6-1.1.4l-12.4-4.2c-.4-.1-.8.1-.9.5-.1.4.1.8.5.9l12.4 4.2c1.4.5 2.9-.3 3.3-1.7.1-.3.1-.6.1-.9-.1-.2-.1-.3-.1-.5z"
					/>
				</svg>
			);
		case "digitalocean":
			return (
				<svg viewBox="0 0 48 48" className={common} aria-hidden>
					<title>DigitalOcean</title>
					<path
						fill="#0080FF"
						d="M24 4C12.95 4 4 12.95 4 24c0 8.84 5.75 16.35 13.7 18.95v-7.62h-3.66V24h3.66v-2.74c0-5.36 3.19-8.32 8.08-8.32 2.34 0 4.79.42 4.79.42v5.26h-2.7c-2.66 0-3.49 1.65-3.49 3.34V24h5.94l-.95 7.33h-4.99v9.95C38.25 42.68 44 34.84 44 24 44 12.95 35.05 4 24 4z"
					/>
				</svg>
			);
		case "hetzner":
			return (
				<svg viewBox="0 0 48 48" className={common} aria-hidden>
					<title>Hetzner</title>
					<rect width="48" height="48" rx="8" fill="#D50C2D" />
					<path
						fill="#fff"
						d="M14 12h6.5v9.5H28V12h6.5v24H28V27.5h-7.5V36H14V12z"
					/>
				</svg>
			);
		case "route53":
			return (
				<svg viewBox="0 0 48 48" className={common} aria-hidden>
					<title>Amazon Route 53</title>
					<path
						fill="#FF9900"
						d="M24 6 8 14v10c0 10.2 6.8 19.7 16 22 9.2-2.3 16-11.8 16-22V14L24 6zm0 8.2 9.5 4.7v6.1c0 6.8-4.1 13.2-9.5 15.1-5.4-1.9-9.5-8.3-9.5-15.1v-6.1L24 14.2z"
					/>
				</svg>
			);
		case "gcloud":
			return (
				<svg viewBox="0 0 48 48" className={common} aria-hidden>
					<title>Google Cloud</title>
					<path
						fill="#4285F4"
						d="M24.5 22.5H42v3.2c0 5.4-4.4 9.8-9.8 9.8H24.5V22.5z"
					/>
					<path fill="#EA4335" d="M15.3 12.2 24.5 7l9.2 5.2v7.3H15.3v-7.3z" />
					<path
						fill="#FBBC04"
						d="M6 22.5h18.5v13H15.8C10.4 35.5 6 31.1 6 25.7v-3.2z"
					/>
					<path fill="#34A853" d="M15.3 19.5h18.4v3H15.3z" />
				</svg>
			);
		case "ns1":
			return (
				<svg viewBox="0 0 48 48" className={common} aria-hidden>
					<title>NS1</title>
					<rect width="48" height="48" rx="8" fill="#1A1A1A" />
					<text
						x="24"
						y="30"
						textAnchor="middle"
						fill="#fff"
						fontSize="14"
						fontWeight="700"
						fontFamily="ui-sans-serif, system-ui, sans-serif"
					>
						NS1
					</text>
				</svg>
			);
		case "akamai":
			return (
				<svg viewBox="0 0 48 48" className={common} aria-hidden>
					<title>Akamai</title>
					<rect width="48" height="48" rx="8" fill="#0096D6" />
					<path
						fill="#fff"
						d="M24 10c-7.7 0-14 6.3-14 14s6.3 14 14 14 14-6.3 14-14-6.3-14-14-14zm0 22.4c-4.6 0-8.4-3.8-8.4-8.4S19.4 15.6 24 15.6s8.4 3.8 8.4 8.4-3.8 8.4-8.4 8.4z"
					/>
				</svg>
			);
		default:
			return null;
	}
};

type InstructionBlock = {
	title: string;
	body: string;
	bullets?: string[];
	note?: string;
};

const CREDENTIAL_INSTRUCTIONS: Record<ConnectableProvider, InstructionBlock> = {
	cloudflare: {
		title: "Create a Cloudflare API token",
		body: "Open Cloudflare → My Profile → API Tokens → Create Token. Prefer a custom token with least privilege.",
		bullets: [
			"Zone → Zone → Read",
			"Zone → DNS → Edit",
			"Account → Account Settings → Read (needed to list zones in some accounts)",
		],
		note: "Managed Cloudflare DNS always uses CDN proxy and DNS-01 certificates. There is no proxy toggle.",
	},
	digitalocean: {
		title: "Create a DigitalOcean API token",
		body: "Open DigitalOcean → API → Tokens/Keys → Generate New Token.",
		bullets: [
			"Grant read and write access (or a custom role that includes domain scope)",
			"Copy the token once. DigitalOcean only shows it at creation time.",
		],
		note: "Managed DigitalOcean domains use HTTP-01 certificates by default.",
	},
	hetzner: {
		title: "Create a Hetzner DNS Console token",
		body: "Use the Hetzner DNS Console at dns.hetzner.com. This is not a Hetzner Cloud API token.",
		bullets: [
			"Sign in to dns.hetzner.com",
			"Open API tokens and create a new token",
			"Copy the token for DNS zone and record access",
		],
		note: "Cloud Console tokens will not work with Hetzner DNS automation.",
	},
	route53: {
		title: "Create IAM credentials for Route 53",
		body: "Create an IAM user (or role keys) with access to public hosted zones only.",
		bullets: [
			"route53:ListHostedZones",
			"route53:GetHostedZone",
			"route53:ListResourceRecordSets",
			"route53:ChangeResourceRecordSets",
		],
		note: "Paste JSON with accessKeyId and secretAccessKey, or enter both fields below.",
	},
	gcloud: {
		title: "Create a Google Cloud service account",
		body: "In Google Cloud Console, create a service account for Cloud DNS and download a JSON key.",
		bullets: [
			"Grant roles/dns.admin (or narrower DNS read/write roles that cover zones and record sets)",
			"Download the service account JSON key",
			"Project id can come from the JSON project_id field",
		],
		note: "Paste the full service account JSON. Do not commit this file to git.",
	},
};

export const DnsProviderOnboarding = () => {
	const utils = api.useUtils();
	const [step, setStep] = useState<StepId>("choose");
	const [selected, setSelected] = useState<ConnectableProvider | null>(null);
	const [secret, setSecret] = useState("");
	const [label, setLabel] = useState("Default");
	const [accessKeyId, setAccessKeyId] = useState("");
	const [secretAccessKey, setSecretAccessKey] = useState("");

	const invalidateAfterConnect = async () => {
		setSecret("");
		setAccessKeyId("");
		setSecretAccessKey("");
		await utils.cloudflareSettings.get.invalidate();
		await utils.cloudflareSettings.listZones.invalidate();
		await utils.dnsProviders.list.invalidate();
		await utils.dnsProviders.listZones.invalidate();
		await utils.domain.listInventory.invalidate();
	};

	const setCfToken = api.cloudflareSettings.setToken.useMutation({
		onSuccess: async (result) => {
			toast.success("Cloudflare connected, syncing DNS domains…");
			if (result.validation?.warning) {
				toast.message(result.validation.warning);
			}
			await invalidateAfterConnect();
		},
		onError: (e) => toast.error(e.message),
	});

	const setVault = api.dnsProviders.setCredential.useMutation({
		onSuccess: async () => {
			toast.success("DNS provider connected, syncing DNS domains…");
			await invalidateAfterConnect();
		},
		onError: (e) => toast.error(e.message),
	});

	const stepIndex = STEPS.findIndex((s) => s.id === step);
	const selectedMeta = selected
		? PROVIDERS.find((p) => p.id === selected)
		: null;
	const instructions = selected ? CREDENTIAL_INSTRUCTIONS[selected] : null;
	const isPending = setCfToken.isPending || setVault.isPending;

	const goNextFromChoose = () => {
		if (!selected) {
			toast.error("Select a DNS provider to continue");
			return;
		}
		setStep("credentials");
	};

	const handleConnect = () => {
		if (!selected) return;

		if (selected === "cloudflare") {
			const token = secret.trim();
			if (!token) {
				toast.error("API token is required");
				return;
			}
			setCfToken.mutate({ apiToken: token });
			return;
		}

		if (selected === "route53") {
			const fromJson = secret.trim();
			let payload = fromJson;
			if (!payload.startsWith("{")) {
				const keyId = accessKeyId.trim();
				const keySecret = secretAccessKey.trim();
				if (!keyId || !keySecret) {
					toast.error("Access key id and secret access key are required");
					return;
				}
				payload = JSON.stringify({
					accessKeyId: keyId,
					secretAccessKey: keySecret,
				});
			}
			setVault.mutate({
				provider: "route53",
				label: label.trim() || PROVIDER_LABELS.route53,
				secret: payload,
			});
			return;
		}

		if (selected === "gcloud") {
			const json = secret.trim();
			if (!json) {
				toast.error("Service account JSON is required");
				return;
			}
			try {
				JSON.parse(json);
			} catch {
				toast.error("Service account must be valid JSON");
				return;
			}
			setVault.mutate({
				provider: "gcloud",
				label: label.trim() || PROVIDER_LABELS.gcloud,
				secret: json,
			});
			return;
		}

		const token = secret.trim();
		if (!token) {
			toast.error("API token is required");
			return;
		}
		setVault.mutate({
			provider: selected,
			label: label.trim() || PROVIDER_LABELS[selected],
			secret: token,
		});
	};

	const secretFieldLabel =
		selected === "gcloud"
			? "Service account JSON"
			: selected === "route53"
				? "Credentials JSON (optional if using fields below)"
				: "API token";

	return (
		<div className="flex w-full flex-col gap-6 py-2">
			<div className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<p className="text-base font-medium text-foreground">
						{STEPS[stepIndex]?.title}
					</p>
					<span className="text-xs text-muted-foreground">
						Step {stepIndex + 1} of {STEPS.length}
					</span>
				</div>
				<ol className="flex items-center gap-2" aria-label="Onboarding steps">
					{STEPS.map((s, index) => {
						const active = index === stepIndex;
						const done = index < stepIndex;
						return (
							<li key={s.id} className="flex flex-1 items-center gap-2">
								<span
									className={cn(
										"flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
										active && "border-foreground bg-foreground text-background",
										done && "border-primary/40 bg-primary/10 text-foreground",
										!active &&
											!done &&
											"border-border bg-muted/40 text-muted-foreground",
									)}
									aria-current={active ? "step" : undefined}
								>
									{done ? (
										<Check className="size-3.5" aria-hidden />
									) : (
										index + 1
									)}
								</span>
								{index < STEPS.length - 1 ? (
									<span
										className={cn(
											"h-px w-full",
											done ? "bg-primary/40" : "bg-border",
										)}
										aria-hidden
									/>
								) : null}
							</li>
						);
					})}
				</ol>
			</div>

			{step === "choose" ? (
				<div className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-4 duration-300">
					<div className="space-y-1.5 text-center sm:text-left">
						<p className="text-base font-medium text-foreground">
							Connect a DNS provider
						</p>
						<p className="text-sm leading-relaxed text-muted-foreground">
							Choose where your DNS domains live. You can add more providers
							later from Web Server settings.
						</p>
					</div>

					<div className="flex flex-col gap-2" aria-label="DNS providers">
						{PROVIDERS.map((provider, index) => {
							const isSelected = selected === provider.id;
							const disabled = !provider.ready;
							return (
								<button
									key={provider.id}
									type="button"
									aria-pressed={isSelected}
									disabled={disabled}
									onClick={() => {
										if (!provider.ready) return;
										setSelected(provider.id as ConnectableProvider);
									}}
									className={cn(
										"flex w-full animate-in fade-in-0 slide-in-from-bottom-1 items-center gap-3 rounded-lg border bg-sidebar/60 px-3 py-3 text-left duration-200 fill-mode-both transition-colors",
										!disabled && "hover:bg-muted/30 hover:shadow-sm",
										isSelected &&
											"border-foreground/30 bg-background ring-1 ring-foreground/15",
										disabled && "cursor-not-allowed opacity-60",
									)}
									style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
								>
									<span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
										<ProviderLogo id={provider.id} />
									</span>
									<span className="min-w-0 flex-1">
										<span className="block text-sm font-medium text-foreground">
											{provider.name}
										</span>
										{disabled ? (
											<span className="block text-xs text-muted-foreground">
												Adapter not ready for connect yet
											</span>
										) : null}
									</span>
									{disabled ? (
										<Badge variant="outline">
											{provider.comingSoonLabel ?? "Coming soon"}
										</Badge>
									) : isSelected ? (
										<span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
											<Check className="size-3" aria-hidden />
										</span>
									) : null}
								</button>
							);
						})}
					</div>

					<div className="flex justify-end">
						<Button
							type="button"
							disabled={!selected}
							onClick={goNextFromChoose}
							className="w-full sm:w-auto"
						>
							Continue
						</Button>
					</div>
				</div>
			) : null}

			{step === "credentials" && selected && instructions ? (
				<div className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-5 duration-300">
					<div className="flex items-center gap-3 rounded-lg border bg-sidebar/60 p-3">
						<span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
							<ProviderLogo id={selected} />
						</span>
						<div className="min-w-0">
							<p className="text-sm font-medium">{selectedMeta?.name}</p>
							<p className="text-xs text-muted-foreground">
								Follow these steps, then continue to connect.
							</p>
						</div>
					</div>

					<div className="space-y-3 rounded-lg border bg-sidebar/40 p-4">
						<div className="flex gap-3">
							<span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
								<KeyRound
									className="size-4 text-muted-foreground"
									aria-hidden
								/>
							</span>
							<div className="min-w-0 space-y-2">
								<p className="text-sm font-medium">{instructions.title}</p>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{instructions.body}
								</p>
								{instructions.bullets?.length ? (
									<ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
										{instructions.bullets.map((item) => (
											<li key={item}>{item}</li>
										))}
									</ul>
								) : null}
								{instructions.note ? (
									<p className="text-xs leading-relaxed text-muted-foreground">
										{instructions.note}
									</p>
								) : null}
							</div>
						</div>
					</div>

					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
						<Button
							type="button"
							variant="secondary"
							onClick={() => setStep("choose")}
							className="w-full sm:w-auto"
						>
							<ArrowLeft className="mr-2 size-4" aria-hidden />
							Back
						</Button>
						<Button
							type="button"
							onClick={() => setStep("connect")}
							className="w-full sm:w-auto"
						>
							Continue
						</Button>
					</div>
				</div>
			) : null}

			{step === "connect" && selected ? (
				<div className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-5 duration-300">
					<div className="flex items-center gap-3 rounded-lg border bg-sidebar/60 p-3">
						<span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
							<Link2 className="size-4 text-muted-foreground" aria-hidden />
						</span>
						<div className="min-w-0">
							<p className="text-sm font-medium">
								Connect {PROVIDER_LABELS[selected]}
							</p>
							<p className="text-xs text-muted-foreground">
								We store credentials sealed at rest. Responses expose last4
								only.
							</p>
						</div>
					</div>

					<div className="space-y-4">
						{selected !== "cloudflare" ? (
							<div className="space-y-2">
								<Label htmlFor="dns-onboard-label">Label</Label>
								<Input
									id="dns-onboard-label"
									value={label}
									onChange={(e) => setLabel(e.target.value)}
									placeholder="Production"
								/>
							</div>
						) : null}

						{selected === "route53" ? (
							<>
								<div className="space-y-2">
									<Label htmlFor="dns-onboard-access-key">Access key ID</Label>
									<Input
										id="dns-onboard-access-key"
										value={accessKeyId}
										onChange={(e) => setAccessKeyId(e.target.value)}
										placeholder="AKIA..."
										autoComplete="off"
										className="font-mono text-sm"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="dns-onboard-secret-key">
										Secret access key
									</Label>
									<Input
										id="dns-onboard-secret-key"
										value={secretAccessKey}
										onChange={(e) => setSecretAccessKey(e.target.value)}
										placeholder="Paste secret access key"
										autoComplete="off"
										className="font-mono text-sm"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="dns-onboard-secret">{secretFieldLabel}</Label>
									<Textarea
										id="dns-onboard-secret"
										value={secret}
										onChange={(e) => setSecret(e.target.value)}
										placeholder='{"accessKeyId":"...","secretAccessKey":"..."}'
										className="min-h-[88px] font-mono text-sm"
									/>
								</div>
							</>
						) : selected === "gcloud" ? (
							<div className="space-y-2">
								<Label htmlFor="dns-onboard-secret">{secretFieldLabel}</Label>
								<Textarea
									id="dns-onboard-secret"
									value={secret}
									onChange={(e) => setSecret(e.target.value)}
									placeholder='{"type":"service_account","project_id":"..."}'
									className="min-h-[140px] font-mono text-sm"
								/>
							</div>
						) : (
							<div className="space-y-2">
								<Label htmlFor="dns-onboard-secret">{secretFieldLabel}</Label>
								<Input
									id="dns-onboard-secret"
									value={secret}
									onChange={(e) => setSecret(e.target.value)}
									placeholder="Paste API token"
									autoComplete="off"
									className="font-mono text-sm"
								/>
							</div>
						)}
					</div>

					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
						<Button
							type="button"
							variant="secondary"
							onClick={() => setStep("credentials")}
							className="w-full sm:w-auto"
						>
							<ArrowLeft className="mr-2 size-4" aria-hidden />
							Back
						</Button>
						<Button
							type="button"
							isLoading={isPending}
							onClick={handleConnect}
							className="w-full sm:w-auto"
						>
							Connect {PROVIDER_LABELS[selected]}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
};
