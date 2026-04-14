import path from "node:path"
import { and, eq } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import {
	cloudflareSettings,
	cloudflareZone,
	hostedDomain,
} from "@dokploy/server/db/schema"
import { serverPaths } from "@dokploy/server/constants/server-paths"
import { createHostedDomain } from "@dokploy/server/services/dns"
import {
	applyMailConfigurations,
	ensureDkimForMailDomain,
	syncMailTlsFromTraefikForApex,
} from "@dokploy/server/services/mail"
import { getWebServerSettings } from "@dokploy/server/services/web-server-settings"
import { unsealString } from "@dokploy/server/utils/crypto/seal"
import { readDkimDnsTxtFromPublicKeyFile } from "@dokploy/server/utils/mail/dkim-openssl"
import { parseDkimTxtFromMailDotTxt } from "@dokploy/server/utils/mail/dms-dkim-mail-txt"
import { readFile } from "node:fs/promises"
import { upsertCloudflareDnsRecord } from "./dns-records"

const MAIL_DKIM_SELECTOR = "mail"

const ensureMailHostedDomain = async (input: {
	organizationId: string
	apex: string
}) => {
	const apex = input.apex.trim().toLowerCase()
	const [existing] = await db
		.select({ id: hostedDomain.id })
		.from(hostedDomain)
		.where(
			and(
				eq(hostedDomain.organizationId, input.organizationId),
				eq(hostedDomain.name, apex),
			),
		)
		.limit(1)

	if (existing) {
		await db
			.update(hostedDomain)
			.set({
				isMailManaged: true,
				isDnsManaged: false,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(hostedDomain.id, existing.id))
		return existing.id
	}

	const row = await createHostedDomain(db, {
		organizationId: input.organizationId,
		name: apex,
		isMailManaged: true,
		isDnsManaged: false,
	})
	if (!row) {
		throw new Error("Failed to create hosted domain for mail")
	}
	return row.id
}

export const provisionMailDnsForZone = async (input: {
	organizationId: string
	cfZoneId: string
}) => {
	const [settings] = await db
		.select({ apiTokenEncrypted: cloudflareSettings.apiTokenEncrypted })
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, input.organizationId))
		.limit(1)

	if (!settings) {
		throw new Error("Cloudflare is not connected for this organization")
	}

	let token = ""
	try {
		token = unsealString(settings.apiTokenEncrypted)
	} catch (e) {
		const message =
			e instanceof Error ? e.message : "Failed to decrypt Cloudflare token"
		throw new Error(
			`Cloudflare is connected but token decryption failed. Check DOKPLOY_ENCRYPTION_KEY. ${message}`,
		)
	}

	const [zone] = await db
		.select({ name: cloudflareZone.name })
		.from(cloudflareZone)
		.where(
			and(
				eq(cloudflareZone.organizationId, input.organizationId),
				eq(cloudflareZone.cfZoneId, input.cfZoneId),
			),
		)
		.limit(1)

	if (!zone) {
		throw new Error("Zone not found")
	}

	const ws = await getWebServerSettings()
	const serverIp = ws?.serverIp?.trim()
	if (!serverIp) {
		throw new Error("Server IP is not configured")
	}

	const apex = zone.name.trim().toLowerCase()
	const mailHost = `mail.${apex}`

	const hostedDomainId = await ensureMailHostedDomain({
		organizationId: input.organizationId,
		apex,
	})

	await ensureDkimForMailDomain(db, hostedDomainId)

	const p = serverPaths(false)
	const mailTxtPath = path.join(
		p.mailDmsConfigDir,
		"opendkim",
		"keys",
		apex,
		"mail.txt",
	)
	let dkimTxt: string
	try {
		const raw = await readFile(mailTxtPath, "utf8")
		dkimTxt = parseDkimTxtFromMailDotTxt(raw)
	} catch {
		const publicPath = path.join(
			p.dkimKeysDir,
			`${apex}.${MAIL_DKIM_SELECTOR}.public.pem`,
		)
		dkimTxt = await readDkimDnsTxtFromPublicKeyFile(publicPath)
	}

	await upsertCloudflareDnsRecord({
		token,
		zoneId: input.cfZoneId,
		type: "A",
		name: mailHost,
		content: serverIp,
		ttl: 1,
		proxied: false,
	})

	const webmailHost = `webmail.${apex}`
	await upsertCloudflareDnsRecord({
		token,
		zoneId: input.cfZoneId,
		type: "A",
		name: webmailHost,
		content: serverIp,
		ttl: 1,
		proxied: true,
	})

	await upsertCloudflareDnsRecord({
		token,
		zoneId: input.cfZoneId,
		type: "MX",
		name: apex,
		content: mailHost,
		ttl: 1,
		priority: 10,
	})

	await upsertCloudflareDnsRecord({
		token,
		zoneId: input.cfZoneId,
		type: "TXT",
		name: apex,
		content: `v=spf1 mx a ip4:${serverIp} ~all`,
		ttl: 1,
	})

	await upsertCloudflareDnsRecord({
		token,
		zoneId: input.cfZoneId,
		type: "TXT",
		name: `_dmarc.${apex}`,
		content: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${apex}`,
		ttl: 1,
	})

	await upsertCloudflareDnsRecord({
		token,
		zoneId: input.cfZoneId,
		type: "TXT",
		name: `${MAIL_DKIM_SELECTOR}._domainkey.${apex}`,
		content: dkimTxt,
		ttl: 1,
	})

	try {
		await syncMailTlsFromTraefikForApex({ apexDomain: apex })
	} catch {
		// Certificate may not exist until Traefik has issued for mail.<apex>
	}

	const [domainRow] = await db
		.select({ serverId: hostedDomain.serverId })
		.from(hostedDomain)
		.where(eq(hostedDomain.id, hostedDomainId))
		.limit(1)

	await applyMailConfigurations(db, {
		organizationId: input.organizationId,
		serverId: domainRow?.serverId ?? null,
	})

	return { ok: true as const, hostedDomainId }
}

