import { access, constants, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { ContainerCreateOptions } from "dockerode";
import { serverPaths } from "../../constants/server-paths";
import {
	CORE_BIND_IMAGE,
	CORE_DOVECOT_IMAGE,
	CORE_EXIM_IMAGE,
	CORE_ROUNDCUBE_IMAGE,
} from "../../utils/docker/core-services";
import { getRemoteDocker } from "../../utils/servers/remote-docker";

/**
 * Programmatic core-services deployment: pulls official BIND9, Exim, Dovecot, Roundcube images,
 * creates containers with `serverPaths()` host bind mounts, publishes DNS (53/tcp+udp), SMTP (25; reference image has no 587 listener),
 * IMAP (143, 993), Roundcube HTTP, attaches all to `mailNetworkName`, and uses `unless-stopped` restart policy.
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
`;

const pullImage = async (
	docker: import("dockerode"),
	image: string,
): Promise<void> => {
	await new Promise<void>((resolve, reject) => {
		docker.pull(image, {}, (err, stream) => {
			if (err) {
				reject(err);
				return;
			}
			if (!stream) {
				reject(new Error("No pull stream"));
				return;
			}
			docker.modem.followProgress(
				stream as Readable,
				(followErr) => {
					if (followErr) {
						reject(followErr);
						return;
					}
					resolve();
				},
				() => {},
			);
		});
	});
};

const removeIfExists = async (
	docker: import("dockerode"),
	name: string,
): Promise<void> => {
	try {
		const c = docker.getContainer(name);
		await c.remove({ force: true });
	} catch {
		// absent
	}
};

const bindMount = (host: string, container: string): string =>
	`${path.resolve(host)}:${container}:rw`;

const ensureNetwork = async (
	docker: import("dockerode"),
	name: string,
): Promise<void> => {
	const nets = await docker.listNetworks();
	if (nets.some((n) => n.Name === name)) {
		return;
	}
	await docker.createNetwork({ Name: name, Driver: "bridge" });
};

const ensureNamedConf = async (dnsConfigDir: string): Promise<void> => {
	const named = path.join(dnsConfigDir, "named.conf");
	try {
		await access(named, constants.F_OK);
	} catch {
		await writeFile(named, NAMED_CONF_TEMPLATE, "utf8");
	}
	const local = path.join(dnsConfigDir, "named.conf.local");
	try {
		await access(local, constants.F_OK);
	} catch {
		await writeFile(
			local,
			"// Placeholder — replaced when you Apply DNS from the panel\n",
			"utf8",
		);
	}
};

export type DeployCoreServicesOptions = {
	serverId?: string | null;
	isServer?: boolean;
};

const coreBindPort = () =>
	process.env.PANEL_CORE_BIND_HOST_PORT ??
	process.env.PANEL_INFRA_BIND_HOST_PORT ??
	"1053";

const coreEximSmtp = () =>
	process.env.PANEL_CORE_EXIM_SMTP_HOST ??
	process.env.PANEL_INFRA_EXIM_SMTP_HOST ??
	"3025";

const coreEximSubmit = () =>
	process.env.PANEL_CORE_EXIM_SUBMISSION_HOST ??
	process.env.PANEL_INFRA_EXIM_SUBMISSION_HOST ??
	"3587";

const coreDoveImap = () =>
	process.env.PANEL_CORE_DOVECOT_IMAP_HOST ??
	process.env.PANEL_INFRA_DOVECOT_IMAP_HOST ??
	"3143";

const coreDoveImaps = () =>
	process.env.PANEL_CORE_DOVECOT_IMAPS_HOST ??
	process.env.PANEL_INFRA_DOVECOT_IMAPS_HOST ??
	"3993";

const coreRoundcubeHttp = () =>
	process.env.PANEL_CORE_ROUNDCUBE_HTTP_HOST ??
	process.env.PANEL_INFRA_ROUNDCUBE_HTTP_HOST ??
	"3080";

/**
 * Programmatically pulls and starts BIND, Dovecot, Exim, and Roundcube with
 * host binds aligned to `serverPaths()`.
 */
export const deployCoreServices = async (
	opts: DeployCoreServicesOptions = {},
): Promise<void> => {
	const docker = await getRemoteDocker(opts.serverId ?? undefined);
	const p = serverPaths(opts.isServer ?? false);
	const networkName = p.mailNetworkName;

	await mkdir(p.dnsConfigDir, { recursive: true });
	await mkdir(path.join(p.dnsConfigDir, "zones"), { recursive: true });
	await mkdir(p.dnsCacheDir, { recursive: true });
	await mkdir(p.mailAuthDir, { recursive: true });
	await mkdir(p.mailDataDir, { recursive: true });
	await mkdir(p.mailTlsDir, { recursive: true });
	await mkdir(p.dkimKeysDir, { recursive: true });
	await mkdir(path.join(p.baseDir, "mail", "roundcube"), { recursive: true });

	await ensureNamedConf(p.dnsConfigDir);
	await ensureNetwork(docker, networkName);

	const bindHostPort = coreBindPort();
	const eximSmtpHost = coreEximSmtp();
	const eximSubmitHost = coreEximSubmit();
	const doveImapHost = coreDoveImap();
	const doveImapsHost = coreDoveImaps();
	const rcHttpHost = coreRoundcubeHttp();

	const images = [
		CORE_BIND_IMAGE,
		CORE_DOVECOT_IMAGE,
		CORE_EXIM_IMAGE,
		CORE_ROUNDCUBE_IMAGE,
	] as const;
	for (const img of images) {
		await pullImage(docker, img);
	}

	await removeIfExists(docker, p.bindContainerName);
	await removeIfExists(docker, p.dovecotContainerName);
	await removeIfExists(docker, p.eximContainerName);
	await removeIfExists(docker, p.roundcubeContainerName);

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
	};

	const doveOpts: ContainerCreateOptions = {
		name: p.dovecotContainerName,
		Image: CORE_DOVECOT_IMAGE,
		ExposedPorts: {
			"143/tcp": {},
			"993/tcp": {},
		},
		HostConfig: {
			Binds: [
				bindMount(p.mailAuthDir, "/etc/mail-auth"),
				bindMount(p.mailDataDir, "/var/mail"),
				bindMount(p.mailTlsDir, "/etc/dovecot/tls"),
			],
			PortBindings: {
				"143/tcp": [{ HostPort: doveImapHost }],
				"993/tcp": [{ HostPort: doveImapsHost }],
			},
			RestartPolicy: { Name: "unless-stopped" },
		},
		NetworkingConfig: {
			EndpointsConfig: {
				[networkName]: {},
			},
		},
	};

	const exim25HostPorts: Array<{ HostPort: string }> = [
		{ HostPort: eximSmtpHost },
	];
	if (eximSubmitHost !== eximSmtpHost) {
		exim25HostPorts.push({ HostPort: eximSubmitHost });
	}

	const eximOpts: ContainerCreateOptions = {
		name: p.eximContainerName,
		Image: CORE_EXIM_IMAGE,
		ExposedPorts: {
			"25/tcp": {},
		},
		HostConfig: {
			Binds: [
				bindMount(p.mailAuthDir, "/etc/mail-auth"),
				bindMount(p.mailDataDir, "/var/mail"),
				bindMount(p.mailTlsDir, "/etc/exim4/tls"),
			],
			PortBindings: {
				"25/tcp": exim25HostPorts,
			},
			RestartPolicy: { Name: "unless-stopped" },
		},
		NetworkingConfig: {
			EndpointsConfig: {
				[networkName]: {},
			},
		},
	};

	const rcDb = path.join(p.baseDir, "mail", "roundcube");
	/** Traefik Docker provider: HTTPS for webmail.<any> and mail.<any> → Roundcube :80 */
	const roundcubeTraefikRule = "HostRegexp(`^(webmail|mail)\\..+$`)";
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
			`ROUNDCUBEMAIL_DEFAULT_HOST=${p.dovecotContainerName}`,
			"ROUNDCUBEMAIL_DEFAULT_PORT=143",
			`ROUNDCUBEMAIL_SMTP_SERVER=${p.eximContainerName}`,
			"ROUNDCUBEMAIL_SMTP_PORT=25",
			"ROUNDCUBEMAIL_DB_TYPE=sqlite",
		],
		HostConfig: {
			Binds: [bindMount(rcDb, "/var/roundcube/db")],
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
	};

	await docker.createContainer(bindOpts);
	await docker.createContainer(doveOpts);
	await docker.createContainer(eximOpts);
	await docker.createContainer(roundcubeOpts);

	await docker.getContainer(p.bindContainerName).start();
	await docker.getContainer(p.dovecotContainerName).start();
	await docker.getContainer(p.eximContainerName).start();
	await docker.getContainer(p.roundcubeContainerName).start();
};
