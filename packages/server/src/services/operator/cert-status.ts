import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { paths } from "../../constants"
import { getContainerLogs } from "../docker"
import { OperatorError, OperatorErrorCode } from "./errors"
import { redactSecrets } from "./redact"

export type CertStatus =
	| "issued"
	| "pending"
	| "failed"
	| "missing"
	| "unknown"

export type HostnameCertStatus = {
	host: string
	status: CertStatus
	resolver: "letsencrypt" | "letsencrypt-cloudflare" | null
	notAfter: string | null
	lastError: string | null
}

type AcmeCertificateEntry = {
	domain?: { main?: string; sans?: string[] }
	Domains?: string[]
	certificate?: string
	key?: string
}

type AcmeFile = {
	[resolver: string]: {
		Certificates?: AcmeCertificateEntry[]
		Account?: unknown
	}
}

const hostMatchesCert = (host: string, entry: AcmeCertificateEntry) => {
	const normalized = host.toLowerCase()
	const mains = [
		entry.domain?.main,
		...(entry.domain?.sans ?? []),
		...(entry.Domains ?? []),
	]
		.filter(Boolean)
		.map((h) => String(h).toLowerCase())
	return mains.includes(normalized)
}

const readAcmeFile = (filePath: string): AcmeFile | null => {
	if (!existsSync(filePath)) return null
	try {
		return JSON.parse(readFileSync(filePath, "utf8")) as AcmeFile
	} catch {
		return null
	}
}

const listCertsFromFile = (
	filePath: string,
	resolver: "letsencrypt" | "letsencrypt-cloudflare",
): AcmeCertificateEntry[] => {
	const data = readAcmeFile(filePath)
	if (!data) return []
	const block = data[resolver] ?? data.letsencrypt ?? Object.values(data)[0]
	if (!block || typeof block !== "object") return []
	return Array.isArray(block.Certificates) ? block.Certificates : []
}

/**
 * Inspect Traefik ACME storage for a hostname. Never returns private keys.
 */
export const getHostnameCertStatus = async (
	host: string,
): Promise<HostnameCertStatus> => {
	const clean = host.replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase()
	if (!clean) {
		throw new OperatorError(
			OperatorErrorCode.validation_error,
			"Hostname is required",
		)
	}

	const { DYNAMIC_TRAEFIK_PATH } = paths()
	const http01Path = path.join(DYNAMIC_TRAEFIK_PATH, "acme.json")
	const dns01Path = path.join(DYNAMIC_TRAEFIK_PATH, "acme-cloudflare.json")

	const httpCerts = listCertsFromFile(http01Path, "letsencrypt")
	const dnsCerts = listCertsFromFile(dns01Path, "letsencrypt-cloudflare")

	const httpHit = httpCerts.find((c) => hostMatchesCert(clean, c))
	if (httpHit?.certificate) {
		return {
			host: clean,
			status: "issued",
			resolver: "letsencrypt",
			notAfter: null,
			lastError: null,
		}
	}

	const dnsHit = dnsCerts.find((c) => hostMatchesCert(clean, c))
	if (dnsHit?.certificate) {
		return {
			host: clean,
			status: "issued",
			resolver: "letsencrypt-cloudflare",
			notAfter: null,
			lastError: null,
		}
	}

	const traefikErrors = await getRecentTraefikAcmeErrors(clean).catch(() => ({
		lines: [] as string[],
		failed: false,
	}))

	if (traefikErrors.failed) {
		return {
			host: clean,
			status: "failed",
			resolver: null,
			notAfter: null,
			lastError: traefikErrors.lines[0] ?? "ACME failure seen in Traefik logs",
		}
	}

	if (traefikErrors.lines.some((l) => /acme|certificate|letsencrypt/i.test(l))) {
		return {
			host: clean,
			status: "pending",
			resolver: null,
			notAfter: null,
			lastError: null,
		}
	}

	return {
		host: clean,
		status: "missing",
		resolver: null,
		notAfter: null,
		lastError: null,
	}
}

/**
 * Remove a hostname's cert from ACME JSON so Traefik re-issues on next challenge.
 * Does not delete Traefik routers — only clears stored cert material.
 */
export const retryHostnameCertificate = async (
	host: string,
): Promise<{ removed: boolean; filesTouched: string[] }> => {
	const clean = host.replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase()
	if (!clean) {
		throw new OperatorError(
			OperatorErrorCode.validation_error,
			"Hostname is required",
		)
	}

	const { DYNAMIC_TRAEFIK_PATH } = paths()
	const files = [
		path.join(DYNAMIC_TRAEFIK_PATH, "acme.json"),
		path.join(DYNAMIC_TRAEFIK_PATH, "acme-cloudflare.json"),
	]
	const filesTouched: string[] = []

	for (const filePath of files) {
		const data = readAcmeFile(filePath)
		if (!data) continue
		let changed = false
		for (const [key, block] of Object.entries(data)) {
			if (!block?.Certificates?.length) continue
			const next = block.Certificates.filter((c) => !hostMatchesCert(clean, c))
			if (next.length !== block.Certificates.length) {
				data[key] = { ...block, Certificates: next }
				changed = true
			}
		}
		if (changed) {
			writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 })
			filesTouched.push(path.basename(filePath))
		}
	}

	// Best-effort Traefik restart so ACME re-runs
	try {
		const { execAsync } = await import("../../utils/process/execAsync")
		await execAsync("docker restart dokploy-traefik").catch(() => {})
	} catch {
		// ignore — operator can reload Traefik manually
	}

	return { removed: filesTouched.length > 0, filesTouched }
}

export const getRecentTraefikAcmeErrors = async (
	host?: string,
	tail = 200,
): Promise<{ lines: string[]; failed: boolean }> => {
	let raw = ""
	try {
		raw = await getContainerLogs("dokploy-traefik", tail, "all", host)
	} catch {
		try {
			raw = await getContainerLogs("dokploy-traefik", tail, "all")
		} catch {
			return { lines: [], failed: false }
		}
	}

	const redacted = redactSecrets(raw)
	const lines = redacted
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.filter((l) =>
			/acme|certificate|letsencrypt|nxdomain|unable to generate|error/i.test(l),
		)

	const relevant = host
		? lines.filter((l) => l.toLowerCase().includes(host.toLowerCase()) || /acme|certificate/i.test(l))
		: lines

	const failed = relevant.some((l) =>
		/error|unable|nxdomain|failed|timeout/i.test(l),
	)

	return { lines: relevant.slice(-40), failed }
}
