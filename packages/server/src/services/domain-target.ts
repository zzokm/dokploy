import { eq } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import {
	applications,
	compose,
	domains,
	previewDeployments,
	server,
} from "@dokploy/server/db/schema"
import { getWebServerSettings } from "./web-server-settings"

export type DomainTarget = {
	domainId: string
	host: string
	targetServerId: string | null
	expectedA: string | null
	expectedAAAA: string | null
}

/**
 * Resolve the expected public A record for a domain without loading full
 * application/compose graphs. Drizzle relational `with: { ...: true }` builds
 * `json_build_array(...)` over every column; application has >100 columns, which
 * hits Postgres error 54023 ("cannot pass more than 100 arguments to a function").
 */
export const resolveDomainTargetById = async (
	domainId: string,
): Promise<DomainTarget> => {
	const [row] = await db
		.select({
			domainId: domains.domainId,
			host: domains.host,
			applicationId: domains.applicationId,
			composeId: domains.composeId,
			previewDeploymentId: domains.previewDeploymentId,
		})
		.from(domains)
		.where(eq(domains.domainId, domainId))
		.limit(1)

	if (!row) {
		throw new Error("Domain not found")
	}

	let targetServerId: string | null = null

	if (row.applicationId) {
		const [app] = await db
			.select({ serverId: applications.serverId })
			.from(applications)
			.where(eq(applications.applicationId, row.applicationId))
			.limit(1)
		targetServerId = app?.serverId ?? null
	} else if (row.composeId) {
		const [composeRow] = await db
			.select({ serverId: compose.serverId })
			.from(compose)
			.where(eq(compose.composeId, row.composeId))
			.limit(1)
		targetServerId = composeRow?.serverId ?? null
	} else if (row.previewDeploymentId) {
		const [preview] = await db
			.select({ applicationId: previewDeployments.applicationId })
			.from(previewDeployments)
			.where(
				eq(previewDeployments.previewDeploymentId, row.previewDeploymentId),
			)
			.limit(1)
		if (preview?.applicationId) {
			const [app] = await db
				.select({ serverId: applications.serverId })
				.from(applications)
				.where(eq(applications.applicationId, preview.applicationId))
				.limit(1)
			targetServerId = app?.serverId ?? null
		}
	}

	let expectedA: string | null = null
	if (targetServerId) {
		const [targetServer] = await db
			.select({
				serverId: server.serverId,
				ipAddress: server.ipAddress,
			})
			.from(server)
			.where(eq(server.serverId, targetServerId))
			.limit(1)
		expectedA = targetServer?.ipAddress?.trim()
			? targetServer.ipAddress.trim()
			: null
	}

	if (expectedA) {
		return {
			domainId: row.domainId,
			host: row.host,
			targetServerId,
			expectedA,
			expectedAAAA: null,
		}
	}

	const settings = await getWebServerSettings()
	const fallbackIp = settings?.serverIp?.trim() ? settings.serverIp.trim() : null

	return {
		domainId: row.domainId,
		host: row.host,
		targetServerId,
		expectedA: fallbackIp,
		expectedAAAA: null,
	}
}
