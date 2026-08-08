import { resolveHostnameAddresses } from "./dns-resolve"
import { OperatorErrorCode } from "./errors"

export type UrlHealthErrorClass =
	| "ok"
	| "dns_missing"
	| "dns_mismatch"
	| "cert_error"
	| "backend_down"
	| "http_error"
	| "timeout"
	| "unknown"

export type UrlHealthResult = {
	host: string
	url: string
	dns: {
		ok: boolean
		addresses: string[]
		errorClass: UrlHealthErrorClass | null
		error: string | null
	}
	https: {
		ok: boolean
		status: number | null
		errorClass: UrlHealthErrorClass | null
		error: string | null
	}
	overall: UrlHealthErrorClass
}

const classifyFetchError = (e: unknown): UrlHealthErrorClass => {
	const msg = e instanceof Error ? e.message : String(e)
	if (/ENOTFOUND|getaddrinfo|NXDOMAIN/i.test(msg)) return "dns_missing"
	if (/CERT|SSL|TLS|unable to verify|certificate/i.test(msg)) return "cert_error"
	if (/ECONNREFUSED|ECONNRESET|socket hang up/i.test(msg)) return "backend_down"
	if (/timeout|ETIMEDOUT|AbortError/i.test(msg)) return "timeout"
	return "unknown"
}

export const checkPublicUrlHealth = async (input: {
	host: string
	path?: string
	expectedIp?: string | null
	timeoutMs?: number
}): Promise<UrlHealthResult> => {
	const host =
		input.host.replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase() || ""
	const pathPart = input.path?.startsWith("/") ? input.path : `/${input.path ?? ""}`
	const url = `https://${host}${pathPart === "/" ? "/" : pathPart}`
	const expectedIp = input.expectedIp?.trim() || null

	let addresses: string[] = []
	let dnsOk = false
	let dnsErrorClass: UrlHealthErrorClass | null = null
	let dnsError: string | null = null

	try {
		addresses = await resolveHostnameAddresses(host)
		if (expectedIp && !addresses.includes(expectedIp)) {
			dnsOk = false
			dnsErrorClass = "dns_mismatch"
			dnsError = `Resolves to ${addresses.join(", ")}; expected ${expectedIp}`
		} else {
			dnsOk = addresses.length > 0
		}
	} catch (e) {
		dnsOk = false
		dnsErrorClass = "dns_missing"
		dnsError = e instanceof Error ? e.message : "DNS lookup failed"
	}

	let httpsOk = false
	let status: number | null = null
	let httpsErrorClass: UrlHealthErrorClass | null = null
	let httpsError: string | null = null

	if (dnsOk) {
		const controller = new AbortController()
		const timer = setTimeout(
			() => controller.abort(),
			input.timeoutMs ?? 15_000,
		)
		try {
			const res = await fetch(url, {
				method: "GET",
				redirect: "manual",
				signal: controller.signal,
			})
			status = res.status
			if (status >= 200 && status < 500) {
				// 2xx/3xx/4xx mean TLS + Traefik reached something; 5xx is backend_down
				httpsOk = status < 500
				if (!httpsOk) {
					httpsErrorClass = "backend_down"
					httpsError = `HTTP ${status}`
				}
			} else {
				httpsErrorClass = "http_error"
				httpsError = `HTTP ${status}`
			}
		} catch (e) {
			httpsErrorClass = classifyFetchError(e)
			httpsError = e instanceof Error ? e.message : "HTTPS check failed"
		} finally {
			clearTimeout(timer)
		}
	} else {
		httpsErrorClass = dnsErrorClass ?? "dns_missing"
		httpsError = dnsError
	}

	const overall: UrlHealthErrorClass = !dnsOk
		? (dnsErrorClass ?? "dns_missing")
		: !httpsOk
			? (httpsErrorClass ?? "unknown")
			: "ok"

	return {
		host,
		url,
		dns: {
			ok: dnsOk,
			addresses,
			errorClass: dnsErrorClass,
			error: dnsError,
		},
		https: {
			ok: httpsOk,
			status,
			errorClass: httpsErrorClass,
			error: httpsError,
		},
		overall,
	}
}

export const mapHealthToOperatorCode = (
	overall: UrlHealthErrorClass,
): string => {
	switch (overall) {
		case "dns_missing":
			return OperatorErrorCode.dns_missing
		case "dns_mismatch":
			return OperatorErrorCode.dns_mismatch
		case "cert_error":
			return OperatorErrorCode.cert_failed
		case "backend_down":
			return OperatorErrorCode.backend_down
		default:
			return overall
	}
}
