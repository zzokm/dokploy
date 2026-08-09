"use client";

import { Link2 } from "lucide-react";
import { useRouter } from "next/router";
import { type ReactNode, useMemo, useState } from "react";
import { buildAttachDomainHref } from "@/components/dashboard/domains/domain-inventory-utils";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";

type ServiceOption = {
	key: string;
	label: string;
	projectId: string;
	environmentId: string;
	applicationId: string | null;
	composeId: string | null;
};

/**
 * Pick a project service and open create-domain prefilled with the DNS hostname.
 */
export const AttachDomainFromHostnameDialog = ({
	host,
	suggestedServiceName,
	trigger,
}: {
	host: string;
	suggestedServiceName?: string | null;
	trigger?: ReactNode;
}) => {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [selectedKey, setSelectedKey] = useState("");
	const { data: projects, isPending } = api.project.all.useQuery(undefined, {
		enabled: open,
	});

	const options = useMemo(() => {
		const list: ServiceOption[] = [];
		for (const project of projects ?? []) {
			for (const env of project.environments ?? []) {
				for (const app of env.applications ?? []) {
					list.push({
						key: `app:${app.applicationId}`,
						label: `${project.name} / ${env.name} / ${app.name}`,
						projectId: project.projectId,
						environmentId: env.environmentId,
						applicationId: app.applicationId,
						composeId: null,
					});
				}
				for (const c of env.compose ?? []) {
					list.push({
						key: `compose:${c.composeId}`,
						label: `${project.name} / ${env.name} / ${c.name} (compose)`,
						projectId: project.projectId,
						environmentId: env.environmentId,
						applicationId: null,
						composeId: c.composeId,
					});
				}
			}
		}
		list.sort((a, b) => a.label.localeCompare(b.label));
		return list;
	}, [projects]);

	const continueAttach = () => {
		const option = options.find((o) => o.key === selectedKey);
		if (!option) return;
		const href = buildAttachDomainHref({
			projectId: option.projectId,
			environmentId: option.environmentId,
			applicationId: option.applicationId,
			composeId: option.composeId,
			host,
			suggestedServiceName: option.composeId
				? suggestedServiceName
				: null,
		});
		if (!href) return;
		setOpen(false);
		void router.push(href);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				{trigger ?? (
					<Button type="button" variant="outline" size="sm" className="h-8">
						<Link2 className="mr-1.5 size-3.5" aria-hidden />
						Attach domain
					</Button>
				)}
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Attach domain</DialogTitle>
					<DialogDescription>
						Create a Traefik domain for{" "}
						<span className="font-mono text-foreground">{host}</span> on a
						project service. Managed DNS stays DNS-first when a provider is
						connected.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2 py-2">
					<p className="text-sm text-muted-foreground">Service</p>
					<Select
						value={selectedKey}
						onValueChange={setSelectedKey}
						disabled={isPending || !options.length}
					>
						<SelectTrigger>
							<SelectValue
								placeholder={
									isPending
										? "Loading services…"
										: options.length
											? "Select application or compose"
											: "No services found"
								}
							/>
						</SelectTrigger>
						<SelectContent>
							{options.map((option) => (
								<SelectItem key={option.key} value={option.key}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => setOpen(false)}
					>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={!selectedKey}
						onClick={continueAttach}
					>
						Continue
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
