import { eq } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import { domains } from "@dokploy/server/db/schema"
import { getWebServerSettings } from "./web-server-settings"

export type DomainTarget = {
	domainId: string
	host: string
	targetServerId: string | null
	expectedA: string | null
	expectedAAAA: string | null
}

export const resolveDomainTargetById = async (
	domainId: string,
): Promise<DomainTarget> => {
	const row = await db.query.domains.findFirst({
		where: eq(domains.domainId, domainId),
		with: {
			application: {
				with: {
					server: true,
				},
			},
			compose: {
				with: {
					server: true,
				},
			},
			previewDeployment: {
				with: {
					application: {
						with: {
							server: true,
						},
					},
				},
			},
		},
	})

	if (!row) {
		throw new Error("Domain not found")
	}

	const targetServer =
		row.application?.server ??
		row.compose?.server ??
		row.previewDeployment?.application?.server ??
		null

	const expectedA = targetServer?.ipAddress?.trim()
		? targetServer.ipAddress.trim()
		: null

	if (expectedA) {
		return {
			domainId: row.domainId,
			host: row.host,
			targetServerId: targetServer?.serverId ?? null,
			expectedA,
			expectedAAAA: null,
		}
	}

	const settings = await getWebServerSettings()
	const fallbackIp = settings?.serverIp?.trim() ? settings.serverIp.trim() : null

	return {
		domainId: row.domainId,
		host: row.host,
		targetServerId: targetServer?.serverId ?? null,
		expectedA: fallbackIp,
		expectedAAAA: null,
	}
}

