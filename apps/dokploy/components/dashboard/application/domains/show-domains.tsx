import {
	ExternalLink,
	GlobeIcon,
	InfoIcon,
	Loader2,
	PenBoxIcon,
	Server,
	Trash2,
} from "lucide-react";
import Link from "next/link";
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
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";
import { AddDomain } from "./handle-domain";
import { DomainConnectionPanel } from "./domain-connection-panel";
import { CloudflareDomainControls } from "./cloudflare-domain-controls";

interface Props {
	id: string;
	type: "application" | "compose";
}

export const ShowDomains = ({ id, type }: Props) => {
	const { data: permissions } = api.user.getPermissions.useQuery();
	const canCreateDomain = permissions?.domain.create ?? false;
	const canDeleteDomain = permissions?.domain.delete ?? false;
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

	const { mutateAsync: deleteDomain, isPending: isRemoving } =
		api.domain.delete.useMutation();

	return (
		<div className="flex w-full max-w-5xl mx-auto flex-col gap-6">
			<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap">
						<div className="flex flex-col gap-1 min-w-0">
							<CardTitle className="text-xl flex flex-row gap-2 items-center">
								<GlobeIcon className="size-6 text-muted-foreground shrink-0" aria-hidden />
								Domains
							</CardTitle>
							<CardDescription>
								Hostnames and paths that route traffic to this deployment through Traefik.
							</CardDescription>
						</div>

						<div className="flex flex-row gap-2 flex-wrap shrink-0">
							{canCreateDomain && data && data?.length > 0 && (
								<AddDomain id={id} type={type}>
									<Button type="button" className="gap-2">
										<GlobeIcon className="size-4 shrink-0" aria-hidden />
										Add domain
									</Button>
								</AddDomain>
							)}
						</div>
					</CardHeader>
					<CardContent className="flex w-full flex-col gap-4 border-t py-6">
					{isLoadingDomains ? (
						<div className="flex w-full flex-col sm:flex-row gap-3 min-h-[40vh] justify-center items-center text-muted-foreground">
							<Loader2 className="size-5 animate-spin shrink-0" aria-hidden />
							<span className="text-sm sm:text-base">Loading domains…</span>
						</div>
					) : data?.length === 0 ? (
						<div className="flex w-full flex-col items-center justify-center gap-4 min-h-[40vh] px-4 text-center">
							<GlobeIcon className="size-10 text-muted-foreground" aria-hidden />
							<p className="text-sm sm:text-base text-muted-foreground max-w-md">
								Add at least one domain so Traefik can route HTTP traffic to your service.
							</p>
							{canCreateDomain && (
								<AddDomain id={id} type={type}>
									<Button type="button" className="gap-2">
										<GlobeIcon className="size-4 shrink-0" aria-hidden />
										Add domain
									</Button>
								</AddDomain>
							)}
						</div>
					) : (
						<div className="grid grid-cols-1 gap-4 xl:grid-cols-2 w-full min-h-[40vh]">
							{data?.map((item) => {
								return (
									<Card
										key={item.domainId}
										className="relative overflow-hidden w-full border border-border bg-card transition-shadow hover:shadow-md rounded-xl h-fit"
									>
										<CardContent className="p-5 sm:p-6">
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
														{canCreateDomain && (
															<AddDomain
																id={id}
																type={type}
																domainId={item.domainId}
															>
																<Button
																	variant="ghost"
																	size="icon"
																	type="button"
																	className="text-muted-foreground hover:text-foreground hover:bg-accent"
																	aria-label="Edit domain"
																>
																	<PenBoxIcon className="size-4" aria-hidden />
																</Button>
															</AddDomain>
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
																	type="button"
																	className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
																	isLoading={isRemoving}
																	aria-label="Delete domain"
																>
																	<Trash2 className="size-4" aria-hidden />
																</Button>
															</DialogAction>
														)}
													</div>
												</div>
												<div className="w-full break-all">
													<Link
														className="inline-flex items-center gap-2 text-base font-semibold text-foreground hover:underline underline-offset-4"
														target="_blank"
														rel="noopener noreferrer"
														href={`${item.https ? "https" : "http"}://${item.host}${item.path}`}
													>
														{item.host}
														<ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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
												</div>

												{!item.host.includes("traefik.me") &&
												item.dnsProvider !== "cloudflare" ? (
													<div className="pt-1">
														<DomainConnectionPanel domainId={item.domainId} />
													</div>
												) : null}

												{item.dnsProvider === "cloudflare" &&
												!item.host.includes("traefik.me") ? (
													<p className="text-sm text-muted-foreground pt-1">
														DNS records are created automatically in Cloudflare. Use
														the controls below to adjust proxying and sync.
													</p>
												) : null}

												{!item.host.includes("traefik.me") ? (
													<CloudflareDomainControls
														domainId={item.domainId}
														currentDnsProvider={item.dnsProvider}
														currentProxied={
															item.cfProxied ?? item.cloudflareProxied ?? true
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
				</div>
			</Card>
		</div>
	);
};
