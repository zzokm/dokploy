/**
 * Dovecot/Exim-style **global** flat files written to `mailAuthDir`:
 * - **One** `passwd` (name from `serverPaths().mailPasswdFileName`) with all mailboxes.
 * - **One** `virtual_domains` listing every hosted mail domain.
 * - **One** `virtual` (tab-separated aliases) for all alias lines.
 *
 * Password hashes MUST be Argon2id from the `argon2` package.
 */

export type MailboxLine = {
	email: string
	passwordHash: string
	uid: string
	gid: string
	home: string
}

export const formatPasswdLine = (m: MailboxLine): string =>
	`${m.email}:${m.passwordHash}:${m.uid}:${m.gid}::${m.home}`

/** One domain name per line (global list). */
export const formatVirtualDomains = (domains: string[]): string =>
	domains.map((d) => d.trim().toLowerCase()).join("\n") + "\n"

export type AliasLine = {
	source: string
	destination: string
}

export const formatVirtualAliasLine = (a: AliasLine): string =>
	`${a.source}\t${a.destination}`

export const buildPasswdFile = (lines: MailboxLine[]): string =>
	lines.map(formatPasswdLine).join("\n") + "\n"

export const buildVirtualAliasesFile = (lines: AliasLine[]): string =>
	lines.map(formatVirtualAliasLine).join("\n") + "\n"
