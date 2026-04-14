import { relations } from "drizzle-orm"
import { jsonb, pgEnum, pgTable, text } from "drizzle-orm/pg-core"
import { domains } from "./domain"
import { server } from "./server"

export const domainConnectionCheckStatus = pgEnum("domainConnectionCheckStatus", [
	"pending",
	"checking",
	"active",
	"dns_mismatch",
	"dns_no_answer",
	"server_unreachable",
	"error",
])

type DnsResult = {
	resolvers: string[]
	a: string[]
	aaaa: string[]
	cname: string[]
}

type ReachabilityResult = {
	targetIp: string
	ports: Record<
		"80" | "443",
		{
			ok: boolean
			error?: string
			durationMs: number
		}
	>
}

export const domainConnectionCheck = pgTable("domain_connection_check", {
	domainId: text("domain_id")
		.primaryKey()
		.notNull()
		.references(() => domains.domainId, { onDelete: "cascade" }),
	targetServerId: text("target_server_id").references(() => server.serverId, {
		onDelete: "set null",
	}),

	expectedA: text("expected_a"),
	expectedAAAA: text("expected_aaaa"),

	status: domainConnectionCheckStatus("status").notNull().default("pending"),
	lastCheckedAt: text("last_checked_at"),
	lastVerifiedAt: text("last_verified_at"),
	lastDnsResult: jsonb("last_dns_result").$type<DnsResult>(),
	lastReachabilityResult: jsonb("last_reachability_result").$type<ReachabilityResult>(),
	message: text("message"),
})

export const domainConnectionCheckRelations = relations(
	domainConnectionCheck,
	({ one }) => ({
		domain: one(domains, {
			fields: [domainConnectionCheck.domainId],
			references: [domains.domainId],
		}),
		targetServer: one(server, {
			fields: [domainConnectionCheck.targetServerId],
			references: [server.serverId],
		}),
	}),
)

