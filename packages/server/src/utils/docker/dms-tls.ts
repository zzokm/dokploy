/**
 * Paths inside docker-mailserver when `ONE_DIR=1` config is mounted at `/tmp/docker-mailserver`.
 * Required with `SSL_TYPE=manual` (`SSL_CERT_PATH` / `SSL_KEY_PATH` in container env).
 */
export const DMS_SSL_CERT_CONTAINER_PATH = "/tmp/docker-mailserver/ssl/cert.pem"
export const DMS_SSL_KEY_CONTAINER_PATH = "/tmp/docker-mailserver/ssl/key.pem"
