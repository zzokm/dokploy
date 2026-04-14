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
	applyDnsForDomain,
	getHostedDomainById,
	replaceStandardMailDnsRecords,
} from "../dns"
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
 * Copies Traefik ACME material for `mail.<apex>` (fallback: apex) into
 * `mailTlsDir/<apex>/` and docker-mailserver `ssl/` for manual TLS.
 */
export const syncMailTlsFromTraefikForApex = async (opts: {
	apexDomain: string
	isServer?: boolean
}): Promise<void> => {
	const p = serverPaths(opts.isServer)
	const apex = opts.apexDomain.trim().toLowerCase()
	const mailHost = `mail.${apex}`
	const outDir = path.join(p.mailTlsDir, apex)
	await mkdir(outDir, { recursive: true })
	const outCertPath = path.join(outDir, "cert.pem")
	const outKeyPath = path.join(outDir, "key.pem")
	await extractMailTlsFromAcmeJson({
		acmeJsonPaths: [p.acmeCloudflareJsonPath, p.acmeJsonPath],
		domainCandidates: [mailHost, apex],
		outCertPath,
		outKeyPath,
	})
	const dmsSsl = path.join(p.mailDmsConfigDir, "ssl")
	await mkdir(dmsSsl, { recursive: true })
	await copyFile(outCertPath, path.join(dmsSsl, "cert.pem"))
	await copyFile(outKeyPath, path.join(dmsSsl, "key.pem"))
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
	const mailTxtPath = path.join(
		p.mailDmsConfigDir,
		"opendkim",
		"keys",
		domain.name,
		"mail.txt",
	)
	const raw = await readDkimMailTxtWithRetry(mailTxtPath)
	const dnsTxtValue = parseDkimTxtFromMailDotTxt(raw)
	await db
		.update(hostedDomain)
		.set({
			dkimSelector: MAIL_DKIM_SELECTOR,
			dkimPrivateKeyPath: null,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(hostedDomain.id, domainId))

	const ws = await getWebServerSettings()
	const serverIp = ws?.serverIp?.trim() ?? null
	await replaceStandardMailDnsRecords(db, domainId, {
		mailHost,
		dkimTxt: dnsTxtValue,
		serverIp,
	})
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
	if (domain.isDnsManaged) {
		await applyDnsForDomain(db, {
			domainId: opts.domainId,
			organizationId: opts.organizationId,
			isServer: opts.isServer,
		})
	}
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
