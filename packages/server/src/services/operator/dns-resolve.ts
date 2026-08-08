import dns from "node:dns/promises"
import { OperatorError, OperatorErrorCode } from "./errors"

export type DnsResolveResult = {
	ok: true
	host: string
	addresses: string[]
	matchedExpected: boolean
	expectedIp: string | null
}

const LOOKUP_FAILURE = new Set(["ENOTFOUND", "ENODATA", "ESERVFAIL", "EREFUSED"])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const resolveHostnameAddresses = async (
	host: string,
): Promise<string[]> => {
	const clean = host.replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase()
	if (!clean) {
		throw new OperatorError(
			OperatorErrorCode.validation_error,
			"Hostname is required",
		)
	}

	try {
		const results = await dns.lookup(clean, { all: true, verbatim: true })
		return [...new Set(results.map((r) => r.address))]
	} catch (e) {
		const code =
			e && typeof e === "object" && "code" in e
				? String((e as { code?: string }).code)
				: ""
		if (LOOKUP_FAILURE.has(code)) {
			throw new OperatorError(
				OperatorErrorCode.dns_missing,
				`Hostname ${clean} does not resolve (DNS ${code || "lookup failure"})`,
				{ host: clean, dnsCode: code },
			)
		}
		throw new OperatorError(
			OperatorErrorCode.dns_missing,
			`Failed to resolve ${clean}`,
			{ host: clean },
		)
	}
}

/**
 * Poll public DNS until the hostname resolves, optionally to an expected IP.
 * Does not treat Cloudflare CDN anycast IPs as a match when expectedIp is set —
 * callers that use proxied records should pass expectedIp=null and only wait for
 * any successful resolution.
 */
export const waitForHostnameResolution = async (input: {
	host: string
	expectedIp?: string | null
	timeoutMs?: number
	intervalMs?: number
}): Promise<DnsResolveResult> => {
	const timeoutMs = input.timeoutMs ?? 120_000
	const intervalMs = input.intervalMs ?? 3_000
	const expectedIp = input.expectedIp?.trim() || null
	const deadline = Date.now() + timeoutMs
	let lastError: OperatorError | null = null

	while (Date.now() < deadline) {
		try {
			const addresses = await resolveHostnameAddresses(input.host)
			if (addresses.length === 0) {
				lastError = new OperatorError(
					OperatorErrorCode.dns_missing,
					`Hostname ${input.host} resolved to no addresses`,
					{ host: input.host },
				)
			} else if (expectedIp && !addresses.includes(expectedIp)) {
				lastError = new OperatorError(
					OperatorErrorCode.dns_mismatch,
					`Hostname ${input.host} resolves to ${addresses.join(", ")} but expected ${expectedIp}`,
					{ host: input.host, addresses, expectedIp },
				)
			} else {
				return {
					ok: true,
					host: input.host.replace(/^https?:\/\//, "").split("/")[0] || input.host,
					addresses,
					matchedExpected: expectedIp ? addresses.includes(expectedIp) : true,
					expectedIp,
				}
			}
		} catch (e) {
			if (e instanceof OperatorError) {
				lastError = e
			} else {
				lastError = new OperatorError(
					OperatorErrorCode.dns_missing,
					e instanceof Error ? e.message : "DNS resolve failed",
				)
			}
		}
		await sleep(intervalMs)
	}

	throw (
		lastError ??
		new OperatorError(
			OperatorErrorCode.timeout,
			`Timed out after ${timeoutMs}ms waiting for DNS on ${input.host}`,
			{ host: input.host, expectedIp },
		)
	)
}
