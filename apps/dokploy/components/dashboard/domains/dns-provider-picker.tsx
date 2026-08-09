"use client";

import { Check } from "lucide-react";
import {
	type ConnectableDnsProviderId,
	type DnsProviderOption,
	DNS_PROVIDER_OPTIONS,
} from "@/components/dashboard/domains/dns-connectable-providers";
import { DnsProviderLogo } from "@/components/dashboard/domains/logos/dns-provider-logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type DnsProviderPickerProps = {
	value: ConnectableDnsProviderId | null;
	onChange: (id: ConnectableDnsProviderId) => void;
	options?: DnsProviderOption[];
	className?: string;
	/** Accessible label for the grid. */
	"aria-label"?: string;
};

/**
 * Shared DNS provider grid used by Domains onboarding and Web Server settings.
 * Six options in `grid-cols-2` yields three compact rows without widening the page card.
 */
export const DnsProviderPicker = ({
	value,
	onChange,
	options = DNS_PROVIDER_OPTIONS,
	className,
	"aria-label": ariaLabel = "DNS providers",
}: DnsProviderPickerProps) => {
	return (
		<div
			className={cn("grid grid-cols-2 gap-2", className)}
			aria-label={ariaLabel}
			role="listbox"
			aria-orientation="horizontal"
		>
			{options.map((provider, index) => {
				const disabled = !provider.ready;
				const isSelected =
					!disabled && value !== null && value === provider.id;
				return (
					<button
						key={provider.id}
						type="button"
						role="option"
						aria-selected={isSelected}
						aria-disabled={disabled}
						disabled={disabled}
						onClick={() => {
							if (!provider.ready) return;
							onChange(provider.id as ConnectableDnsProviderId);
						}}
						className={cn(
							"relative flex h-14 animate-in fade-in-0 slide-in-from-bottom-1 flex-row items-stretch overflow-hidden rounded-lg border bg-sidebar/60 p-0 text-left duration-200 fill-mode-both transition-colors",
							!disabled && "hover:bg-muted/30 hover:shadow-sm",
							isSelected &&
								"border-foreground/30 bg-background ring-1 ring-foreground/15",
							disabled && "cursor-not-allowed opacity-60",
						)}
						style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
					>
						<span className="mb-2 ml-2 mt-2 flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background p-1">
							<span className="flex size-full items-center justify-center overflow-hidden rounded-sm">
								<DnsProviderLogo id={provider.id} className="size-full" />
							</span>
						</span>
						<span className="min-w-0 flex-1 space-y-0.5 self-center pl-2 pr-3">
							<span className="block truncate text-sm font-medium leading-snug text-foreground">
								{provider.name}
							</span>
							{disabled ? (
								<Badge variant="outline" className="text-[10px]">
									{provider.comingSoonLabel ?? "Coming soon"}
								</Badge>
							) : null}
						</span>
						{isSelected ? (
							<span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-foreground text-background">
								<Check className="size-3" aria-hidden />
							</span>
						) : null}
					</button>
				);
			})}
		</div>
	);
};
