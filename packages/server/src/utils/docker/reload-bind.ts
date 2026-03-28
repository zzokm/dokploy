import type Dockerode from "dockerode"

export const rndcReloadBind = async (
	docker: Dockerode,
	containerName: string,
): Promise<void> => {
	const container = docker.getContainer(containerName)
	const exec = await container.exec({
		Cmd: ["rndc", "reload"],
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
