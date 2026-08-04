import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("dokploy encryption key bootstrap", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
		delete process.env.DOKPLOY_ENCRYPTION_KEY;
		delete process.env.DOKPLOY_ENCRYPTION_KEY_FILE;
	});

	it("loads the key from DOKPLOY_ENCRYPTION_KEY_FILE", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "dokploy-key-file-"));
		const keyPath = path.join(dir, "dokploy.key");
		const key = Buffer.from("k".repeat(32)).toString("base64");
		writeFileSync(keyPath, `${key}\n`, "utf8");
		vi.stubEnv("DOKPLOY_ENCRYPTION_KEY_FILE", keyPath);

		const { loadDokployEncryptionKeySync, assertDokployEncryptionKey } =
			await import(
				"../../../../packages/server/src/utils/crypto/dokploy-encryption-key"
			);

		const loaded = loadDokployEncryptionKeySync();
		expect(loaded).toBe(key);
		expect(assertDokployEncryptionKey(loaded)).toBeInstanceOf(Buffer);
		expect(process.env.DOKPLOY_ENCRYPTION_KEY).toBe(key);
	});

	it("fails fast in production when no key is configured", async () => {
		const { ensureDokployEncryptionKey } = await import(
			"../../../../packages/server/src/utils/crypto/dokploy-encryption-key"
		);

		await expect(
			ensureDokployEncryptionKey({ allowGenerate: false }),
		).rejects.toThrow(/required in production/i);
	});

	it("generates and persists a key when allowed", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "dokploy-key-env-"));
		const envPath = path.join(dir, ".env");
		const { ensureDokployEncryptionKey, assertDokployEncryptionKey } =
			await import(
				"../../../../packages/server/src/utils/crypto/dokploy-encryption-key"
			);

		const key = await ensureDokployEncryptionKey({
			allowGenerate: true,
			envPath,
		});

		expect(assertDokployEncryptionKey(key)).toBeInstanceOf(Buffer);
		expect(readFileSync(envPath, "utf8")).toContain(
			`DOKPLOY_ENCRYPTION_KEY="${key}"`,
		);
	});
});
