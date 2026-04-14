import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

type AcmeCertEntry = {
	domain?: { main?: string; sans?: string[] }
	certificate?: string
	key?: string
}

type TraefikAcmeFile = Record<string, { Certificates?: AcmeCertEntry[] } | unknown>

const certMatchesHost = (c: AcmeCertEntry, host: string): boolean => {
	const wanted = host.toLowerCase()
	const main = c.domain?.main?.toLowerCase()
	const sans = c.domain?.sans?.map((s: string) => s.toLowerCase()) ?? []
	return main === wanted || sans.includes(wanted)
}

const collectCertificatesFromAcmeFile = async (
	filePath: string,
): Promise<AcmeCertEntry[]> => {
	const raw = await readFile(filePath, "utf8")
	const data = JSON.parse(raw) as TraefikAcmeFile
	const out: AcmeCertEntry[] = []
	for (const v of Object.values(data)) {
		if (
			v &&
			typeof v === "object" &&
			"Certificates" in v &&
			Array.isArray((v as { Certificates: AcmeCertEntry[] }).Certificates)
		) {
			out.push(...(v as { Certificates: AcmeCertEntry[] }).Certificates)
		}
	}
	return out
}

/**
 * Reads one or more Traefik ACME JSON stores (HTTP-01, DNS-01 Cloudflare, etc.) and writes PEM
 * cert/key for the first matching entry in `domainCandidates` (main or SAN order).
 */
export const extractMailTlsFromAcmeJson = async (opts: {
	/** Tried in order; first readable file wins after merging its certificate entries. */
	acmeJsonPaths: string[]
	/** Tried in order, e.g. `mail.example.com` then apex `example.com` */
	domainCandidates: string[]
	outCertPath: string
	outKeyPath: string
}): Promise<void> => {
	let merged: AcmeCertEntry[] = []
	for (const filePath of opts.acmeJsonPaths) {
		try {
			const part = await collectCertificatesFromAcmeFile(filePath)
			merged = merged.concat(part)
		} catch {
			// Missing or invalid file — try next store
		}
	}

	let match: AcmeCertEntry | undefined
	for (const host of opts.domainCandidates) {
		match = merged.find((c) => certMatchesHost(c, host))
		if (match?.certificate && match.key) {
			break
		}
		match = undefined
	}
	if (!match?.certificate || !match.key) {
		const triedHosts = opts.domainCandidates.join(", ")
		const triedFiles = opts.acmeJsonPaths.join(", ")
		throw new Error(
			`No ACME certificate for any of [${triedHosts}] in stores [${triedFiles}]`,
		)
	}
	await mkdir(path.dirname(opts.outCertPath), { recursive: true })
	await mkdir(path.dirname(opts.outKeyPath), { recursive: true })
	const certBuf = Buffer.from(match.certificate, "base64")
	const keyBuf = Buffer.from(match.key, "base64")
	await writeFile(opts.outCertPath, certBuf, { mode: 0o644 })
	await writeFile(opts.outKeyPath, keyBuf, { mode: 0o600 })
	await chmod(opts.outKeyPath, 0o600)
}
