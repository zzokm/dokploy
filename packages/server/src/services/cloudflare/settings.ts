import { eq } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import { cloudflareSettings } from "@dokploy/server/db/schema"

export const getCloudflareSettingsForOrg = async (organizationId: string) => {
	const [row] = await db
		.select()
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, organizationId))
		.limit(1)
	return row ?? null
}

