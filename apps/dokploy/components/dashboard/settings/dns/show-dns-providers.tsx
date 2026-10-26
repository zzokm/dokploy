import { EyeIcon, Globe, Globe2, Loader2, Network, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { toast } from "sonner";
import { dnsProviderIcons } from "@/components/icons/dns-provider-icons";
import { DialogAction } from "@/components/shared/dialog-action";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";
import { HandleDnsProvider } from "./handle-dns-provider";
import { DomainsInventoryTable } from "@/components/dashboard/domains/domains-inventory-table";

const providerLabels: Record<string, string> = {
	cloudflare: "Cloudflare",
	route53: "AWS Route53",
	porkbun: "Porkbun",
	infomaniak: "Infomaniak",
	ovh: "OVHcloud",
};

export const ShowDnsProviders = () => {
	const router = useRouter();
	const activeTab = (router.query.tab as string) === "domains" ? "domains" : "providers";
	const [removingId, setRemovingId] = useState<string | null>(null);
	const { mutateAsync } = api.dnsProvider.remove.useMutation();
	const { data, isPending, refetch } = api.dnsProvider.all.useQuery();
	const { data: permissions } = api.user.getPermissions.useQuery();

	const handleTabChange = (value: string) => {
		void router.push(
			{
				pathname: router.pathname,
				query: { ...router.query, tab: value },
			},
			undefined,
			{ shallow: true },
		);
	};

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl">
				<div className="rounded-xl bg-background shadow-md">
					<Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
						<div className="flex flex-wrap items-center justify-between gap-4 p-6">
							<CardHeader className="flex-1 p-0">
								<CardTitle className="text-xl flex flex-row gap-2">
									<Globe className="size-6 text-muted-foreground self-center" />
									DNS Providers & Domains
								</CardTitle>
								<CardDescription>
									Connect and manage DNS providers to automate domain records, and monitor all hostnames across your infrastructure.
								</CardDescription>
							</CardHeader>
							<div className="flex items-center gap-3">
								<TabsList>
									<TabsTrigger value="providers" className="gap-1.5">
										<Network className="size-4" />
										DNS Providers
									</TabsTrigger>
									<TabsTrigger value="domains" className="gap-1.5">
										<Globe2 className="size-4" />
										All Domains
									</TabsTrigger>
								</TabsList>
								{permissions?.dnsProvider.create && activeTab === "providers" && <HandleDnsProvider />}
							</div>
						</div>

						<TabsContent value="providers" className="m-0">
							<CardContent className="flex min-h-[60vh] flex-col gap-4 border-t py-8">
						{isPending ? (
							<div className="flex flex-1 flex-row items-center justify-center gap-2 text-sm text-muted-foreground">
								<span>Loading...</span>
								<Loader2 className="animate-spin size-4" />
							</div>
						) : data?.length === 0 ? (
							<div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
								<Globe className="size-8 text-muted-foreground" />
								<span className="font-medium text-muted-foreground">
									No DNS providers connected
								</span>
								<span className="max-w-sm text-center text-sm text-muted-foreground">
									Add Cloudflare or Route53 credentials to manage domain records
									without leaving Dokploy.
								</span>
							</div>
						) : (
							<ul className="flex flex-col gap-2">
								{data?.map((provider) => {
									const ProviderIcon = dnsProviderIcons[provider.providerType];
									const href = `/dashboard/settings/dns/${provider.dnsProviderId}`;
									return (
										<li
											key={provider.dnsProviderId}
											className="group relative flex items-center gap-3 rounded-lg border bg-background px-4 py-3 transition-colors duration-150 ease-out hover:border-foreground/20 hover:bg-muted/50 focus-within:border-ring"
										>
											<Link
												href={href}
												aria-label={`View domains for ${provider.name}`}
												className="absolute inset-0 rounded-lg outline-none"
											/>
											<ProviderIcon className="size-7 shrink-0" />
											<div className="flex min-w-0 flex-col gap-0.5">
												<span className="truncate text-sm font-medium">
													{provider.name}
												</span>
												<span className="text-xs text-muted-foreground">
													{providerLabels[provider.providerType] ??
														provider.providerType}
												</span>
											</div>

											<div className="relative z-10 ml-auto flex flex-row items-center gap-1">
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															className="text-muted-foreground"
															asChild
														>
															<Link href={href}>
																<EyeIcon className="size-4" />
																<span className="sr-only">View domains</span>
															</Link>
														</Button>
													</TooltipTrigger>
													<TooltipContent>View domains</TooltipContent>
												</Tooltip>

												{permissions?.dnsProvider.update && (
													<HandleDnsProvider
														dnsProviderId={provider.dnsProviderId}
													/>
												)}
												{permissions?.dnsProvider.delete && (
													<Tooltip>
														<DialogAction
															title="Delete DNS Provider"
															description="Domains that rely on this provider to manage their records will need to be updated manually. Are you sure?"
															type="destructive"
															onClick={async () => {
																setRemovingId(provider.dnsProviderId);
																await mutateAsync({
																	dnsProviderId: provider.dnsProviderId,
																})
																	.then(() => {
																		toast.success("DNS provider deleted");
																		refetch();
																	})
																	.catch(() => {
																		toast.error(
																			"Error deleting the DNS provider",
																		);
																	})
																	.finally(() => setRemovingId(null));
															}}
														>
															<TooltipTrigger asChild>
																<Button
																	variant="ghost"
																	size="icon"
																	className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
																	isLoading={
																		removingId === provider.dnsProviderId
																	}
																>
																	<Trash2 className="size-4" />
																	<span className="sr-only">
																		Delete provider
																	</span>
																</Button>
															</TooltipTrigger>
														</DialogAction>
														<TooltipContent>Delete provider</TooltipContent>
													</Tooltip>
												)}
											</div>
										</li>
									);
								})}
							</ul>
						)}
							</CardContent>
						</TabsContent>

						<TabsContent value="domains" className="m-0">
							<CardContent className="border-t py-6">
								<DomainsInventoryTable />
							</CardContent>
						</TabsContent>
					</Tabs>
				</div>
			</Card>
		</div>
	);
};
