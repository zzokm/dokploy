const SECRET_PATTERNS: Array<{ re: RegExp; replace: string }> = [
	{
		re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
		replace: "Bearer [REDACTED]",
	},
	{
		re: /(?<=(?:api[_-]?key|token|password|secret|cf_dns_api_token)\s*[=:]\s*)[^\s"'&,;]+/gi,
		replace: "[REDACTED]",
	},
	{
		re: /\b(sk|rk|pk|api)[_-][A-Za-z0-9]{16,}\b/g,
		replace: "[REDACTED_KEY]",
	},
	{
		re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
		replace: "[REDACTED_PRIVATE_KEY]",
	},
]

export const redactSecrets = (input: string): string => {
	let out = input
	for (const { re, replace } of SECRET_PATTERNS) {
		out = out.replace(re, replace)
	}
	return out
}

export const redactDeep = <T>(value: T): T => {
	if (typeof value === "string") {
		return redactSecrets(value) as T
	}
	if (Array.isArray(value)) {
		return value.map((v) => redactDeep(v)) as T
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (
				/token|password|secret|privateKey|apiKey|encryption/i.test(k) &&
				typeof v === "string"
			) {
				out[k] = "[REDACTED]"
			} else {
				out[k] = redactDeep(v)
			}
		}
		return out as T
	}
	return value
}
