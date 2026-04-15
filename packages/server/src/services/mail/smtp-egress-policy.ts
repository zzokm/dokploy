import { spawn } from "node:child_process"

const run = async (command: string, args: string[]) => {
	return await new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
		const child = spawn(command, args, { stdio: "ignore" })
		child.on("error", (err) => resolve({ ok: false, error: err.message }))
		child.on("close", (code) =>
			resolve(code === 0 ? { ok: true } : { ok: false, error: `${command} exited ${code}` }),
		)
	})
}

/**
 * Best-effort cross-platform enforcement that tenant containers should not deliver SMTP via port 25.
 *
 * - Linux: inserts a DOCKER-USER rule to reject forwarded tcp/25 egress.
 * - Windows/macOS: cannot reliably enforce at host firewall level from Dokploy, so we return skipped.
 *
 * NOTE: This does not affect inbound traffic to the mailserver container, only forwarded container egress.
 */
export const ensureNoContainerSmtp25Egress = async () => {
	if (process.platform !== "linux") {
		return { ok: true as const, applied: false as const, reason: "non_linux" as const }
	}

	// Use DOCKER-USER so rules persist across Docker restarts and apply to all bridge networks.
	const rule = ["-p", "tcp", "--dport", "25", "-j", "REJECT"]

	// Check if the rule already exists
	const exists = await run("iptables", ["-C", "DOCKER-USER", ...rule])
	if (exists.ok) {
		return { ok: true as const, applied: false as const, reason: "already_present" as const }
	}

	// Insert rule near the top so it runs before ACCEPT rules.
	const inserted = await run("iptables", ["-I", "DOCKER-USER", "1", ...rule])
	if (!inserted.ok) {
		return {
			ok: false as const,
			applied: false as const,
			error: inserted.error,
		}
	}

	return { ok: true as const, applied: true as const }
}

