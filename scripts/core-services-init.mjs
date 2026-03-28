/**
 * Seeds apps/dokploy/.docker/core-services/dns/config/named.conf from the repo template
 * and ensures zone directories exist (paths must match serverPaths() in dev).
 * Ensures the Docker network used by compose (default dokploy-network) exists — compose treats it as external.
 */
import { execSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")

const networkName =
	process.env.PANEL_CORE_SERVICES_NETWORK?.trim() || "dokploy-network"

const ensureDockerNetwork = () => {
	try {
		execSync(`docker network inspect ${networkName}`, {
			stdio: "ignore",
			encoding: "utf8",
		})
	} catch {
		execSync(`docker network create ${networkName}`, { stdio: "inherit" })
		console.info(`Created Docker network ${networkName}`)
	}
}

ensureDockerNetwork()
const template = join(repoRoot, "docker/core-services/bind/named.conf")
const configDir = join(
	repoRoot,
	"apps/dokploy/.docker/core-services/dns/config",
)
const zonesDir = join(configDir, "zones")
const namedConf = join(configDir, "named.conf")
const namedLocal = join(configDir, "named.conf.local")

mkdirSync(zonesDir, { recursive: true })

if (!existsSync(template)) {
	console.error(`Missing template: ${template}`)
	process.exit(1)
}

if (!existsSync(namedConf)) {
	copyFileSync(template, namedConf)
	console.info(`Created ${namedConf}`)
} else {
	console.info(`Keep existing ${namedConf}`)
}

if (!existsSync(namedLocal)) {
	writeFileSync(
		namedLocal,
		"// Placeholder — replaced when you Apply DNS from the Domains settings page\n",
		"utf8",
	)
	console.info(`Created ${namedLocal}`)
}

const mailDirs = [
	"mail/auth",
	"mail/data",
	"mail/tls",
	"mail/dkim",
	"mail/roundcube",
]
const base = join(repoRoot, "apps/dokploy/.docker/core-services")
for (const rel of mailDirs) {
	const dir = join(base, rel)
	mkdirSync(dir, { recursive: true })
}
console.info(`Ensured mail directories under ${base}`)
