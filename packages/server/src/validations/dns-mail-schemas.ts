import { z } from "zod"

const dnsTypes = z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "SRV"])
const emailHosting = z.enum(["dokploy", "external", "none"])

export const createHostedDomainInput = z.object({
	name: z.string().min(1).max(253),
	isDnsManaged: z.boolean().optional(),
	isMailManaged: z.boolean().optional(),
	emailHosting: emailHosting.optional(),
	serverId: z.string().min(1).nullable().optional(),
})

export const updateHostedDomainInput = createHostedDomainInput.partial().extend({
	id: z.string().min(1),
	catchAllLocalPart: z.string().min(1).max(64).nullable().optional(),
})

export const createDnsRecordInput = z
	.object({
		domainId: z.string().min(1),
		type: dnsTypes,
		recordName: z.string().min(1).max(253),
		content: z.string().min(1).max(4096),
		ttl: z.number().int().min(60).max(86400).optional(),
		priority: z.number().int().min(0).max(65535).optional(),
		srvWeight: z.number().int().min(0).max(65535).optional(),
		srvPort: z.number().int().min(0).max(65535).optional(),
		srvTarget: z.string().min(1).max(253).optional(),
	})
	.superRefine((val, ctx) => {
		if (val.type === "MX" && val.priority === undefined) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "MX records require priority",
				path: ["priority"],
			})
		}
		if (val.type === "SRV") {
			if (
				val.priority === undefined ||
				val.srvWeight === undefined ||
				val.srvPort === undefined ||
				!val.srvTarget
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"SRV records require priority, srvWeight, srvPort, srvTarget",
					path: ["type"],
				})
			}
		}
	})

export const createMailboxInput = z.object({
	domainId: z.string().min(1),
	localPart: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-zA-Z0-9._+-]+$/),
	password: z.string().min(8).max(256),
	/** Omitted = default 5 GiB. `0` = unlimited. */
	quotaBytes: z.number().int().min(0).optional(),
})

const mailboxLocalPartRegex = /^[a-zA-Z0-9._+-]+$/
const aliasSourceLocalPartRegex = /^[a-zA-Z0-9.*_+-]+$/

export const addMailboxDialogSchema = z
	.object({
		localPart: z
			.string()
			.min(1)
			.max(64)
			.regex(mailboxLocalPartRegex),
		password: z.string().min(8).max(256),
		quotaMode: z.enum(["unlimited", "1gb", "5gb", "10gb", "custom"]),
		customQuotaMb: z.string().optional(),
		addAliasToMailbox: z.boolean(),
		aliasSourceLocalPart: z.string().optional(),
		addForwardRedirect: z.boolean(),
		forwardSourceLocalPart: z.string().optional(),
		forwardDestination: z.string().optional(),
	})
	.superRefine((val, ctx) => {
		if (val.quotaMode === "custom") {
			const raw = val.customQuotaMb?.trim() ?? ""
			const n = Number.parseFloat(raw)
			if (!raw || Number.isNaN(n) || n < 1 || n > 1_048_576) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Enter a quota between 1 and 1048576 MB",
					path: ["customQuotaMb"],
				})
			}
		}
		if (val.addAliasToMailbox) {
			const s = val.aliasSourceLocalPart?.trim() ?? ""
			if (!s) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Alias local part is required",
					path: ["aliasSourceLocalPart"],
				})
			} else if (!aliasSourceLocalPartRegex.test(s)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Use letters, numbers, and . _ + - * only",
					path: ["aliasSourceLocalPart"],
				})
			} else if (s === val.localPart.trim()) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Alias must differ from the mailbox username",
					path: ["aliasSourceLocalPart"],
				})
			}
		}
		if (val.addForwardRedirect) {
			const src = val.forwardSourceLocalPart?.trim() ?? ""
			const dest = val.forwardDestination?.trim() ?? ""
			if (!src) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Local part is required",
					path: ["forwardSourceLocalPart"],
				})
			} else if (!aliasSourceLocalPartRegex.test(src)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Use letters, numbers, and . _ + - * only",
					path: ["forwardSourceLocalPart"],
				})
			} else if (src === val.localPart.trim()) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Must differ from the mailbox username",
					path: ["forwardSourceLocalPart"],
				})
			}
			const parsed = z.string().email().safeParse(dest)
			if (!parsed.success) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Valid destination email required",
					path: ["forwardDestination"],
				})
			}
		}
		const aliasSrc = val.addAliasToMailbox
			? (val.aliasSourceLocalPart?.trim() ?? "")
			: ""
		const fwdSrc = val.addForwardRedirect
			? (val.forwardSourceLocalPart?.trim() ?? "")
			: ""
		if (aliasSrc && fwdSrc && aliasSrc === fwdSrc) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Alias and forward address cannot use the same local part",
				path: ["forwardSourceLocalPart"],
			})
		}
	})

export type AddMailboxDialogForm = z.infer<typeof addMailboxDialogSchema>

export type MailboxQuotaMode = AddMailboxDialogForm["quotaMode"]

export const quotaBytesFromMailboxDialog = (
	mode: MailboxQuotaMode,
	customQuotaMb: string | undefined,
): number => {
	const MB = 1024 * 1024
	switch (mode) {
		case "unlimited":
			return 0
		case "1gb":
			return 1024 ** 3
		case "5gb":
			return 5 * 1024 ** 3
		case "10gb":
			return 10 * 1024 ** 3
		case "custom": {
			const n = Number.parseFloat(customQuotaMb?.trim() ?? "0")
			return Math.round(n * MB)
		}
	}
}

export const createMailAliasInput = z.object({
	domainId: z.string().min(1),
	sourceLocalPart: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-zA-Z0-9.*_+-]+$/),
	destination: z.string().email().max(320),
})

/** Client-only: add domain form (subset of create domain). */
export const addDomainFormSchema = z.object({
	name: z.string().min(1).max(253),
})

/** Client-only: DNS record form (A, TXT, MX subset used in UI). */
export const dnsRecordFormSchema = z
	.object({
		type: z.enum(["A", "TXT", "MX"]),
		recordName: z.string().min(1).max(253),
		content: z.string().min(1).max(4096),
		priority: z.string().optional(),
	})
	.superRefine((val, ctx) => {
		if (val.type === "MX") {
			const p = Number.parseInt(val.priority ?? "", 10)
			if (Number.isNaN(p) || p < 0 || p > 65535) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Valid MX priority required",
					path: ["priority"],
				})
			}
		}
	})

export const catchAllFormSchema = z.object({
	catchAllLocalPart: z.string().max(64).nullable().optional(),
})

export const extractTlsFormSchema = z.object({
	domain: z.string().min(1).max(253),
})

export const mailboxFormSchema = createMailboxInput.omit({
	domainId: true,
})

export const aliasFormSchema = createMailAliasInput.omit({
	domainId: true,
})
