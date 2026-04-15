/**
 * Reference images for the data-plane stack (aggregation only — no upstream source in repo).
 */
/** docker-mailserver: Postfix + Dovecot + Rspamd/Fail2ban options (see project docs). */
/** Docker Hub: `mailserver/docker-mailserver` (project name is docker-mailserver). */
export const CORE_DMS_IMAGE = "mailserver/docker-mailserver:latest"
export const CORE_ROUNDCUBE_IMAGE = "roundcube/roundcubemail:latest"
