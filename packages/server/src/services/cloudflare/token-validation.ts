import { CloudflareApiRequestError, cloudflareFetch } from "./client"
import { listCloudflareZones } from "./zones"

export type CloudflareTokenValidation = {
	ok: boolean
	tokenActive: boolean
	zoneRead: boolean
	dnsRead: boolean
	/**
	 * Cloudflare does not expose write scopes on `/user/tokens/verify` for
	 * dashboard tokens. We never create/delete a probe record — write stays
	 * unverified unless a non-destructive signal exists.
	 */
	dnsWrite: "verified" | "unverified" | "missing"
	message: string
	warning?: string
}

type TokenVerifyResult = {
	id: string
	status: string
}

const friendlyError = (e: unknown, fallback: string) => {
	if (e instanceof CloudflareApiRequestError) {
		const msg = e.message || fallback
		if (/authentication|invalid|unauthorized|403|401/i.test(msg)) {
			return "Cloudflare rejected this API token. Check that it is active and has the required permissions."
		}
		if (/permission|not authorized|forbidden/i.test(msg)) {
			return "This API token is missing a required permission. Grant Zone → Zone → Read and Zone → DNS → Edit."
		}
		return msg.length > 180 ? fallback : msg
	}
	if (e instanceof Error && e.message && e.message.length < 180) {
		return e.message
	}
	return fallback
}

const listDnsRecordsSample = async (token: string, zoneId: string) => {
	return await cloudflareFetch<unknown[]>({
		token,
		method: "GET",
		path: `/zones/${zoneId}/dns_records`,
		query: { per_page: 1, page: 1 },
	})
}

/**
 * Validate a Cloudflare API token without mutating DNS.
 * Proves: token active, Zone Read, DNS Read (when a zone exists).
 * DNS Edit/write cannot be proven without a write — surface a clear warning.
 */
export const validateCloudflareApiToken = async (
	token: string,
): Promise<CloudflareTokenValidation> => {
	const trimmed = token.trim()
	if (!trimmed) {
		return {
			ok: false,
			tokenActive: false,
			zoneRead: false,
			dnsRead: false,
			dnsWrite: "missing",
			message: "API token is required",
		}
	}

	let verify: TokenVerifyResult
	try {
		verify = await cloudflareFetch<TokenVerifyResult>({
			token: trimmed,
			method: "GET",
			path: "/user/tokens/verify",
		})
	} catch (e) {
		return {
			ok: false,
			tokenActive: false,
			zoneRead: false,
			dnsRead: false,
			dnsWrite: "missing",
			message: friendlyError(e, "Cloudflare token validation failed"),
		}
	}

	const tokenActive = (verify?.status || "").toLowerCase() === "active"
	if (!tokenActive) {
		return {
			ok: false,
			tokenActive: false,
			zoneRead: false,
			dnsRead: false,
			dnsWrite: "missing",
			message: "This Cloudflare API token is not active",
		}
	}

	let zones: Awaited<ReturnType<typeof listCloudflareZones>> = []
	try {
		zones = await listCloudflareZones({ token: trimmed })
	} catch {
		return {
			ok: false,
			tokenActive: true,
			zoneRead: false,
			dnsRead: false,
			dnsWrite: "missing",
			message:
				"Token is active but cannot read zones. Grant Zone → Zone → Read.",
		}
	}

	const zoneRead = true
	let dnsRead = false

	if (zones.length === 0) {
		return {
			ok: true,
			tokenActive: true,
			zoneRead,
			dnsRead: false,
			dnsWrite: "unverified",
			message: "Token can read zones, but no zones were returned yet",
			warning:
				"DNS Read/Edit could not be verified because this account has no zones. After adding a zone, confirm Zone → DNS → Edit (includes read/write) on the token.",
		}
	}

	const sampleZone = zones.find((z) => z.status === "active") ?? zones[0]
	if (!sampleZone) {
		return {
			ok: true,
			tokenActive: true,
			zoneRead,
			dnsRead: false,
			dnsWrite: "unverified",
			message: "Token can list zones",
			warning:
				"DNS permissions could not be verified. Ensure Zone → DNS → Edit (includes read/write) is granted.",
		}
	}

	try {
		await listDnsRecordsSample(trimmed, sampleZone.id)
		dnsRead = true
	} catch (e) {
		return {
			ok: false,
			tokenActive: true,
			zoneRead,
			dnsRead: false,
			dnsWrite: "missing",
			message: friendlyError(
				e,
				"Token can read zones but cannot read DNS records. Grant Zone → DNS → Edit (includes read).",
			),
		}
	}

	return {
		ok: true,
		tokenActive: true,
		zoneRead,
		dnsRead,
		dnsWrite: "unverified",
		message: "Token verified for Zone Read and DNS Read",
		warning:
			"DNS write (Edit) cannot be confirmed without creating a DNS record. Ensure the token includes Zone → DNS → Edit, which covers read and write.",
	}
}
