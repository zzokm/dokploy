const SECRET_PATTERNS: Array<{ re: RegExp; replace: string }> = [
	{
		re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
		replace: "Bearer [REDACTED]",
	},
	{
		re: /(?<=(?:api[_-]?key|token|password|secret|cf_dns_api_token|do_auth_token|hetzner_api_key|aws_secret_access_key|aws_access_key_id)\s*[=:]\s*)[^\s"'&,;]+/gi,
		replace: "[REDACTED]",
	},
	{
		re: /\bCF_DNS_API_TOKEN=[^\s"'&]+/gi,
		replace: "CF_DNS_API_TOKEN=[REDACTED]",
	},
	{
		re: /\bDO_AUTH_TOKEN=[^\s"'&]+/gi,
		replace: "DO_AUTH_TOKEN=[REDACTED]",
	},
	{
		re: /\bHETZNER_API_KEY=[^\s"'&]+/gi,
		replace: "HETZNER_API_KEY=[REDACTED]",
	},
	{
		re: /\bAWS_SECRET_ACCESS_KEY=[^\s"'&]+/gi,
		replace: "AWS_SECRET_ACCESS_KEY=[REDACTED]",
	},
	{
		re: /\bAWS_ACCESS_KEY_ID=[^\s"'&]+/gi,
		replace: "AWS_ACCESS_KEY_ID=[REDACTED]",
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
				/token|password|secret|privateKey|apiKey|encryption|authToken|accessKey/i.test(
					k,
				) &&
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
