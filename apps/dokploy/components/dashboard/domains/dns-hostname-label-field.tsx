import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

type CloudflareHostnameLabelFieldProps = {
	label?: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	suffix: string;
	disabled?: boolean;
	ariaLabel: string;
	inputClassName?: string;
};

export const CloudflareHostnameLabelField = ({
	label = "Hostname label",
	value,
	onChange,
	placeholder,
	suffix,
	disabled = false,
	ariaLabel,
	inputClassName,
}: CloudflareHostnameLabelFieldProps) => {
	return (
		<div className="w-full space-y-2">
			<div className="flex items-center gap-2">
				<p className="text-sm font-medium">{label}</p>
				<TooltipProvider delayDuration={0}>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="size-5 rounded-full text-muted-foreground hover:text-foreground"
								aria-label="Cloudflare hostname label help"
							>
								<HelpCircle className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent
							side="top"
							sideOffset={6}
							className="max-w-[260px] text-xs leading-relaxed"
						>
							<p>
								Enter the subdomain here. Use <code>@</code> to use the root
								domain itself.
							</p>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
			<div className="w-full">
				<div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch">
					<Input
						value={value}
						onChange={(e) => onChange(e.target.value)}
						placeholder={placeholder}
						disabled={disabled}
						aria-label={ariaLabel}
						className={`min-w-0 rounded-r-none border-r-0 ${inputClassName ?? ""}`.trim()}
					/>
					<div className="flex min-w-0 items-center justify-end rounded-r-lg border border-l border-input bg-muted/40 px-3 text-sm text-muted-foreground">
						<span className="max-w-full truncate text-right">{suffix}</span>
					</div>
				</div>
			</div>
		</div>
	);
};
