import { z } from "zod"

const dnsTypes = z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "SRV"])

export const createHostedDomainInput = z.object({
	name: z.string().min(1).max(253),
	isDnsManaged: z.boolean().optional(),
	isMailManaged: z.boolean().optional(),
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
	quotaBytes: z.number().int().positive().optional(),
})

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
