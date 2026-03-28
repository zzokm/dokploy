import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

type AcmeCertEntry = {
	domain?: { main?: string; sans?: string[] }
	certificate?: string
	key?: string
}

type TraefikAcme = {
	letsencrypt?: {
		Account?: unknown
		Certificates?: AcmeCertEntry[]
	}
}

const certMatchesHost = (c: AcmeCertEntry, host: string): boolean => {
	const wanted = host.toLowerCase()
	const main = c.domain?.main?.toLowerCase()
	const sans =
		c.domain?.sans?.map((s: string) => s.toLowerCase()) ?? []
	return main === wanted || sans.includes(wanted)
}

/**
 * Reads Dokploy/Traefik's `acme.json` (same file Traefik persists via `certificatesResolvers`)
 * and writes PEM cert/key for the first matching entry in `domainCandidates` (main or SAN order).
 */
export const extractMailTlsFromAcmeJson = async (opts: {
	acmeJsonPath: string
	/** Tried in order, e.g. `mail.example.com` then apex `example.com` */
	domainCandidates: string[]
	outCertPath: string
	outKeyPath: string
}): Promise<void> => {
	const raw = await readFile(opts.acmeJsonPath, "utf8")
	const data = JSON.parse(raw) as TraefikAcme
	const certs: AcmeCertEntry[] = data.letsencrypt?.Certificates ?? []
	let match: AcmeCertEntry | undefined
	for (const host of opts.domainCandidates) {
		match = certs.find((c) => certMatchesHost(c, host))
		if (match?.certificate && match.key) {
			break
		}
		match = undefined
	}
	if (!match?.certificate || !match.key) {
		const tried = opts.domainCandidates.join(", ")
		throw new Error(`No ACME certificate in Traefik store for any of: ${tried}`)
	}
	await mkdir(path.dirname(opts.outCertPath), { recursive: true })
	await mkdir(path.dirname(opts.outKeyPath), { recursive: true })
	const certBuf = Buffer.from(match.certificate, "base64")
	const keyBuf = Buffer.from(match.key, "base64")
	await writeFile(opts.outCertPath, certBuf, { mode: 0o644 })
	await writeFile(opts.outKeyPath, keyBuf, { mode: 0o600 })
	await chmod(opts.outKeyPath, 0o600)
}
