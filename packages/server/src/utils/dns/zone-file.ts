export type DnsRecordRow = {
	type: string
	recordName: string
	content: string
	ttl: number
	priority: number | null
	srvWeight: number | null
	srvPort: number | null
	srvTarget: string | null
}

export type SoaMeta = {
	primaryNs: string
	adminEmail: string
	serial: number
}

const escapeTxt = (s: string): string => {
	const inner = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
	return `"${inner}"`
}

/**
 * SOA serial: unsigned 32-bit per RFC 1035. Unix epoch seconds increases on every
 * generation without DB state; fits in uint32 until year 2106.
 */
export const computeSoaSerial = (): number => Math.floor(Date.now() / 1000)

const recordLabel = (apexDomain: string, recordName: string): string => {
	if (recordName === "@" || recordName === "") {
		return "@"
	}
	if (recordName.endsWith(`.${apexDomain}`)) {
		return recordName.slice(0, -`.${apexDomain}`.length) || "@"
	}
	return recordName
}

export const generateZoneFile = (
	apexDomain: string,
	records: DnsRecordRow[],
	soa: SoaMeta,
): string => {
	const lines: string[] = []
	lines.push("$TTL 86400")
	lines.push(
		`@\tIN\tSOA\t${soa.primaryNs}.\t${soa.adminEmail.replace("@", ".")}. (`,
	)
	lines.push(`\t\t${soa.serial}\t; Serial`)
	lines.push(`\t\t3600\t; Refresh`)
	lines.push(`\t\t1800\t; Retry`)
	lines.push(`\t\t604800\t; Expire`)
	lines.push(`\t\t86400 )\t; Minimum`)
	lines.push("")

	for (const r of records) {
		const label = recordLabel(apexDomain, r.recordName)
		const ttl = r.ttl
		const type = r.type.toUpperCase()

		if (type === "MX") {
			const prio = r.priority ?? 10
			lines.push(
				`${label}\t${ttl}\tIN\tMX\t${prio}\t${r.content.replace(/\.$/, "")}.`,
			)
			continue
		}

		if (type === "SRV") {
			const prio = r.priority ?? 0
			const weight = r.srvWeight ?? 0
			const port = r.srvPort ?? 0
			const target = (r.srvTarget ?? r.content).replace(/\.$/, "")
			lines.push(
				`${label}\t${ttl}\tIN\tSRV\t${prio}\t${weight}\t${port}\t${target}.`,
			)
			continue
		}

		if (type === "TXT") {
			lines.push(`${label}\t${ttl}\tIN\tTXT\t${escapeTxt(r.content)}`)
			continue
		}

		const content =
			type === "CNAME" ? `${r.content.replace(/\.$/, "")}.` : r.content
		lines.push(`${label}\t${ttl}\tIN\t${type}\t${content}`)
	}

	lines.push("")
	return lines.join("\n")
}
