import type Dockerode from "dockerode"
import { execDmsSupervisor } from "../mail/dms-setup-exec"

type MailContainerPaths = {
	mailserverContainerName: string
}

/**
 * Reloads postfix and dovecot inside docker-mailserver after config / TLS changes.
 * Skipped when `PANEL_SKIP_MAIL_RELOAD=true` (debug).
 */
export const reloadMailServices = async (
	docker: Dockerode,
	p: MailContainerPaths,
): Promise<void> => {
	if (process.env.PANEL_SKIP_MAIL_RELOAD === "true") {
		return
	}
	try {
		await execDmsSupervisor(docker, p.mailserverContainerName, [
			"restart",
			"postfix",
		])
	} catch {
		// Container may be absent in dev
	}
	try {
		await execDmsSupervisor(docker, p.mailserverContainerName, [
			"restart",
			"dovecot",
		])
	} catch {
		// Dovecot may not be running yet
	}
}
