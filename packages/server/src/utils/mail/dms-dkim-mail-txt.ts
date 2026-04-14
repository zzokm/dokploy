/**
 * Extracts the parenthesized TXT rdata from a BIND-style OpenDKIM `mail.txt`, e.g.
 * `mail._domainkey IN TXT ( "v=DKIM1; ..." "p=..." ) ; ----- DKIM key ...`
 * Returns the inner content between the first `(` after `TXT` and its matching `)`,
 * respecting quoted strings so `)` inside `"..."` does not end the group.
 */
const extractTxtParenthesisBody = (raw: string): string | null => {
	const match = raw.match(/\bTXT\s*\(/i)
	if (!match || match.index === undefined) {
		return null
	}
	let i = match.index + match[0].length
	let depth = 1
	const start = i
	while (i < raw.length && depth > 0) {
		const ch = raw[i] ?? ""
		if (ch === '"') {
			i++
			while (i < raw.length) {
				const q = raw[i] ?? ""
				if (q === "\\") {
					i += 2
					continue
				}
				if (q === '"') {
					i++
					break
				}
				i++
			}
			continue
		}
		if (ch === "(") {
			depth++
			i++
			continue
		}
		if (ch === ")") {
			depth--
			if (depth === 0) {
				return raw.slice(start, i)
			}
			i++
			continue
		}
		i++
	}
	return null
}

/** Concatenates BIND-style `"chunk"` strings inside TXT rdata into one DKIM TXT value. */
const joinBindTxtQuotedStrings = (inner: string): string => {
	const parts: string[] = []
	const re = /"((?:[^"\\]|\\.)*)"/g
	let m: RegExpExecArray | null
	while ((m = re.exec(inner)) !== null) {
		parts.push(m[1] ?? "")
	}
	return parts.join("")
}

/**
 * Normalizes OpenDKIM `mail.txt` (BIND master file: `selector._domainkey IN TXT ( "..." ... ) ; comment`)
 * into a single TXT value suitable for Cloudflare / API (`v=DKIM1; ...`).
 */
export const parseDkimTxtFromMailDotTxt = (raw: string): string => {
	const trimmed = raw.trim()
	if (/^v=DKIM1/i.test(trimmed)) {
		return trimmed.replace(/\s+/g, " ").trim()
	}

	const inner = extractTxtParenthesisBody(raw)
	if (inner !== null) {
		const joined = joinBindTxtQuotedStrings(inner).replace(/\s+/g, " ").trim()
		if (joined.length > 0) {
			return joined
		}
	}

	// Last resort: any quoted segments in the file (avoids zone preamble if regex missed)
	const fallback = joinBindTxtQuotedStrings(raw).replace(/\s+/g, " ").trim()
	if (fallback.length > 0) {
		return fallback
	}

	return trimmed.replace(/\s+/g, " ").trim()
}
