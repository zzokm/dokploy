import { exec } from "node:child_process";
import crypto from "node:crypto";
import { access, appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exit } from "node:process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

import { setupDirectories } from "@dokploy/server/setup/config-paths";
import { initializePostgres } from "@dokploy/server/setup/postgres-setup";
import {
	initializeNetwork,
	initializeSwarm,
} from "@dokploy/server/setup/setup";
import {
	createDefaultMiddlewares,
	createDefaultServerTraefikConfig,
	createDefaultTraefikConfig,
	initializeStandaloneTraefik,
	TRAEFIK_VERSION,
} from "@dokploy/server/setup/traefik-setup";

const ensureEncryptionKey = async () => {
	if (process.env.DOKPLOY_ENCRYPTION_KEY) return

	const key = crypto.randomBytes(32).toString("base64")
	process.env.DOKPLOY_ENCRYPTION_KEY = key

	const envPath = path.join(process.cwd(), ".env")
	try {
		await access(envPath)
		const current = await readFile(envPath, "utf8").catch(() => "")
		if (current.includes("DOKPLOY_ENCRYPTION_KEY=")) return
		await appendFile(envPath, `\nDOKPLOY_ENCRYPTION_KEY="${key}"\n`, "utf8")
	} catch {
		// If .env doesn't exist or isn't writable, create it best-effort
		try {
			await writeFile(envPath, `DOKPLOY_ENCRYPTION_KEY="${key}"\n`, "utf8")
		} catch {
			// ignore: runtime env var is still set for this process
		}
	}
}

(async () => {
	try {
		await ensureEncryptionKey()
		setupDirectories();
		createDefaultMiddlewares();
		await initializeSwarm();
		await initializeNetwork();
		createDefaultTraefikConfig();
		createDefaultServerTraefikConfig();
		await execAsync(`docker pull traefik:v${TRAEFIK_VERSION}`);
		await initializeStandaloneTraefik();
		await initializePostgres();
		console.log("Dokploy setup completed");
		exit(0);
	} catch (e) {
		console.error("Error in dokploy setup", e);
	}
})();
