import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import { cloudflareSettings, cloudflareZone } from "@dokploy/server/db/schema"
import { unsealString } from "@dokploy/server/utils/crypto/seal"
import { listCloudflareZones } from "./zones"

const mapCloudflareZoneStatus = (status: string): "active" | "pending" | "disabled" => {
	if (status === "active") return "active"
	if (status === "pending") return "pending"
	return "disabled"
}

export const syncCloudflareZonesForOrg = async (organizationId: string) => {
	const [settings] = await db
		.select()
		.from(cloudflareSettings)
		.where(eq(cloudflareSettings.organizationId, organizationId))
		.limit(1)

	if (!settings) {
		return { synced: 0 }
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

	const zones = await listCloudflareZones({ token })
	const now = new Date()

	if (zones.length === 0) {
		return { synced: 0 }
	}

	await db.transaction(async (tx) => {
		for (const z of zones) {
			await tx
				.insert(cloudflareZone)
				.values({
					organizationId,
					cfZoneId: z.id,
					name: z.name,
					status: mapCloudflareZoneStatus(z.status),
					paused: !!z.paused,
					lastSyncedAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [cloudflareZone.organizationId, cloudflareZone.cfZoneId],
					set: {
						name: z.name,
						status: mapCloudflareZoneStatus(z.status),
						paused: !!z.paused,
						lastSyncedAt: now,
						updatedAt: now,
					},
				})
		}

		const cfZoneIds = zones.map((z) => z.id)
		const existing = await tx
			.select({ id: cloudflareZone.id, cfZoneId: cloudflareZone.cfZoneId })
			.from(cloudflareZone)
			.where(eq(cloudflareZone.organizationId, organizationId))
			.orderBy(desc(cloudflareZone.updatedAt))

		const missing = existing.filter((e) => !cfZoneIds.includes(e.cfZoneId))
		if (missing.length > 0) {
			await tx
				.update(cloudflareZone)
				.set({ status: "disabled", updatedAt: now })
				.where(
					and(
						eq(cloudflareZone.organizationId, organizationId),
						inArray(
							cloudflareZone.cfZoneId,
							missing.map((m) => m.cfZoneId),
						),
					),
				)
		}
	})

	return { synced: zones.length }
}

