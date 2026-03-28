import { z } from "zod"

const domainLabel = /^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/

export const normalizeDomainName = (raw: string): string => {
	const trimmed = raw.trim().toLowerCase()
	if (!trimmed || trimmed.includes("..") || trimmed.startsWith(".")) {
		throw new Error("Invalid domain name")
	}
	return trimmed
}

export const hostedFqdnSchema = z
	.string()
	.min(1)
	.max(253)
	.transform((s) => normalizeDomainName(s))
	.refine((s) => domainLabel.test(s) || s.includes("."), "Invalid FQDN")
