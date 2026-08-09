"use client";

import { ArrowLeft, Check, KeyRound, Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type ConnectableDnsProviderId,
	DNS_PROVIDER_LABELS,
	DNS_PROVIDER_OPTIONS,
} from "@/components/dashboard/domains/dns-connectable-providers";
import { DnsProviderPicker } from "@/components/dashboard/domains/dns-provider-picker";
import { DnsProviderLogo } from "@/components/dashboard/domains/logos/dns-provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

type ConnectableProvider = ConnectableDnsProviderId;

const PROVIDERS = DNS_PROVIDER_OPTIONS;
const PROVIDER_LABELS = DNS_PROVIDER_LABELS;

const STEPS = [
	{ id: "choose", title: "Choose provider" },
	{ id: "credentials", title: "Create credentials" },
	{ id: "connect", title: "Connect" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

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
	ns1: {
		title: "Create an NS1 API key",
		body: "Open the NS1 portal, then Account settings → API keys → Create key.",
		bullets: [
			"Grant zone view and manage permissions",
			"Grant record create, update, and delete permissions",
			"Copy the key once. NS1 only shows it at creation time.",
		],
		note: "Managed NS1 domains use HTTP-01 certificates by default. NS1 has no CDN proxy.",
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
			toast.error(
				selected === "ns1" ? "API key is required" : "API token is required",
			);
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
				: selected === "ns1"
					? "API key"
					: "API token";

	return (
		<div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-2">
			<div className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<p className="text-base font-medium text-foreground">
						{STEPS[stepIndex]?.title}
					</p>
					<span className="text-xs text-muted-foreground">
						Step {stepIndex + 1} of {STEPS.length}
					</span>
				</div>
				<ol className="flex w-full items-center" aria-label="Onboarding steps">
					{STEPS.map((s, index) => {
						const active = index === stepIndex;
						const done = index < stepIndex;
						const isLast = index === STEPS.length - 1;
						return (
							<li
								key={s.id}
								className={cn(
									"flex items-center",
									!isLast && "min-w-0 flex-1",
								)}
							>
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
								{!isLast ? (
									<span
										className={cn(
											"mx-2 h-px min-w-0 flex-1",
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

					<DnsProviderPicker
						value={selected}
						onChange={setSelected}
						options={PROVIDERS}
					/>

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
							<DnsProviderLogo id={selected} />
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
