/**
 * Ensures apps/dokploy/.docker/core-services mail directories exist (dev).
 * Ensures the Docker network used by compose (default dokploy-network) exists — compose treats it as external.
 */
import { execSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
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

const mailDirs = [
	"mail/auth",
	"mail/data",
	"mail/tls",
	"mail/dkim",
	"mail/roundcube",
	"mail/roundcube-config",
	"mail/state",
	"mail/logs",
	"mail/dms-config",
	"mail/dms-config/ssl",
]
const base = join(repoRoot, "apps/dokploy/.docker/core-services")
for (const rel of mailDirs) {
	const dir = join(base, rel)
	mkdirSync(dir, { recursive: true })
}
const dmsCert = join(base, "mail/dms-config/ssl/cert.pem")
const dmsKey = join(base, "mail/dms-config/ssl/key.pem")
if (!existsSync(dmsCert) || !existsSync(dmsKey)) {
	try {
		execSync(
			`openssl req -x509 -nodes -newkey rsa:2048 -keyout "${dmsKey}" -out "${dmsCert}" -days 3650 -subj "/CN=dokploy-mailserver/O=Dokploy"`,
			{ stdio: "ignore" },
		)
		console.info("Created placeholder TLS PEMs for docker-mailserver (SSL_TYPE=manual)")
	} catch {
		console.warn(
			"openssl not available: create mail/dms-config/ssl/cert.pem and key.pem before starting docker-mailserver with SSL_TYPE=manual",
		)
	}
}

// Hard-enforce spoof protection in DMS (do not rely on env flags)
const userPatches = join(base, "mail/dms-config/user-patches.sh")
if (!existsSync(userPatches)) {
	writeFileSync(
		userPatches,
		`#!/bin/bash
set -euo pipefail

# Dokploy hardening: prevent authenticated users from forging envelope FROM.
# This mirrors docker-mailserver's SPOOF_PROTECTION behavior, but is enforced
# via a mounted patch script rather than an environment variable.
postconf -e 'mua_sender_restrictions = reject_authenticated_sender_login_mismatch, $smtpd_sender_restrictions'
postconf -e 'smtpd_sender_login_maps = unionmap:{ texthash:/etc/postfix/virtual, hash:/etc/aliases, pcre:/etc/postfix/maps/sender_login_maps.pcre }'
`,
		"utf8",
	)
	chmodSync(userPatches, 0o755)
	console.info("Created docker-mailserver user-patches.sh (spoof protection)")
}
console.info(`Ensured mail directories under ${base}`)
