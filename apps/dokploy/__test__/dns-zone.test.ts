import { describe, expect, it } from "vitest"
import {
	computeSoaSerial,
	generateZoneFile,
} from "../../../packages/server/src/utils/dns/zone-file"

describe("generateZoneFile", () => {
	it("renders SOA and A record", () => {
		const serial = computeSoaSerial()
		expect(serial).toBeGreaterThan(1_000_000_000)
		const z = generateZoneFile(
			"example.com",
			[
				{
					type: "A",
					recordName: "@",
					content: "192.0.2.1",
					ttl: 3600,
					priority: null,
					srvWeight: null,
					srvPort: null,
					srvTarget: null,
				},
			],
			{
				primaryNs: "ns1.example.com",
				adminEmail: "hostmaster@example.com",
				serial,
			},
		)
		expect(z).toContain("$TTL 86400")
		expect(z).toContain("IN\tSOA\tns1.example.com.")
		expect(z).toContain(`\t\t${serial}\t; Serial`)
		expect(z).toContain("IN\tA\t192.0.2.1")
	})
})
