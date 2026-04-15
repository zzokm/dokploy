import { copyFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { and, eq } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { serverPaths } from "../../constants/server-paths"
import type * as schema from "../../db/schema"
import {
	hostedDomain,
	mailAlias,
	mailbox,
} from "../../db/schema/hosted-domain"
import {
	getHostedDomainById,
} from "../hosted-domain"
import { getWebServerSettings } from "../web-server-settings"
import { parseDkimTxtFromMailDotTxt } from "../../utils/mail/dms-dkim-mail-txt"
import { extractMailTlsFromAcmeJson } from "../../utils/mail/extract-acme-certs"
import { hashMailboxPassword } from "../../utils/mail/password"
import { reloadMailServices } from "../docker/reload-mail"
import { getRemoteDocker } from "../../utils/servers/remote-docker"
import { execDmsSetup } from "./dms-setup-exec"

const MAIL_DKIM_SELECTOR = "mail"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const readDkimMailTxtWithRetry = async (
	mailTxtPath: string,
): Promise<string> => {
	let lastErr: Error | undefined
	for (let i = 0; i < 8; i++) {
		try {
			return await readFile(mailTxtPath, "utf8")
		} catch (e) {
			lastErr = e instanceof Error ? e : new Error(String(e))
			await sleep(200)
		}
	}
	throw lastErr ?? new Error("Could not read DKIM mail.txt")
}

/**
 * Reads and parses docker-mailserver's OpenDKIM `mail.txt` into a single TXT value.
 *
 * Source path inside the DMS config volume:
 * `/tmp/docker-mailserver/opendkim/keys/<domain>/mail.txt`
 */
export const readDkimDnsTxtFromDmsMailTxt = async (opts: {
	domain: string
	isServer?: boolean
}): Promise<string> => {
	const domain = opts.domain.trim().toLowerCase()
	const p = serverPaths(opts.isServer)
	const mailTxtPath = path.join(
		p.mailDmsConfigDir,
		"opendkim",
		"keys",
		domain,
		"mail.txt",
	)
	const raw = await readDkimMailTxtWithRetry(mailTxtPath)
	return parseDkimTxtFromMailDotTxt(raw)
}

const readIfExists = async (filePath: string): Promise<Buffer | null> => {
	try {
		const raw = await readFile(filePath)
		return raw
	} catch {
		return null
	}
}

/**
 * Copies Traefik ACME material for `mail.<apex>` (fallback: apex) into
 * `mailTlsDir/<apex>/` and docker-mailserver `ssl/` for manual TLS.
 */
const syncMailTlsFromTraefikForApexInternal = async (opts: {
	apexDomain: string
	isServer?: boolean
}): Promise<{ changed: boolean }> => {
	const p = serverPaths(opts.isServer)
	const apex = opts.apexDomain.trim().toLowerCase()
	const mailHost = `mail.${apex}`
	const outDir = path.join(p.mailTlsDir, apex)
	await mkdir(outDir, { recursive: true })
	const outCertPath = path.join(outDir, "cert.pem")
	const outKeyPath = path.join(outDir, "key.pem")
	await extractMailTlsFromAcmeJson({
		acmeJsonPaths: [
			// Prefer DNS-01 (Cloudflare) store, but also try legacy name + HTTP-01 store
			p.acmeCloudflareJsonPath,
			path.join(path.dirname(p.acmeCloudflareJsonPath), "acme-cf.json"),
			p.acmeJsonPath,
		],
		domainCandidates: [mailHost, apex],
		outCertPath,
		outKeyPath,
	})
	const dmsSsl = path.join(p.mailDmsConfigDir, "ssl")
	await mkdir(dmsSsl, { recursive: true })

	const dmsCertPath = path.join(dmsSsl, "cert.pem")
	const dmsKeyPath = path.join(dmsSsl, "key.pem")
	const [prevCert, prevKey] = await Promise.all([
		readIfExists(dmsCertPath),
		readIfExists(dmsKeyPath),
	])
	const [nextCert, nextKey] = await Promise.all([
		readFile(outCertPath),
		readFile(outKeyPath),
	])

	const changed =
		!prevCert ||
		!prevKey ||
		Buffer.compare(prevCert, nextCert) !== 0 ||
		Buffer.compare(prevKey, nextKey) !== 0

	if (changed) {
		await copyFile(outCertPath, dmsCertPath)
		await copyFile(outKeyPath, dmsKeyPath)
	}

	return { changed }
}

/** @deprecated Prefer `syncMailTlsFromTraefikForApex`; `domain` is the apex hostname. */
export const extractMailTlsForDomain = async (opts: {
	domain: string
	isServer?: boolean
}) => {
	await syncMailTlsFromTraefikForApex({
		apexDomain: opts.domain,
		isServer: opts.isServer,
	})
}

/**
 * Copies Traefik ACME material for `mail.<apex>` (fallback: apex) into
 * docker-mailserver `ssl/` for manual TLS.
 */
export const syncMailTlsFromTraefikForApex = async (opts: {
	apexDomain: string
	isServer?: boolean
}): Promise<void> => {
	await syncMailTlsFromTraefikForApexInternal(opts)
}

export const ensureDkimForMailDomain = async (
	db: PostgresJsDatabase<typeof schema>,
	domainId: string,
	isServer?: boolean,
) => {
	const [domain] = await db
		.select()
		.from(hostedDomain)
		.where(eq(hostedDomain.id, domainId))
		.limit(1)
	if (!domain?.isMailManaged) {
		return
	}
	const p = serverPaths(isServer)
	const mailHost = `mail.${domain.name}`
	const docker = await getRemoteDocker(domain.serverId ?? undefined)
	const dkimRes = await execDmsSetup(docker, p.mailserverContainerName, [
		"config",
		"dkim",
		"keysize",
		"2048",
		"domain",
		domain.name,
	])
	if (dkimRes.exitCode !== 0) {
		throw new Error(
			dkimRes.stdout.trim() || "docker-mailserver DKIM generation failed",
		)
	}
	const dnsTxtValue = await readDkimDnsTxtFromDmsMailTxt({
		domain: domain.name,
		isServer,
	})
	void dnsTxtValue
	await db
		.update(hostedDomain)
		.set({
			dkimSelector: MAIL_DKIM_SELECTOR,
			dkimPrivateKeyPath: null,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(hostedDomain.id, domainId))

	const ws = await getWebServerSettings()
	void ws
}

/**
 * Background sync: refreshes DMS TLS material from Traefik ACME stores and reloads
 * postfix/dovecot only if a certificate actually changed.
 */
export const syncMailTlsFromTraefikForAllMailDomains = async (opts: {
	db: PostgresJsDatabase<typeof schema>
	isServer?: boolean
}): Promise<{ changedDomains: string[] }> => {
	const p = serverPaths(opts.isServer)
	const rows = await opts.db
		.select({ name: hostedDomain.name, serverId: hostedDomain.serverId })
		.from(hostedDomain)
		.where(eq(hostedDomain.isMailManaged, true))

	const changedDomains: string[] = []
	for (const r of rows) {
		const apex = r.name.trim().toLowerCase()
		if (!apex) continue
		try {
			const res = await syncMailTlsFromTraefikForApexInternal({
				apexDomain: apex,
				isServer: opts.isServer,
			})
			if (res.changed) {
				changedDomains.push(apex)
			}
		} catch {
			// Ignore missing certs; Traefik may not have issued yet.
		}
	}

	if (changedDomains.length > 0) {
		const docker = await getRemoteDocker(undefined)
		await reloadMailServices(docker, p)
	}

	return { changedDomains }
}

/**
 * When mail is first enabled: DKIM + standard DNS rows, TLS export from Traefik ACME,
 * docker-mailserver alias sync, and optional BIND zone push.
 */
export const onboardMailServiceForDomain = async (
	db: PostgresJsDatabase<typeof schema>,
	opts: {
		domainId: string
		organizationId: string
		isServer?: boolean
	},
): Promise<void> => {
	const domain = await getHostedDomainById(
		db,
		opts.domainId,
		opts.organizationId,
	)
	if (!domain?.isMailManaged) {
		return
	}
	await ensureDkimForMailDomain(db, opts.domainId, opts.isServer)
	try {
		await syncMailTlsFromTraefikForApex({
			apexDomain: domain.name,
			isServer: opts.isServer,
		})
		const p = serverPaths(opts.isServer)
		const docker = await getRemoteDocker(domain.serverId ?? undefined)
		await reloadMailServices(docker, p)
	} catch {
		// Certificate may not exist until Traefik has issued for mail.<apex>
	}
	await applyMailConfigurations(db, {
		organizationId: opts.organizationId,
		serverId: domain.serverId,
	})
}

/**
 * Pushes virtual aliases (and catch-all) into docker-mailserver and reloads postfix/dovecot.
 */
export const applyMailConfigurations = async (
	db: PostgresJsDatabase<typeof schema>,
	opts: {
		organizationId: string
		isServer?: boolean
		serverId?: string | null
	},
): Promise<void> => {
	const mailDomains = await db
		.select()
		.from(hostedDomain)
		.where(
			and(
				eq(hostedDomain.organizationId, opts.organizationId),
				eq(hostedDomain.isMailManaged, true),
			),
		)

	const p = serverPaths(opts.isServer)
	const serverId =
		opts.serverId ?? mailDomains.find((d) => d.serverId)?.serverId ?? null
	const docker = await getRemoteDocker(serverId ?? undefined)

	for (const domain of mailDomains) {
		const aliases = await db
			.select()
			.from(mailAlias)
			.where(eq(mailAlias.domainId, domain.id))
		for (const a of aliases) {
			const src = `${a.sourceLocalPart}@${domain.name}`
			const r = await execDmsSetup(docker, p.mailserverContainerName, [
				"alias",
				"add",
				src,
				a.destination,
			])
			if (r.exitCode !== 0 && !r.stdout.toLowerCase().includes("already")) {
				throw new Error(
					r.stdout.trim() || `docker-mailserver alias add failed for ${src}`,
				)
			}
		}
		if (domain.catchAllLocalPart?.trim()) {
			const dest = `${domain.catchAllLocalPart.trim()}@${domain.name}`
			const r = await execDmsSetup(docker, p.mailserverContainerName, [
				"alias",
				"add",
				`@${domain.name}`,
				dest,
			])
			if (r.exitCode !== 0 && !r.stdout.toLowerCase().includes("already")) {
				throw new Error(
					r.stdout.trim() ||
						`docker-mailserver catch-all alias failed for ${domain.name}`,
				)
			}
		}
	}

	await reloadMailServices(docker, p)
}

export const createMailbox = async (
	db: PostgresJsDatabase<typeof schema>,
	input: {
		organizationId: string
		domainId: string
		localPart: string
		password: string
		quotaBytes?: number
	},
) => {
	const domain = await getHostedDomainById(
		db,
		input.domainId,
		input.organizationId,
	)
	if (!domain) {
		throw new Error("Domain not found")
	}
	if (!domain.isMailManaged) {
		throw new Error("Mail not enabled for this domain")
	}
	const email = `${input.localPart}@${domain.name}`
	const p = serverPaths(false)
	const docker = await getRemoteDocker(domain.serverId ?? undefined)
	const addRes = await execDmsSetup(docker, p.mailserverContainerName, [
		"email",
		"add",
		email,
		input.password,
	])
	if (addRes.exitCode !== 0) {
		throw new Error(
			addRes.stdout.trim() || "docker-mailserver email add failed",
		)
	}
	const quotaBytes =
		input.quotaBytes === undefined ? 5_368_709_120 : input.quotaBytes
	if (quotaBytes > 0) {
		const q = await execDmsSetup(docker, p.mailserverContainerName, [
			"quota",
			"set",
			email,
			String(quotaBytes),
		])
		if (q.exitCode !== 0) {
			throw new Error(q.stdout.trim() || "docker-mailserver quota set failed")
		}
	}
	const hash = await hashMailboxPassword(input.password)
	const [row] = await db
		.insert(mailbox)
		.values({
			domainId: input.domainId,
			localPart: input.localPart,
			passwordHash: hash,
			quotaBytes,
		})
		.returning()
	await applyMailConfigurations(db, {
		organizationId: input.organizationId,
		serverId: domain.serverId,
	})
	return row
}

export const listMailboxesForDomain = async (
	db: PostgresJsDatabase<typeof schema>,
	domainId: string,
	organizationId: string,
) => {
	const d = await getHostedDomainById(db, domainId, organizationId)
	if (!d) {
		return null
	}
	return db
		.select()
		.from(mailbox)
		.where(eq(mailbox.domainId, domainId))
}

export const listAliasesForDomain = async (
	db: PostgresJsDatabase<typeof schema>,
	domainId: string,
	organizationId: string,
) => {
	const d = await getHostedDomainById(db, domainId, organizationId)
	if (!d) {
		return null
	}
	return db
		.select()
		.from(mailAlias)
		.where(eq(mailAlias.domainId, domainId))
}

export const listMailManagedDomains = async (
	db: PostgresJsDatabase<typeof schema>,
	organizationId: string,
) =>
	db
		.select()
		.from(hostedDomain)
		.where(
			and(
				eq(hostedDomain.organizationId, organizationId),
				eq(hostedDomain.isMailManaged, true),
			),
		)
