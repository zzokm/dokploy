# Third-party software

This project (the Dokploy-based control plane) **orchestrates** third-party open-source services by downloading and running them in **isolated Docker containers** during normal operation. The control plane application itself is not derived from the source code of those services.

The following software may be deployed and executed in containers:

| Software | SPDX / license | Upstream |
|----------|------------------|----------|
| BIND 9 | MPL-2.0 | [ISC BIND](https://www.isc.org/bind/) |
| Traefik | MIT | [Traefik](https://github.com/traefik/traefik) |
| docker-mailserver | MIT (image); bundles Postfix (IBM Public License / EPL-2.0), Dovecot (MIT/LGPL-2.1), OpenDKIM, Fail2ban, SpamAssassin, and optional components per upstream image | [docker-mailserver](https://github.com/docker-mailserver/docker-mailserver) |
| Roundcube | GPL-3.0-or-later | [Roundcube Webmail](https://github.com/roundcube/roundcubemail) |
| Rspamd (optional) | Apache-2.0 | [Rspamd](https://rspamd.com/) |
| ClamAV (optional) | GPL-2.0 | [ClamAV](https://www.clamav.net/) |

Source code for GPL-licensed components is available from their respective upstream projects linked above. This repository contains **orchestration and configuration generation** only, not a source distribution of Roundcube, BIND, or docker-mailserver stack binaries.
