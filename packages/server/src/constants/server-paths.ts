import path from "node:path"

const dokployBasePath = (isServer: boolean) =>
	isServer || process.env.NODE_ENV === "production"
		? "/etc/dokploy"
		: path.join(process.cwd(), ".docker")

/**
 * Host paths and env vars for core data-plane services (BIND, mail, DKIM, TLS).
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

	return {
		baseDir: defaultBase,
		dnsConfigDir:
			process.env.PANEL_DNS_CONFIG_DIR ?? path.join(defaultBase, "dns", "config"),
		dnsCacheDir:
			process.env.PANEL_DNS_CACHE_DIR ?? path.join(defaultBase, "dns", "cache"),
		mailAuthDir:
			process.env.PANEL_MAIL_AUTH_DIR ?? path.join(defaultBase, "mail", "auth"),
		mailDataDir:
			process.env.PANEL_MAIL_DATA_DIR ?? path.join(defaultBase, "mail", "data"),
		mailTlsDir:
			process.env.PANEL_MAIL_TLS_DIR ?? path.join(defaultBase, "mail", "tls"),
		dkimKeysDir:
			process.env.PANEL_DKIM_KEYS_DIR ?? path.join(defaultBase, "mail", "dkim"),
		acmeJsonPath: process.env.PANEL_ACME_JSON_PATH ?? acmeDefault,
		bindContainerName: process.env.PANEL_BIND_CONTAINER ?? "core-services-bind",
		dovecotContainerName:
			process.env.PANEL_DOVECOT_CONTAINER ?? "core-services-dovecot",
		eximContainerName: process.env.PANEL_EXIM_CONTAINER ?? "core-services-exim",
		roundcubeContainerName:
			process.env.PANEL_ROUNDCUBE_CONTAINER ?? "core-services-roundcube",
		mailPasswdFileName: "passwd",
		mailVirtualDomainsFileName: "virtual_domains",
		/** Tab-separated alias map (Exim/Dovecot), alongside passwd + virtual_domains */
		mailVirtualAliasFileName: "virtual",
		mailNetworkName: process.env.PANEL_MAIL_NETWORK ?? "dokploy-network",
	}
}

/**
 * POSIX path written into `named.conf.local` as the `file` argument for each zone.
 * Must match where BIND reads zones **inside** the container (e.g. `/etc/bind/zones`
 * when `dns/config` is mounted at `/etc/bind`). Host writes still use `dnsConfigDir/zones/`.
 *
 * Set `PANEL_BIND_ZONE_FILE_ROOT` if your mount differs (default `/etc/bind`).
 */
export const bindZoneFilePathForNamedConf = (domainName: string): string => {
	const root = process.env.PANEL_BIND_ZONE_FILE_ROOT ?? "/etc/bind"
	return path.posix.join(root, "zones", `${domainName}.zone`)
}
