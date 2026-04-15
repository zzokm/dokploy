import { access, constants, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import type { Readable } from "node:stream"
import type { ContainerCreateOptions } from "dockerode"
import { serverPaths } from "../../constants/server-paths"
import {
	CORE_BIND_IMAGE,
	CORE_DMS_IMAGE,
	CORE_ROUNDCUBE_IMAGE,
} from "../../utils/docker/core-services"
import { getRemoteDocker } from "../../utils/servers/remote-docker"
import {
	DMS_SSL_CERT_CONTAINER_PATH,
	DMS_SSL_KEY_CONTAINER_PATH,
} from "../../utils/docker/dms-tls"

/**
 * Programmatic core-services deployment: pulls official BIND9, docker-mailserver, Roundcube images,
 * creates containers with `serverPaths()` host bind mounts, publishes DNS (53/tcp+udp), mail
 * ports on high host mappings by default, Roundcube HTTP, attaches all to `mailNetworkName`, and
 * uses `unless-stopped` restart policy.
 */
const NAMED_CONF_TEMPLATE = `// Core services — BIND 9 authoritative (generated bootstrap; zones from control plane).

options {
	directory "/var/cache/bind";
	listen-on port 53 { any; };
	listen-on-v6 port 53 { any; };
	allow-query { any; };
	recursion no;
	dnssec-validation no;
};

include "/etc/bind/named.conf.local";
`

const LEGACY_DOVECOT_CONTAINER = "core-services-dovecot"
const LEGACY_EXIM_CONTAINER = "core-services-exim"

const pullImage = async (
	docker: import("dockerode"),
	image: string,
): Promise<void> => {
	await new Promise<void>((resolve, reject) => {
		docker.pull(image, {}, (err, stream) => {
			if (err) {
				reject(err)
				return
			}
			if (!stream) {
				reject(new Error("No pull stream"))
				return
			}
			docker.modem.followProgress(
				stream as Readable,
				(followErr) => {
					if (followErr) {
						reject(followErr)
						return
					}
					resolve()
				},
				() => {},
			)
		})
	})
}

const removeIfExists = async (
	docker: import("dockerode"),
	name: string,
): Promise<void> => {
	try {
		const c = docker.getContainer(name)
		await c.remove({ force: true })
	} catch {
		// absent
	}
}

const bindMount = (host: string, container: string): string =>
	`${path.resolve(host)}:${container}:rw`

const ensureNetwork = async (
	docker: import("dockerode"),
	name: string,
): Promise<void> => {
	const nets = await docker.listNetworks()
	if (nets.some((n) => n.Name === name)) {
		return
	}
	await docker.createNetwork({ Name: name, Driver: "bridge" })
}

const ensureNamedConf = async (dnsConfigDir: string): Promise<void> => {
	const named = path.join(dnsConfigDir, "named.conf")
	try {
		await access(named, constants.F_OK)
	} catch {
		await writeFile(named, NAMED_CONF_TEMPLATE, "utf8")
	}
	const local = path.join(dnsConfigDir, "named.conf.local")
	try {
		await access(local, constants.F_OK)
	} catch {
		await writeFile(
			local,
			"// Placeholder — replaced when you Apply DNS from the panel\n",
			"utf8",
		)
	}
}

/** Minimal PEM pair so `SSL_TYPE=manual` docker-mailserver can start before Traefik ACME sync. */
const ensureDmsManualTlsBootstrap = async (sslDir: string): Promise<void> => {
	await mkdir(sslDir, { recursive: true })
	const certPath = path.join(sslDir, "cert.pem")
	const keyPath = path.join(sslDir, "key.pem")
	try {
		await access(certPath, constants.F_OK)
		await access(keyPath, constants.F_OK)
		return
	} catch {
		// generate
	}
	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			"openssl",
			[
				"req",
				"-x509",
				"-nodes",
				"-newkey",
				"rsa:2048",
				"-keyout",
				keyPath,
				"-out",
				certPath,
				"-days",
				"3650",
				"-subj",
				"/CN=dokploy-mailserver/O=Dokploy",
			],
			{ stdio: "ignore" },
		)
		child.on("error", reject)
		child.on("close", (code) => {
			if (code === 0) {
				resolve()
				return
			}
			reject(new Error(`openssl req exited ${code}`))
		})
	})
}

export type DeployCoreServicesOptions = {
	serverId?: string | null
	isServer?: boolean
}

const coreBindPort = () =>
	process.env.PANEL_CORE_BIND_HOST_PORT ??
	process.env.PANEL_INFRA_BIND_HOST_PORT ??
	"1053"

const coreDmsSmtp = () =>
	process.env.PANEL_CORE_DMS_SMTP_HOST ??
	process.env.PANEL_INFRA_DMS_SMTP ??
	process.env.PANEL_INFRA_EXIM_SMTP ??
	"3025"

const coreDmsSubmission = () =>
	process.env.PANEL_CORE_DMS_SUBMISSION_HOST ??
	process.env.PANEL_INFRA_DMS_SUBMISSION ??
	process.env.PANEL_INFRA_EXIM_SUBMISSION ??
	"3587"

const coreDmsSmtps = () =>
	process.env.PANEL_CORE_DMS_SMTPS_HOST ??
	process.env.PANEL_INFRA_DMS_SMTPS ??
	"3465"

const coreDmsImap = () =>
	process.env.PANEL_CORE_DMS_IMAP_HOST ??
	process.env.PANEL_INFRA_DMS_IMAP ??
	process.env.PANEL_INFRA_DOVECOT_IMAP ??
	"3143"

const coreDmsImaps = () =>
	process.env.PANEL_CORE_DMS_IMAPS_HOST ??
	process.env.PANEL_INFRA_DMS_IMAPS ??
	process.env.PANEL_INFRA_DOVECOT_IMAPS ??
	"3993"

const coreRoundcubeHttp = () =>
	process.env.PANEL_CORE_ROUNDCUBE_HTTP_HOST ??
	process.env.PANEL_INFRA_ROUNDCUBE_HTTP_HOST ??
	"3080"

const dmsOverrideHostname = () =>
	process.env.PANEL_DMS_OVERRIDE_HOSTNAME?.trim() || "mail.local"

const dmsPostmasterAddress = () => {
	const o = process.env.PANEL_DMS_POSTMASTER_ADDRESS?.trim()
	if (o) {
		return o
	}
	const h = dmsOverrideHostname()
	return `postmaster@${h}`
}

/**
 * Programmatically pulls and starts BIND, docker-mailserver (Postfix + Dovecot), and Roundcube with
 * host binds aligned to `serverPaths()`.
 */
export const deployCoreServices = async (
	opts: DeployCoreServicesOptions = {},
): Promise<void> => {
	const docker = await getRemoteDocker(opts.serverId ?? undefined)
	const p = serverPaths(opts.isServer ?? false)
	const networkName = p.mailNetworkName

	await mkdir(p.dnsConfigDir, { recursive: true })
	await mkdir(path.join(p.dnsConfigDir, "zones"), { recursive: true })
	await mkdir(p.dnsCacheDir, { recursive: true })
	await mkdir(p.mailAuthDir, { recursive: true })
	await mkdir(p.mailDataDir, { recursive: true })
	await mkdir(p.mailStateDir, { recursive: true })
	await mkdir(p.mailLogsDir, { recursive: true })
	await mkdir(p.mailDmsConfigDir, { recursive: true })
	await mkdir(p.mailTlsDir, { recursive: true })
	await mkdir(p.dkimKeysDir, { recursive: true })
	await mkdir(path.join(p.baseDir, "mail", "roundcube"), { recursive: true })
	const roundcubeConfigDir = path.join(p.baseDir, "mail", "roundcube-config")
	await mkdir(roundcubeConfigDir, { recursive: true })
	const roundcubeTlsSnippet = path.join(
		roundcubeConfigDir,
		"zz-dokploy-internal-tls.inc.php",
	)
	await writeFile(
		roundcubeTlsSnippet,
		`<?php
/**
 * Dokploy data plane: Roundcube reaches docker-mailserver by Docker DNS name while the
 * server certificate is issued for OVERRIDE_HOSTNAME (public mail host). Relax TLS
 * verification only for this private bridge network hop.
 */
$config['imap_conn_options'] = [
	'ssl' => [
		'verify_peer' => false,
		'verify_peer_name' => false,
		'allow_self_signed' => true,
	],
];
$config['smtp_conn_options'] = [
	'ssl' => [
		'verify_peer' => false,
		'verify_peer_name' => false,
		'allow_self_signed' => true,
	],
];
`,
		"utf8",
	)

	const dmsSslHost = path.join(p.mailDmsConfigDir, "ssl")
	await ensureDmsManualTlsBootstrap(dmsSslHost)

	await ensureNamedConf(p.dnsConfigDir)
	await ensureNetwork(docker, networkName)

	const bindHostPort = coreBindPort()
	const dms25 = coreDmsSmtp()
	const dms587 = coreDmsSubmission()
	const dms465 = coreDmsSmtps()
	const dms143 = coreDmsImap()
	const dms993 = coreDmsImaps()
	const rcHttpHost = coreRoundcubeHttp()

	const images = [CORE_BIND_IMAGE, CORE_DMS_IMAGE, CORE_ROUNDCUBE_IMAGE] as const
	for (const img of images) {
		await pullImage(docker, img)
	}

	await removeIfExists(docker, p.roundcubeContainerName)
	await removeIfExists(docker, p.mailserverContainerName)
	await removeIfExists(docker, LEGACY_DOVECOT_CONTAINER)
	await removeIfExists(docker, LEGACY_EXIM_CONTAINER)
	await removeIfExists(docker, p.bindContainerName)

	const overrideHost = dmsOverrideHostname()
	const postmaster = dmsPostmasterAddress()

	const mailserverOpts: ContainerCreateOptions = {
		name: p.mailserverContainerName,
		Image: CORE_DMS_IMAGE,
		ExposedPorts: {
			"25/tcp": {},
			"143/tcp": {},
			"465/tcp": {},
			"587/tcp": {},
			"993/tcp": {},
		},
		Env: [
			"ENABLE_SPAMASSASSIN=1",
			"ENABLE_CLAMAV=0",
			"ENABLE_FAIL2BAN=1",
			"ENABLE_POSTGREY=0",
			"ONE_DIR=1",
			"DMS_DEBUG=0",
			"SSL_TYPE=manual",
			`SSL_CERT_PATH=${DMS_SSL_CERT_CONTAINER_PATH}`,
			`SSL_KEY_PATH=${DMS_SSL_KEY_CONTAINER_PATH}`,
			`OVERRIDE_HOSTNAME=${overrideHost}`,
			`POSTMASTER_ADDRESS=${postmaster}`,
		],
		HostConfig: {
			Binds: [
				bindMount(p.mailDataDir, "/var/mail"),
				bindMount(p.mailStateDir, "/var/mail-state"),
				bindMount(p.mailLogsDir, "/var/log/mail"),
				bindMount(p.mailDmsConfigDir, "/tmp/docker-mailserver"),
			],
			PortBindings: {
				"25/tcp": [{ HostPort: dms25 }],
				"587/tcp": [{ HostPort: dms587 }],
				"465/tcp": [{ HostPort: dms465 }],
				"143/tcp": [{ HostPort: dms143 }],
				"993/tcp": [{ HostPort: dms993 }],
			},
			RestartPolicy: { Name: "unless-stopped" },
		},
		NetworkingConfig: {
			EndpointsConfig: {
				[networkName]: {},
			},
		},
	}

	const bindOpts: ContainerCreateOptions = {
		name: p.bindContainerName,
		Image: CORE_BIND_IMAGE,
		ExposedPorts: {
			"53/tcp": {},
			"53/udp": {},
		},
		HostConfig: {
			Binds: [
				bindMount(p.dnsConfigDir, "/etc/bind"),
				bindMount(p.dnsCacheDir, "/var/cache/bind"),
			],
			PortBindings: {
				"53/tcp": [{ HostPort: bindHostPort }],
				"53/udp": [{ HostPort: bindHostPort }],
			},
			RestartPolicy: { Name: "unless-stopped" },
		},
		NetworkingConfig: {
			EndpointsConfig: {
				[networkName]: {},
			},
		},
	}

	const ms = p.mailserverContainerName
	/** Traefik Docker provider: HTTPS for webmail.<any> and mail.<any> → Roundcube :80 */
	const roundcubeTraefikRule = "HostRegexp(`^(webmail|mail)\\..+$`)"
	const roundcubeOpts: ContainerCreateOptions = {
		name: p.roundcubeContainerName,
		Image: CORE_ROUNDCUBE_IMAGE,
		Labels: {
			"traefik.enable": "true",
			"traefik.docker.network": networkName,
			"traefik.http.routers.roundcube.rule": roundcubeTraefikRule,
			"traefik.http.routers.roundcube.entrypoints": "websecure",
			"traefik.http.routers.roundcube.tls.certresolver": "letsencrypt",
			"traefik.http.routers.roundcube.service": "roundcube",
			"traefik.http.services.roundcube.loadbalancer.server.port": "80",
		},
		ExposedPorts: {
			"80/tcp": {},
		},
		Env: [
			`ROUNDCUBEMAIL_DEFAULT_HOST=ssl://${ms}`,
			"ROUNDCUBEMAIL_DEFAULT_PORT=993",
			`ROUNDCUBEMAIL_SMTP_SERVER=tls://${ms}`,
			"ROUNDCUBEMAIL_SMTP_PORT=587",
			"ROUNDCUBEMAIL_DB_TYPE=sqlite",
		],
		HostConfig: {
			Binds: [
				bindMount(path.join(p.baseDir, "mail", "roundcube"), "/var/roundcube/db"),
				bindMount(roundcubeConfigDir, "/var/roundcube/config"),
			],
			PortBindings: {
				"80/tcp": [{ HostPort: rcHttpHost }],
			},
			RestartPolicy: { Name: "unless-stopped" },
		},
		NetworkingConfig: {
			EndpointsConfig: {
				[networkName]: {},
			},
		},
	}

	await docker.createContainer(bindOpts)
	await docker.createContainer(mailserverOpts)
	await docker.createContainer(roundcubeOpts)

	await docker.getContainer(p.bindContainerName).start()
	await docker.getContainer(p.mailserverContainerName).start()
	await docker.getContainer(p.roundcubeContainerName).start()
}
