/**
 * Reference images for the data-plane stack (aggregation only — no upstream source in repo).
 */
export const CORE_BIND_IMAGE = "internetsystemsconsortium/bind9:9.18"
/** Public Debian-based Exim (Docker Hub). There is no official `exim/exim4` image; this image exposes SMTP on container port 25 only. */
export const CORE_EXIM_IMAGE = "tianon/exim4:latest"
export const CORE_DOVECOT_IMAGE = "dovecot/dovecot:latest"
export const CORE_ROUNDCUBE_IMAGE = "roundcube/roundcubemail:latest"
