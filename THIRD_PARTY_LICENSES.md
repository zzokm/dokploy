# Third-party software

This project (the Dokploy-based control plane) **orchestrates** third-party open-source services by downloading and running them in **isolated Docker containers** during normal operation. The control plane application itself is not derived from the source code of those services.

The following software may be deployed and executed in containers:

| Software | SPDX / license | Upstream |
|----------|------------------|----------|
| BIND 9 | MPL-2.0 | [ISC BIND](https://www.isc.org/bind/) |
| Traefik | MIT | [Traefik](https://github.com/traefik/traefik) |
| Exim | GPL-2.0 / GPL-3.0 | [Exim](https://www.exim.org/) |
| Dovecot | MIT / LGPL-2.1 | [Dovecot](https://www.dovecot.org/) |
| Roundcube | GPL-3.0-or-later | [Roundcube Webmail](https://github.com/roundcube/roundcubemail) |
| Rspamd (optional) | Apache-2.0 | [Rspamd](https://rspamd.com/) |
| ClamAV (optional) | GPL-2.0 | [ClamAV](https://www.clamav.net/) |

Source code for GPL-licensed components is available from their respective upstream projects linked above. This repository contains **orchestration and configuration generation** only, not a source distribution of Exim, Roundcube, or BIND.
