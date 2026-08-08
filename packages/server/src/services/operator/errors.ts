/**
 * Stable machine-readable error codes for MCP / operator clients.
 * Messages stay human-readable; `code` is what clients should branch on.
 */

export const OperatorErrorCode = {
	unauthorized: "unauthorized",
	dns_missing: "dns_missing",
	dns_mismatch: "dns_mismatch",
	cert_failed: "cert_failed",
	cert_pending: "cert_pending",
	backend_down: "backend_down",
	/** @deprecated Prefer dns_provider_unconfigured — kept for MCP compat. */
	cloudflare_unconfigured: "cloudflare_unconfigured",
	dns_provider_unconfigured: "dns_provider_unconfigured",
	dns_rate_limited: "dns_rate_limited",
	/** Attempt to disable CF proxy / violate forcesProxy policy. */
	dns_proxy_policy: "dns_proxy_policy",
	zone_not_found: "zone_not_found",
	validation_error: "validation_error",
	not_found: "not_found",
	timeout: "timeout",
	internal: "internal",
} as const

export type OperatorErrorCode =
	(typeof OperatorErrorCode)[keyof typeof OperatorErrorCode]

export class OperatorError extends Error {
	readonly code: OperatorErrorCode
	readonly details?: Record<string, unknown>

	constructor(
		code: OperatorErrorCode,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message)
		this.name = "OperatorError"
		this.code = code
		this.details = details
	}

	toJSON() {
		return {
			ok: false as const,
			code: this.code,
			message: this.message,
			...(this.details ? { details: this.details } : {}),
		}
	}
}

export const isOperatorError = (e: unknown): e is OperatorError =>
	e instanceof OperatorError
