import { Resolver } from "node:dns/promises"
import net from "node:net"
import { db } from "@dokploy/server/db"
import {
	domainConnectionCheck,
	domainConnectionCheckStatus,
} from "@dokploy/server/db/schema/domain-connection-check"
import { eq, inArray } from "drizzle-orm"
import { resolveDomainTargetById } from "./domain-target"

type DomainConnectionStatus =
	(typeof domainConnectionCheckStatus.enumValues)[number]

type DnsResult = {
	resolvers: string[]
	a: string[]
	aaaa: string[]
	cname: string[]
}

type PortCheck = {
	ok: boolean
	error?: string
	durationMs: number
}

type ReachabilityResult = {
	targetIp: string
	ports: Record<"80" | "443", PortCheck>
}

const DEFAULT_RESOLVERS = ["1.1.1.1", "8.8.8.8"] as const

const nowIso = () => new Date().toISOString()

const safeResolve = async <T>(
	fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
	try {
		return { ok: true, value: await fn() }
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Unknown error"
		return { ok: false, error: msg }
	}
}

const checkTcpPort = async (opts: {
	host: string
	port: 80 | 443
	timeoutMs: number
}): Promise<PortCheck> =>
	new Promise((resolve) => {
		const startedAt = Date.now()
		const socket = new net.Socket()

		const finish = (result: PortCheck) => {
			socket.removeAllListeners()
			socket.destroy()
			resolve(result)
		}

		socket.setTimeout(opts.timeoutMs)
		socket.once("connect", () => {
			finish({ ok: true, durationMs: Date.now() - startedAt })
		})
		socket.once("timeout", () => {
			finish({
				ok: false,
				error: "timeout",
				durationMs: Date.now() - startedAt,
			})
		})
		socket.once("error", (err) => {
			finish({
				ok: false,
				error: err.message,
				durationMs: Date.now() - startedAt,
			})
		})

		socket.connect(opts.port, opts.host)
	})

export const getDomainConnectionStatus = async (domainId: string) => {
	const [row] = await db
		.select()
		.from(domainConnectionCheck)
		.where(eq(domainConnectionCheck.domainId, domainId))
		.limit(1)
	return row ?? null
}

export const verifyDomainConnection = async (domainId: string) => {
	const target = await resolveDomainTargetById(domainId)
	const checkedAt = nowIso()

	const baseUpsert = async (patch: {
		status: DomainConnectionStatus
		message?: string | null
		lastDnsResult?: DnsResult | null
		lastReachabilityResult?: ReachabilityResult | null
		lastVerifiedAt?: string | null
	}) => {
		await db
			.insert(domainConnectionCheck)
			.values({
				domainId: target.domainId,
				targetServerId: target.targetServerId,
				expectedA: target.expectedA,
				expectedAAAA: target.expectedAAAA,
				status: patch.status,
				lastCheckedAt: checkedAt,
				lastVerifiedAt: patch.lastVerifiedAt ?? null,
				lastDnsResult: patch.lastDnsResult ?? null,
				lastReachabilityResult: patch.lastReachabilityResult ?? null,
				message: patch.message ?? null,
			})
			.onConflictDoUpdate({
				target: domainConnectionCheck.domainId,
				set: {
					targetServerId: target.targetServerId,
					expectedA: target.expectedA,
					expectedAAAA: target.expectedAAAA,
					status: patch.status,
					lastCheckedAt: checkedAt,
					lastVerifiedAt: patch.lastVerifiedAt ?? null,
					lastDnsResult: patch.lastDnsResult ?? null,
					lastReachabilityResult: patch.lastReachabilityResult ?? null,
					message: patch.message ?? null,
				},
			})
	}

	if (!target.expectedA) {
		await baseUpsert({
			status: "error",
			message: "No target server IP available for this domain.",
		})
		return await getDomainConnectionStatus(domainId)
	}

	await baseUpsert({ status: "checking", message: null })

	const resolver = new Resolver()
	resolver.setServers([...DEFAULT_RESOLVERS])

	const host = target.host
	const aRes = await safeResolve(() => resolver.resolve4(host))
	const aaaaRes = await safeResolve(() => resolver.resolve6(host))
	const cnameRes = await safeResolve(() => resolver.resolveCname(host))

	const dnsResult: DnsResult = {
		resolvers: [...DEFAULT_RESOLVERS],
		a: aRes.ok ? aRes.value : [],
		aaaa: aaaaRes.ok ? aaaaRes.value : [],
		cname: cnameRes.ok ? cnameRes.value : [],
	}

	const hasAnyAnswer =
		dnsResult.a.length > 0 || dnsResult.aaaa.length > 0 || dnsResult.cname.length > 0

	if (!hasAnyAnswer) {
		await baseUpsert({
			status: "dns_no_answer",
			lastDnsResult: dnsResult,
			message:
				"DNS has no public answers yet. DNS changes can take time to propagate.",
		})
		return await getDomainConnectionStatus(domainId)
	}

	const dnsOk = dnsResult.a.includes(target.expectedA)
	if (!dnsOk) {
		const got = dnsResult.a.length ? dnsResult.a.join(", ") : "no A answers"
		await baseUpsert({
			status: "dns_mismatch",
			lastDnsResult: dnsResult,
			message: `DNS points to ${got}; expected ${target.expectedA}.`,
		})
		return await getDomainConnectionStatus(domainId)
	}

	const port80 = await checkTcpPort({
		host: target.expectedA,
		port: 80,
		timeoutMs: 3000,
	})
	const port443 = await checkTcpPort({
		host: target.expectedA,
		port: 443,
		timeoutMs: 3000,
	})
	const reachability: ReachabilityResult = {
		targetIp: target.expectedA,
		ports: { "80": port80, "443": port443 },
	}

	const reachable = port80.ok || port443.ok
	if (!reachable) {
		await baseUpsert({
			status: "server_unreachable",
			lastDnsResult: dnsResult,
			lastReachabilityResult: reachability,
			message:
				"DNS is correct, but ports 80/443 are unreachable. Check firewall/security group rules on the target server.",
		})
		return await getDomainConnectionStatus(domainId)
	}

	await baseUpsert({
		status: "active",
		lastDnsResult: dnsResult,
		lastReachabilityResult: reachability,
		lastVerifiedAt: checkedAt,
		message: "Domain is connected.",
	})

	return await getDomainConnectionStatus(domainId)
}

const minIntervalMsForStatus = (status: DomainConnectionStatus) => {
	switch (status) {
		case "checking":
			return 2 * 60 * 1000
		case "dns_no_answer":
			return 10 * 60 * 1000
		case "dns_mismatch":
		case "server_unreachable":
			return 30 * 60 * 1000
		case "pending":
		case "error":
		default:
			return 60 * 60 * 1000
	}
}

export const pollDomainConnectionsOnce = async (opts?: {
	limit?: number
}): Promise<{ checked: number }> => {
	const limit = opts?.limit ?? 20
	const candidates = await db
		.select()
		.from(domainConnectionCheck)
		.where(
			inArray(domainConnectionCheck.status, [
				"pending",
				"checking",
				"dns_mismatch",
				"dns_no_answer",
				"server_unreachable",
				"error",
			]),
		)
		.limit(limit)

	let checked = 0
	const now = Date.now()

	for (const c of candidates) {
		const last = c.lastCheckedAt ? Date.parse(c.lastCheckedAt) : 0
		const status = c.status as DomainConnectionStatus
		const minInterval = minIntervalMsForStatus(status)
		const due = !last || now - last >= minInterval
		if (!due) continue

		try {
			await verifyDomainConnection(c.domainId)
			checked += 1
		} catch (e) {
			console.error("[domain-connection] poll error", e)
		}
	}

	return { checked }
}
