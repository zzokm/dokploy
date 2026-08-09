"use client";

import type { DnsProviderOptionId } from "@/components/dashboard/domains/dns-connectable-providers";
import { DnsProviderLogo } from "@/components/dashboard/domains/logos/dns-provider-logo";
import { cn } from "@/lib/utils";

type DnsProviderLogoChromeProps = {
	id: DnsProviderOptionId;
	className?: string;
};

/**
 * Nested logo frame shared by the provider picker and onboarding step headers:
 * outer `rounded-md` + `p-1`, inner `rounded-sm` overflow clip.
 */
export const DnsProviderLogoChrome = ({
	id,
	className,
}: DnsProviderLogoChromeProps) => {
	return (
		<span
			className={cn(
				"flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background p-1",
				className,
			)}
		>
			<span className="flex size-full items-center justify-center overflow-hidden rounded-sm">
				<DnsProviderLogo id={id} className="size-full" />
			</span>
		</span>
	);
};
