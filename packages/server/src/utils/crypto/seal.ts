import crypto from "node:crypto"

const KEY_BYTES = 32
const IV_BYTES = 12

export const canSealSecrets = () => {
	try {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const _key = getEncryptionKey()
		return true
	} catch {
		return false
	}
}

const getEncryptionKey = () => {
	const raw = process.env.DOKPLOY_ENCRYPTION_KEY
	if (!raw) {
		throw new Error(
			"DOKPLOY_ENCRYPTION_KEY is required to store sensitive tokens securely",
		)
	}

	let key: Buffer
	try {
		key = Buffer.from(raw, "base64")
	} catch {
		throw new Error("DOKPLOY_ENCRYPTION_KEY must be base64-encoded")
	}

	if (key.length !== KEY_BYTES) {
		throw new Error(
			`DOKPLOY_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (base64 of 32 bytes)`,
		)
	}

	return key
}

export const sealString = (plain: string) => {
	const key = getEncryptionKey()
	const iv = crypto.randomBytes(IV_BYTES)
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)

	const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
	const tag = cipher.getAuthTag()

	return `v1:${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`
}

export const unsealString = (sealed: string) => {
	const key = getEncryptionKey()
	const [version, ivB64, cipherB64, tagB64] = sealed.split(":")
	if (version !== "v1" || !ivB64 || !cipherB64 || !tagB64) {
		throw new Error("Invalid sealed secret format")
	}

	const iv = Buffer.from(ivB64, "base64")
	const ciphertext = Buffer.from(cipherB64, "base64")
	const tag = Buffer.from(tagB64, "base64")

	const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
	decipher.setAuthTag(tag)

	const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
	return plain.toString("utf8")
}

