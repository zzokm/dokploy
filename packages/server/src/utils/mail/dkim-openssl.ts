import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export type DkimKeyResult = {
	selector: string
	privateKeyPath: string
	dnsTxtValue: string
}

/** Builds the DKIM TXT record body (`v=DKIM1; k=rsa; p=...`) from an RSA public key PEM. */
export const dnsTxtFromPublicPem = (pubPem: string): string => {
	const b64 = pubPem
		.replace(/-----BEGIN PUBLIC KEY-----/g, "")
		.replace(/-----END PUBLIC KEY-----/g, "")
		.replace(/\s+/g, "")
	return `v=DKIM1; k=rsa; p=${b64}`
}

export const readDkimDnsTxtFromPublicKeyFile = async (
	publicKeyPath: string,
): Promise<string> => {
	const pubPem = await readFile(publicKeyPath, "utf8")
	return dnsTxtFromPublicPem(pubPem)
}

/**
 * Generates a DKIM keypair via openssl; stores private key on disk. Public DNS value is the full DKIM TXT body for `{selector}._domainkey`.
 */
export const generateDkimKeyPair = async (opts: {
	keysDir: string
	domain: string
	selector?: string
}): Promise<DkimKeyResult> => {
	const selector = opts.selector ?? "default"
	await mkdir(opts.keysDir, { recursive: true })
	const base = path.join(opts.keysDir, `${opts.domain}.${selector}`)
	const privatePath = `${base}.private.pem`
	const publicPath = `${base}.public.pem`

	await runOpenssl([
		"genrsa",
		"-out",
		privatePath,
		"2048",
	])
	await runOpenssl([
		"rsa",
		"-in",
		privatePath,
		"-pubout",
		"-out",
		publicPath,
		"-outform",
		"PEM",
	])

	const pubPem = await readFile(publicPath, "utf8")
	const dnsTxtValue = dnsTxtFromPublicPem(pubPem)

	await writeFile(`${base}.dns.txt`, `${selector}._domainkey TXT ${dnsTxtValue}\n`, {
		mode: 0o600,
	})

	return {
		selector,
		privateKeyPath: privatePath,
		dnsTxtValue,
	}
}

const runOpenssl = (args: string[]): Promise<void> =>
	new Promise((resolve, reject) => {
		const p = spawn("openssl", args, { stdio: "ignore" })
		p.on("error", reject)
		p.on("close", (code) => {
			if (code === 0) {
				resolve()
				return
			}
			reject(new Error(`openssl exited ${code}`))
		})
	})
