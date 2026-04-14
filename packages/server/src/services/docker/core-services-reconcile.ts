import { serverPaths } from "../../constants/server-paths"
import { getRemoteDocker } from "../../utils/servers/remote-docker"
import { deployCoreServices } from "./bootstrap-core-services"

export type CoreServiceName = "bind" | "mailserver" | "roundcube"

export type CoreServiceStatus = {
	name: CoreServiceName
	containerName: string
	exists: boolean
	running: boolean
	healthy?: boolean
	state?: string
	error?: string
}

export type CoreServicesStatus = {
	networkName: string
	services: CoreServiceStatus[]
}

const ensureNetworkExists = async (
	docker: import("dockerode"),
	networkName: string,
) => {
	const existing = await docker.listNetworks()
	if (existing.some((n) => n.Name === networkName)) {
		return
	}

	// Prefer overlay on swarm-capable installs so containers can attach to the same
	// attachable network Traefik uses. Fall back to bridge for local/dev.
	let driver: "overlay" | "bridge" = "bridge"
	try {
		const info = await docker.info()
		const swarmState = (info as { Swarm?: { LocalNodeState?: string } }).Swarm
			?.LocalNodeState
		if (swarmState === "active") {
			driver = "overlay"
		}
	} catch {
		// If docker.info fails, keep bridge.
	}

	await docker.createNetwork({
		Name: networkName,
		Driver: driver,
		Attachable: true,
	})
}

const inspectContainerSafe = async (
	docker: import("dockerode"),
	containerName: string,
) => {
	try {
		const c = docker.getContainer(containerName)
		const i = await c.inspect()
		return { ok: true as const, inspect: i }
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Unknown error"
		return { ok: false as const, error: msg }
	}
}

const ensureConnectedToNetwork = async (
	docker: import("dockerode"),
	containerName: string,
	networkName: string,
) => {
	const inspected = await inspectContainerSafe(docker, containerName)
	if (!inspected.ok) {
		return
	}
	const networks = inspected.inspect?.NetworkSettings?.Networks ?? {}
	if (networks && typeof networks === "object" && networkName in networks) {
		return
	}

	try {
		await docker.getNetwork(networkName).connect({ Container: containerName })
	} catch {
		// Ignore connect race; reconcile is best-effort.
	}
}

export const getCoreServicesStatus = async (
	opts: { serverId?: string | null; isServer?: boolean } = {},
): Promise<CoreServicesStatus> => {
	const docker = await getRemoteDocker(opts.serverId ?? undefined)
	const p = serverPaths(opts.isServer ?? false)

	const services: Array<{ name: CoreServiceName; containerName: string }> = [
		{ name: "bind", containerName: p.bindContainerName },
		{ name: "mailserver", containerName: p.mailserverContainerName },
		{ name: "roundcube", containerName: p.roundcubeContainerName },
	]

	const statuses: CoreServiceStatus[] = []
	for (const s of services) {
		const inspected = await inspectContainerSafe(docker, s.containerName)
		if (!inspected.ok) {
			statuses.push({
				name: s.name,
				containerName: s.containerName,
				exists: false,
				running: false,
				error: inspected.error,
			})
			continue
		}

		const state = inspected.inspect.State
		const running = !!state?.Running
		const health = state?.Health?.Status
		statuses.push({
			name: s.name,
			containerName: s.containerName,
			exists: true,
			running,
			healthy: health ? health === "healthy" : undefined,
			state: health ?? state?.Status ?? undefined,
		})
	}

	return { networkName: p.mailNetworkName, services: statuses }
}

export const reconcileCoreServices = async (
	opts: { serverId?: string | null; isServer?: boolean } = {},
): Promise<CoreServicesStatus> => {
	const docker = await getRemoteDocker(opts.serverId ?? undefined)
	const p = serverPaths(opts.isServer ?? false)

	await ensureNetworkExists(docker, p.mailNetworkName)

	const reconcileAllContainers = async () => {
		const status = await getCoreServicesStatus(opts)
		for (const s of status.services) {
			if (s.exists && !s.running) {
				try {
					await docker.getContainer(s.containerName).start()
				} catch {
					// best-effort; a later redeploy can fix config issues
				}
			}
			if (s.exists) {
				await ensureConnectedToNetwork(docker, s.containerName, p.mailNetworkName)
			}
		}
	}

	const status = await getCoreServicesStatus(opts)
	const missingAny = status.services.some((s) => !s.exists)
	if (missingAny) {
		await deployCoreServices(opts)
		await reconcileAllContainers()
		return getCoreServicesStatus(opts)
	}

	let needRedeploy = false
	for (const s of status.services) {
		if (!s.running) {
			try {
				await docker.getContainer(s.containerName).start()
			} catch {
				needRedeploy = true
				break
			}
		}
		await ensureConnectedToNetwork(docker, s.containerName, p.mailNetworkName)
	}

	if (needRedeploy) {
		// If any service couldn't be started, rebuild the stack and then ensure
		// network connections for *all* services.
		await deployCoreServices(opts)
		await reconcileAllContainers()
	}

	return getCoreServicesStatus(opts)
}

