import net from "node:net"

const PREFIX = "[DOMAIN_CREATE_DEBUG]"

export type DomainCreateDebugDump = {
	at: string
	domainId?: string
	stage: string
	inputSnapshot?: Record<string, unknown>
	errorName?: string
	errorMessage?: string
	errorStack?: string
	causeName?: string
	causeMessage?: string
	causeCode?: string | number
	causeStack?: string
	causeRaw?: string
}

/** Extract underlying Postgres / driver cause from DrizzleQueryError wrappers. */
export const getUnderlyingErrorMessage = (error: unknown): string => {
	if (!(error instanceof Error)) {
		return String(error)
	}

	const parts: string[] = [error.message]
	let current: unknown = (error as Error & { cause?: unknown }).cause
	let depth = 0
	while (current && depth < 5) {
		if (current instanceof Error) {
			parts.push(current.message)
			const code = (current as Error & { code?: string | number }).code
			if (code !== undefined) {
				parts.push(`code=${code}`)
			}
			current = (current as Error & { cause?: unknown }).cause
		} else if (typeof current === "object" && current !== null) {
			const obj = current as {
				message?: string
				code?: string | number
			}
			if (obj.message) parts.push(obj.message)
			if (obj.code !== undefined) parts.push(`code=${obj.code}`)
			break
		} else {
			parts.push(String(current))
			break
		}
		depth += 1
	}

	return parts.filter(Boolean).join(" | ")
}

export const buildDomainCreateDebugDump = (input: {
	stage: string
	domainId?: string
	error: unknown
	inputSnapshot?: Record<string, unknown>
}): DomainCreateDebugDump => {
	const err = input.error
	const cause =
		err instanceof Error
			? (err as Error & { cause?: unknown }).cause
			: undefined

	const causeObj =
		cause && typeof cause === "object"
			? (cause as {
					name?: string
					message?: string
					code?: string | number
					stack?: string
				})
			: null

	return {
		at: new Date().toISOString(),
		domainId: input.domainId,
		stage: input.stage,
		inputSnapshot: input.inputSnapshot,
		errorName: err instanceof Error ? err.name : typeof err,
		errorMessage: err instanceof Error ? err.message : String(err),
		errorStack: err instanceof Error ? err.stack : undefined,
		causeName:
			cause instanceof Error
				? cause.name
				: causeObj?.name,
		causeMessage:
			cause instanceof Error
				? cause.message
				: causeObj?.message,
		causeCode:
			cause instanceof Error
				? (cause as Error & { code?: string | number }).code
				: causeObj?.code,
		causeStack: cause instanceof Error ? cause.stack : undefined,
		causeRaw:
			cause !== undefined
				? (() => {
						try {
							return JSON.stringify(
								cause,
								Object.getOwnPropertyNames(
									cause as object,
								),
							)
						} catch {
							return String(cause)
						}
					})()
				: undefined,
	}
}

/** Upload a text dump to termbin.com (TCP 9999). Returns URL or null. */
export const uploadDebugDumpToTermbin = async (
	text: string,
	timeoutMs = 8000,
): Promise<string | null> => {
	return new Promise((resolve) => {
		const socket = net.connect(9999, "termbin.com")
		let settled = false
		let data = ""

		const finish = (url: string | null) => {
			if (settled) return
			settled = true
			try {
				socket.destroy()
			} catch {
				// ignore
			}
			resolve(url)
		}

		const timer = setTimeout(() => finish(null), timeoutMs)

		socket.on("connect", () => {
			socket.end(text)
		})
		socket.on("data", (chunk) => {
			data += chunk.toString("utf8")
		})
		socket.on("end", () => {
			clearTimeout(timer)
			const url = data.trim().split(/\s+/)[0] || null
			finish(url && url.startsWith("http") ? url : null)
		})
		socket.on("error", () => {
			clearTimeout(timer)
			finish(null)
		})
	})
}

/**
 * Log a domain-create failure with full cause, then best-effort upload to termbin.
 * Always rethrows nothing — caller should rethrow after awaiting this.
 */
export const dumpDomainCreateDebug = async (input: {
	stage: string
	domainId?: string
	error: unknown
	inputSnapshot?: Record<string, unknown>
}): Promise<{ dump: DomainCreateDebugDump; termbinUrl: string | null }> => {
	const dump = buildDomainCreateDebugDump(input)
	const text = `${PREFIX}\n${JSON.stringify(dump, null, 2)}\n`

	console.error(PREFIX, "stage=", dump.stage, "domainId=", dump.domainId)
	console.error(PREFIX, "message=", getUnderlyingErrorMessage(input.error))
	console.error(PREFIX, "dump=", text)

	let termbinUrl: string | null = null
	try {
		termbinUrl = await uploadDebugDumpToTermbin(text)
		if (termbinUrl) {
			console.error(PREFIX, "termbin=", termbinUrl)
		} else {
			console.error(PREFIX, "termbin=upload_failed")
		}
	} catch (uploadError) {
		console.error(PREFIX, "termbin=upload_error", uploadError)
	}

	return { dump, termbinUrl }
}

/** Safe input snapshot for logs (no secrets). */
export const snapshotDomainCreateInput = (
	input: Record<string, unknown>,
): Record<string, unknown> => {
	const {
		host,
		path,
		port,
		https,
		domainType,
		applicationId,
		composeId,
		previewDeploymentId,
		certificateType,
		serviceName,
		dnsProvider,
		cfProxied,
		stripPath,
		internalPath,
		forwardAuthEnabled,
		customEntrypoint,
		customCertResolver,
		middlewares,
	} = input as Record<string, unknown>

	return {
		host,
		path,
		port,
		https,
		domainType,
		applicationId,
		composeId,
		previewDeploymentId,
		certificateType,
		serviceName,
		dnsProvider,
		cfProxied,
		stripPath,
		internalPath,
		forwardAuthEnabled,
		customEntrypoint,
		customCertResolver,
		middlewares,
	}
}
