import type Dockerode from "dockerode"

type MailContainerPaths = {
	dovecotContainerName: string
	eximContainerName: string
}

const execAndDrain = async (
	docker: Dockerode,
	containerName: string,
	cmd: string[],
): Promise<void> => {
	const container = docker.getContainer(containerName)
	const exec = await container.exec({
		Cmd: cmd,
		AttachStdout: true,
		AttachStderr: true,
	})
	await new Promise<void>((resolve, reject) => {
		exec.start({ hijack: true, Tty: false }, (err, stream) => {
			if (err) {
				reject(err)
				return
			}
			if (!stream) {
				reject(new Error("No exec stream"))
				return
			}
			stream.on("end", () => resolve())
			stream.on("error", reject)
		})
	})
}

/**
 * Reload Dovecot (`doveadm reload`) and Exim (`SIGHUP`) after global mail auth files change.
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
		await execAndDrain(docker, p.dovecotContainerName, ["doveadm", "reload"])
	} catch {
		// Container may be absent in dev
	}
	try {
		const exim = docker.getContainer(p.eximContainerName)
		await exim.kill({ signal: "HUP" })
	} catch {
		// Exim may not be running
	}
}
