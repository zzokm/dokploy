import { and, eq } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import {
	applications,
	cloudflareSettings,
	compose,
	domains,
	environments,
	previewDeployments,
	projects,
} from "@dokploy/server/db/schema"
import { unsealString } from "@dokploy/server/utils/crypto/seal"
import { resolveDomainTargetById } from "../domain-target"
import {
	ensureCloudflareAppDnsForDomain,
	findBestZoneMatch,
} from "./app-domain-automation"
import { listCloudflareDnsRecordsByName } from "./dns-records"

const normalizeHost = (h: string) => h.trim().toLowerCase().replace(/\.$/, "")

export type CloudflareAppDnsPreviewItem = {
	domainId: string
	host: string
	zoneName: string
	isRequired: true
	desiredIp: string | null
	desiredProxied: boolean
	currentRecordId: string | null
	currentIp: string | null
	currentProxied: boolean | null
	state: "no_target" | "no_zone" | "ok" | "missing" | "drift" | "error"
	wouldChange: boolean
	errorMessage?: string | null
}

export const listCloudflareDomainIdsForOrg = async (
	organizationId: string,
): Promise<string[]> => {
	const appRows = await db
		.select({ id: domains.domainId })
		.from(domains)
		.innerJoin(applications, eq(domains.applicationId, applications.applicationId))
		.innerJoin(environments, eq(applications.environmentId, environments.environmentId))
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(eq(projects.organizationId, organizationId), eq(domains.dnsProvider, "cloudflare")),
		)

	const composeRows = await db
		.select({ id: domains.domainId })
		.from(domains)
		.innerJoin(compose, eq(domains.composeId, compose.composeId))
		.innerJoin(environments, eq(compose.environmentId, environments.environmentId))
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(eq(projects.organizationId, organizationId), eq(domains.dnsProvider, "cloudflare")),
		)

	const previewRows = await db
		.select({ id: domains.domainId })
		.from(domains)
		.innerJoin(
			previewDeployments,
			eq(domains.previewDeploymentId, previewDeployments.previewDeploymentId),
		)
		.innerJoin(applications, eq(previewDeployments.applicationId, applications.applicationId))
		.innerJoin(environments, eq(applications.environmentId, environments.environmentId))
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(eq(projects.organizationId, organizationId), eq(domains.dnsProvider, "cloudflare")),
		)

	return [...new Set([...appRows, ...composeRows, ...previewRows].map((r) => r.id))]
}

const previewSingleDomain = async (input: {
	token: string
	organizationId: string
	domainId: string
}): Promise<CloudflareAppDnsPreviewItem> => {
	const [row] = await db
		.select({
			host: domains.host,
			cfDnsRecordId: domains.cfDnsRecordId,
			cfProxied: domains.cfProxied,
			cloudflareProxied: domains.cloudflareProxied,
		})
		.from(domains)
		.where(eq(domains.domainId, input.domainId))
		.limit(1)

	if (!row) {
		throw new Error("Domain not found")
	}

	const target = await resolveDomainTargetById(input.domainId)
	const desiredIp = target.expectedA
	const desiredProxied = row.cfProxied ?? row.cloudflareProxied ?? true

	const zone = await findBestZoneMatch(input.organizationId, row.host)
	if (!zone) {
		return {
			domainId: input.domainId,
			host: row.host,
			zoneName: "",
			isRequired: true,
			desiredIp,
			desiredProxied,
			currentRecordId: null,
			currentIp: null,
			currentProxied: null,
			state: "no_zone",
			wouldChange: false,
		}
	}

	if (!desiredIp) {
		return {
			domainId: input.domainId,
			host: row.host,
			zoneName: zone.name,
			isRequired: true,
			desiredIp: null,
			desiredProxied,
			currentRecordId: null,
			currentIp: null,
			currentProxied: null,
			state: "no_target",
			wouldChange: false,
		}
	}

	const fqdn = normalizeHost(row.host)
	let existing: Awaited<ReturnType<typeof listCloudflareDnsRecordsByName>> = []
	try {
		existing = await listCloudflareDnsRecordsByName({
			token: input.token,
			zoneId: zone.cfZoneId,
			name: fqdn,
			type: "A",
		})
	} catch (e) {
		return {
			domainId: input.domainId,
			host: row.host,
			zoneName: zone.name,
			isRequired: true,
			desiredIp,
			desiredProxied,
			currentRecordId: null,
			currentIp: null,
			currentProxied: null,
			state: "error",
			wouldChange: false,
			errorMessage: e instanceof Error ? e.message : "Failed to list DNS records",
		}
	}

	const byStoredId = row.cfDnsRecordId
		? existing.find((r) => r.id === row.cfDnsRecordId)
		: undefined
	const pick = byStoredId ?? existing[0] ?? null

	const currentIp = pick?.content?.trim() ?? null
	const currentProxied = pick?.proxied ?? null
	const currentRecordId = pick?.id ?? null

	const ipMatches =
		currentIp !== null && currentIp.toLowerCase() === desiredIp.toLowerCase()
	const proxMatches =
		currentProxied === null ? true : currentProxied === desiredProxied

	if (!pick) {
		return {
			domainId: input.domainId,
			host: row.host,
			zoneName: zone.name,
			isRequired: true,
			desiredIp,
			desiredProxied,
			currentRecordId: null,
			currentIp: null,
			currentProxied: null,
			state: "missing",
			wouldChange: true,
		}
	}

	if (ipMatches && proxMatches) {
		return {
			domainId: input.domainId,
			host: row.host,
			zoneName: zone.name,
			isRequired: true,
			desiredIp,
			desiredProxied,
			currentRecordId,
			currentIp,
			currentProxied,
			state: "ok",
			wouldChange: false,
		}
	}

	return {
		domainId: input.domainId,
		host: row.host,
		zoneName: zone.name,
		isRequired: true,
		desiredIp,
		desiredProxied,
		currentRecordId,
		currentIp,
		currentProxied,
		state: "drift",
		wouldChange: true,
	}
}

export const previewCloudflareAppDnsForOrg = async (
	organizationId: string,
): Promise<CloudflareAppDnsPreviewItem[]> => {
	const [settings] = await db
		.select({ apiTokenEncrypted: cloudflareSettings.apiTokenEncrypted })
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, organizationId))
		.limit(1)

	if (!settings) {
		return []
	}

	let token = ""
	try {
		token = unsealString(settings.apiTokenEncrypted)
	} catch {
		return []
	}

	const domainIds = await listCloudflareDomainIdsForOrg(organizationId)
	const out: CloudflareAppDnsPreviewItem[] = []

	for (const domainId of domainIds) {
		const item = await previewSingleDomain({
			token,
			organizationId,
			domainId,
		})
		out.push(item)
	}

	return out
}

export const previewCloudflareAppDnsForDomain = async (input: {
	organizationId: string
	domainId: string
}): Promise<CloudflareAppDnsPreviewItem | null> => {
	const [settings] = await db
		.select({ apiTokenEncrypted: cloudflareSettings.apiTokenEncrypted })
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, input.organizationId))
		.limit(1)

	if (!settings) {
		return null
	}

	let token = ""
	try {
		token = unsealString(settings.apiTokenEncrypted)
	} catch {
		return null
	}

	const [row] = await db
		.select({ dnsProvider: domains.dnsProvider })
		.from(domains)
		.where(eq(domains.domainId, input.domainId))
		.limit(1)

	if (row?.dnsProvider !== "cloudflare") {
		return null
	}

	return await previewSingleDomain({
		token,
		organizationId: input.organizationId,
		domainId: input.domainId,
	})
}

export const applyCloudflareDnsSelectionsForOrg = async (input: {
	organizationId: string
	selections: { domainId: string; apply: boolean }[]
}) => {
	const applied: string[] = []
	const skipped: string[] = []
	const errors: { domainId: string; message: string }[] = []

	for (const s of input.selections) {
		if (!s.apply) {
			skipped.push(s.domainId)
			continue
		}
		try {
			const res = await ensureCloudflareAppDnsForDomain({
				organizationId: input.organizationId,
				domainId: s.domainId,
				proxiedDefault: true,
			})
			if (res.skipped) {
				errors.push({
					domainId: s.domainId,
					message: `Skipped: ${res.reason}`,
				})
			} else {
				applied.push(s.domainId)
			}
		} catch (e) {
			errors.push({
				domainId: s.domainId,
				message: e instanceof Error ? e.message : "Unknown error",
			})
		}
	}

	return { applied, skipped, errors }
}

export const assertDomainIdsAllowedForOrgCloudflareApply = async (
	organizationId: string,
	domainIds: string[],
) => {
	const allowed = new Set(await listCloudflareDomainIdsForOrg(organizationId))
	const missing = domainIds.filter((id) => !allowed.has(id))
	if (missing.length > 0) {
		throw new Error(
			`One or more domains are not Cloudflare-managed in this organization: ${missing.join(", ")}`,
		)
	}
}
