import type Dockerode from "dockerode"

const SETUP_BIN = "/usr/local/bin/setup"

export type DmsExecResult = {
	stdout: string
	stderr: string
	exitCode: number
}

const drainExecStream = async (stream: NodeJS.ReadableStream): Promise<string> => {
	const chunks: Buffer[] = []
	for await (const chunk of stream) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
	}
	return Buffer.concat(chunks).toString("utf8")
}

/**
 * Runs `setup …` inside docker-mailserver (must run as root; DMS installs `/usr/local/bin/setup`).
 */
export const execDmsSetup = async (
	docker: Dockerode,
	containerName: string,
	setupArgs: string[],
): Promise<DmsExecResult> => {
	const container = docker.getContainer(containerName)
	const exec = await container.exec({
		Cmd: [SETUP_BIN, ...setupArgs],
		AttachStdout: true,
		AttachStderr: true,
		User: "root",
		Tty: true,
	})

	const stream = await exec.start({ hijack: true, Tty: true })
	const stdout = await drainExecStream(stream as NodeJS.ReadableStream)
	const inspect = await exec.inspect()
	const exitCode = inspect.ExitCode ?? -1
	return { stdout, stderr: "", exitCode }
}

export const execDmsSupervisor = async (
	docker: Dockerode,
	containerName: string,
	args: string[],
): Promise<DmsExecResult> => {
	const container = docker.getContainer(containerName)
	const exec = await container.exec({
		Cmd: ["/usr/bin/supervisorctl", ...args],
		AttachStdout: true,
		AttachStderr: true,
		User: "root",
		Tty: true,
	})
	const stream = await exec.start({ hijack: true, Tty: true })
	const stdout = await drainExecStream(stream as NodeJS.ReadableStream)
	const inspect = await exec.inspect()
	const exitCode = inspect.ExitCode ?? -1
	return { stdout, stderr: "", exitCode }
}
