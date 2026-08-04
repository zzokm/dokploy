import { eq } from "drizzle-orm"
import { db } from "@dokploy/server/db"
import { domains } from "@dokploy/server/db/schema"
import { resolveDomainTargetById } from "../domain-target"
import { cloudflareFetch } from "./client"
import {
	type CloudflareDnsRecord,
	type CloudflareDnsRecordType,
	normalizeDnsName,
	pickCloudflareDnsRecord,
} from "./dns-record-utils"

export type { CloudflareDnsRecord, CloudflareDnsRecordType }
export { normalizeDnsName, pickCloudflareDnsRecord }

export const listCloudflareDnsRecordsByName = async (input: {
	token: string
	zoneId: string
	name: string
	type?: CloudflareDnsRecordType
}) => {
	return await cloudflareFetch<CloudflareDnsRecord[]>({
		token: input.token,
		method: "GET",
		path: `/zones/${input.zoneId}/dns_records`,
		query: {
			name: normalizeDnsName(input.name),
			...(input.type ? { type: input.type } : {}),
		},
	})
}

export const createCloudflareDnsRecord = async (input: {
	token: string
	zoneId: string
	type: CloudflareDnsRecordType
	name: string
	content: string
	ttl: 1 | number
	proxied?: boolean
	priority?: number
}) => {
	return await cloudflareFetch<CloudflareDnsRecord>({
		token: input.token,
		method: "POST",
		path: `/zones/${input.zoneId}/dns_records`,
		body: {
			type: input.type,
			name: normalizeDnsName(input.name),
			content: input.content,
			ttl: input.ttl,
			...(input.priority !== undefined ? { priority: input.priority } : {}),
			...(input.proxied !== undefined ? { proxied: input.proxied } : {}),
		},
	})
}

export const updateCloudflareDnsRecord = async (input: {
	token: string
	zoneId: string
	recordId: string
	type: CloudflareDnsRecordType
	name: string
	content: string
	ttl: 1 | number
	proxied?: boolean
	priority?: number
}) => {
	return await cloudflareFetch<CloudflareDnsRecord>({
		token: input.token,
		method: "PUT",
		path: `/zones/${input.zoneId}/dns_records/${input.recordId}`,
		body: {
			type: input.type,
			name: normalizeDnsName(input.name),
			content: input.content,
			ttl: input.ttl,
			...(input.priority !== undefined ? { priority: input.priority } : {}),
			...(input.proxied !== undefined ? { proxied: input.proxied } : {}),
		},
	})
}

export const deleteCloudflareDnsRecord = async (input: {
	token: string
	zoneId: string
	recordId: string
}) => {
	return await cloudflareFetch<{ id: string }>({
		token: input.token,
		method: "DELETE",
		path: `/zones/${input.zoneId}/dns_records/${input.recordId}`,
	})
}

export const upsertCloudflareDnsRecord = async (input: {
	token: string
	zoneId: string
	type: CloudflareDnsRecordType
	name: string
	content: string
	ttl: 1 | number
	proxied?: boolean
	priority?: number
	/** Prefer updating this existing Cloudflare DNS record id when present. */
	recordId?: string | null
}) => {
	const existing = await listCloudflareDnsRecordsByName({
		token: input.token,
		zoneId: input.zoneId,
		name: input.name,
		type: input.type,
	})

	const first = pickCloudflareDnsRecord(existing, {
		recordId: input.recordId,
		name: input.name,
		type: input.type,
	})

	if (!first) {
		return await createCloudflareDnsRecord(input)
	}

	const needsUpdate =
		normalizeDnsName(first.name) !== normalizeDnsName(input.name) ||
		first.content !== input.content ||
		first.ttl !== input.ttl ||
		(input.priority !== undefined &&
			(first as { priority?: number }).priority !== input.priority) ||
		(input.proxied !== undefined && first.proxied !== input.proxied)

	if (!needsUpdate) {
		return first
	}

	return await updateCloudflareDnsRecord({
		...input,
		recordId: first.id,
	})
}

export const upsertAppDnsRecord = async (input: {
	token: string
	domainId: string
	zoneId: string
	proxied: boolean
	recordType?: "A" | "AAAA" | "CNAME"
	recordId?: string | null
}) => {
	const target = await resolveDomainTargetById(input.domainId)
	if (!target.expectedA) {
		throw new Error("No target IP available for this domain")
	}

	const recordType = input.recordType ?? "A"
	if (recordType !== "A") {
		throw new Error("Only A records are supported for automated Cloudflare DNS today")
	}

	const record = await upsertCloudflareDnsRecord({
		token: input.token,
		zoneId: input.zoneId,
		type: "A",
		name: target.host,
		content: target.expectedA,
		ttl: 1,
		proxied: input.proxied,
		recordId: input.recordId,
	})

	return {
		recordId: record.id,
		recordName: record.name,
		recordType: record.type,
		recordContent: record.content,
		targetIp: target.expectedA,
	}
}

export const getDomainCloudflareConfig = async (domainId: string) => {
	const row = await db.query.domains.findFirst({
		where: eq(domains.domainId, domainId),
	})
	if (!row) {
		throw new Error("Domain not found")
	}
	return {
		dnsProvider: row.dnsProvider,
		cfZoneId: row.cfZoneId,
		cfDnsRecordId: row.cfDnsRecordId,
		cfProxied: row.cfProxied,
		cfStatus: row.cfStatus,
	}
}
