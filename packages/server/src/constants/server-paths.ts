import path from "node:path"

const dokployBasePath = (isServer: boolean) =>
	isServer || process.env.NODE_ENV === "production"
		? "/etc/dokploy"
		: path.join(process.cwd(), ".docker")

/**
 * Host paths and env vars for core data-plane services (mail, DKIM, TLS).
 * Override with PANEL_* env vars; defaults align with Dokploy's `/etc/dokploy` layout in production.
 */
export const serverPaths = (isServer = false) => {
	const basePath = dokployBasePath(isServer)
	const dynamicTraefik = path.join(basePath, "traefik", "dynamic")
	const defaultBase =
		process.env.PANEL_CORE_SERVICES_BASE_DIR ??
		process.env.PANEL_INFRA_BASE_DIR ??
		path.join(basePath, "core-services")

	const acmeDefault = path.join(dynamicTraefik, "acme.json")
	const acmeCloudflareDefault = path.join(dynamicTraefik, "acme-cloudflare.json")

	return {
		baseDir: defaultBase,
		mailAuthDir:
			process.env.PANEL_MAIL_AUTH_DIR ?? path.join(defaultBase, "mail", "auth"),
		mailDataDir:
			process.env.PANEL_MAIL_DATA_DIR ?? path.join(defaultBase, "mail", "data"),
		mailStateDir:
			process.env.PANEL_MAIL_STATE_DIR ?? path.join(defaultBase, "mail", "state"),
		mailLogsDir:
			process.env.PANEL_MAIL_LOGS_DIR ?? path.join(defaultBase, "mail", "logs"),
		/** docker-mailserver `ONE_DIR=1` config root on the host */
		mailDmsConfigDir:
			process.env.PANEL_MAIL_DMS_CONFIG_DIR ??
			path.join(defaultBase, "mail", "dms-config"),
		mailTlsDir:
			process.env.PANEL_MAIL_TLS_DIR ?? path.join(defaultBase, "mail", "tls"),
		dkimKeysDir:
			process.env.PANEL_DKIM_KEYS_DIR ?? path.join(defaultBase, "mail", "dkim"),
		acmeJsonPath: process.env.PANEL_ACME_JSON_PATH ?? acmeDefault,
		acmeCloudflareJsonPath:
			process.env.PANEL_ACME_CLOUDFLARE_JSON_PATH ?? acmeCloudflareDefault,
		mailserverContainerName:
			process.env.PANEL_MAILSERVER_CONTAINER ?? "dokploy-mailserver",
		roundcubeContainerName:
			process.env.PANEL_ROUNDCUBE_CONTAINER ?? "core-services-roundcube",
		mailPasswdFileName: "passwd",
		mailVirtualDomainsFileName: "virtual_domains",
		/** Tab-separated alias map (Exim/Dovecot), alongside passwd + virtual_domains */
		mailVirtualAliasFileName: "virtual",
		mailNetworkName: process.env.PANEL_MAIL_NETWORK ?? "dokploy-network",
	}
}
