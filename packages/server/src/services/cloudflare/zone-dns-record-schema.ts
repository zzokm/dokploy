import { z } from "zod"
import type { CloudflareDnsRecordType } from "./dns-record-utils"

const PROXYABLE_TYPES = new Set<CloudflareDnsRecordType>(["A", "AAAA", "CNAME"])

export const zoneDnsRecordTypeSchema = z.enum(["A", "AAAA", "CNAME", "TXT", "MX"])

export const zoneDnsRecordInputSchema = z
	.object({
		type: zoneDnsRecordTypeSchema,
		name: z.string().trim().min(1).max(255),
		content: z.string().trim().min(1).max(2048),
		ttl: z.union([z.literal(1), z.number().int().min(60).max(86400)]),
		proxied: z.boolean().optional(),
		priority: z.number().int().min(0).max(65535).optional(),
	})
	.superRefine((data, ctx) => {
		if (data.type === "MX" && data.priority === undefined) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["priority"],
				message: "MX records require a priority",
			})
		}
		if (data.proxied && !PROXYABLE_TYPES.has(data.type)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["proxied"],
				message: "Only A, AAAA, and CNAME records can be proxied",
			})
		}
	})

export type ZoneDnsRecordInput = z.infer<typeof zoneDnsRecordInputSchema>

export const isProxyableDnsRecordType = (type: string) =>
	PROXYABLE_TYPES.has(type as CloudflareDnsRecordType)
