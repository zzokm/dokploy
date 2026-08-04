import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { access, appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const KEY_BYTES = 32;

const readKeyFileSync = (filePath: string) => {
	try {
		return readFileSync(filePath, "utf8").trim();
	} catch {
		throw new Error(`Cannot read DOKPLOY_ENCRYPTION_KEY_FILE at ${filePath}`);
	}
};

const readKeyFile = async (filePath: string) => {
	try {
		return (await readFile(filePath, "utf8")).trim();
	} catch {
		throw new Error(`Cannot read DOKPLOY_ENCRYPTION_KEY_FILE at ${filePath}`);
	}
};

export const loadDokployEncryptionKey = async () => {
	if (process.env.DOKPLOY_ENCRYPTION_KEY?.trim()) {
		return process.env.DOKPLOY_ENCRYPTION_KEY.trim();
	}

	const filePath = process.env.DOKPLOY_ENCRYPTION_KEY_FILE?.trim();
	if (!filePath) {
		return undefined;
	}

	const key = await readKeyFile(filePath);
	process.env.DOKPLOY_ENCRYPTION_KEY = key;
	return key;
};

export const loadDokployEncryptionKeySync = () => {
	if (process.env.DOKPLOY_ENCRYPTION_KEY?.trim()) {
		return process.env.DOKPLOY_ENCRYPTION_KEY.trim();
	}

	const filePath = process.env.DOKPLOY_ENCRYPTION_KEY_FILE?.trim();
	if (!filePath) {
		return undefined;
	}

	const key = readKeyFileSync(filePath);
	process.env.DOKPLOY_ENCRYPTION_KEY = key;
	return key;
};

export const assertDokployEncryptionKey = (raw?: string) => {
	if (!raw) {
		throw new Error(
			"DOKPLOY_ENCRYPTION_KEY is required. Set DOKPLOY_ENCRYPTION_KEY or DOKPLOY_ENCRYPTION_KEY_FILE to a base64-encoded 32-byte key.",
		);
	}

	const key = Buffer.from(raw, "base64");
	if (key.length !== KEY_BYTES) {
		throw new Error(
			`DOKPLOY_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (base64 of 32 bytes)`,
		);
	}

	return key;
};

export const canUseDokployEncryptionKey = async () => {
	try {
		assertDokployEncryptionKey(await loadDokployEncryptionKey());
		return true;
	} catch {
		return false;
	}
};

export const generateDokployEncryptionKey = () =>
	crypto.randomBytes(KEY_BYTES).toString("base64");

type EnsureOptions = {
	allowGenerate: boolean;
	envPath?: string;
};

export const ensureDokployEncryptionKey = async ({
	allowGenerate,
	envPath = path.join(process.cwd(), ".env"),
}: EnsureOptions) => {
	const existing = await loadDokployEncryptionKey();
	if (existing) {
		assertDokployEncryptionKey(existing);
		return existing;
	}

	if (!allowGenerate) {
		throw new Error(
			"DOKPLOY_ENCRYPTION_KEY is required in production. Set DOKPLOY_ENCRYPTION_KEY or DOKPLOY_ENCRYPTION_KEY_FILE before starting Dokploy.",
		);
	}

	const key = generateDokployEncryptionKey();
	process.env.DOKPLOY_ENCRYPTION_KEY = key;

	try {
		await access(envPath);
		const current = await readFile(envPath, "utf8").catch(() => "");
		if (!current.includes("DOKPLOY_ENCRYPTION_KEY=")) {
			await appendFile(envPath, `\nDOKPLOY_ENCRYPTION_KEY="${key}"\n`, "utf8");
		}
	} catch {
		try {
			await writeFile(envPath, `DOKPLOY_ENCRYPTION_KEY="${key}"\n`, "utf8");
		} catch {
			// Best effort only: local/dev callers still have the runtime env var.
		}
	}

	return key;
};
