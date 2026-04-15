import { eq, and } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import type * as schema from "../../db/schema"
import { hostedDomain } from "../../db/schema/hosted-domain"

export const listHostedDomains = async (
	db: PostgresJsDatabase<typeof schema>,
	organizationId: string,
) => {
	return await db
		.select()
		.from(hostedDomain)
		.where(eq(hostedDomain.organizationId, organizationId))
}

export const getHostedDomainById = async (
	db: PostgresJsDatabase<typeof schema>,
	id: string,
	organizationId: string,
) => {
	const [row] = await db
		.select()
		.from(hostedDomain)
		.where(
			and(
				eq(hostedDomain.id, id),
				eq(hostedDomain.organizationId, organizationId),
			),
		)
		.limit(1)
	return row ?? null
}

export const createHostedDomain = async (
	db: PostgresJsDatabase<typeof schema>,
	input: {
		organizationId: string
		name: string
		isMailManaged?: boolean
		serverId?: string | null
	},
) => {
	const [row] = await db
		.insert(hostedDomain)
		.values({
			organizationId: input.organizationId,
			name: input.name.trim().toLowerCase(),
			isDnsManaged: false,
			isMailManaged: input.isMailManaged ?? false,
			serverId: input.serverId ?? null,
		})
		.returning()
	return row
}

