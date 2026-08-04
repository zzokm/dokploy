import { describe, expect, it } from "vitest"
import {
	pickCloudflareDnsRecord,
	type CloudflareDnsRecord,
} from "../../../../packages/server/src/services/cloudflare/dns-record-utils"

const record = (
	partial: Partial<CloudflareDnsRecord> & Pick<CloudflareDnsRecord, "id" | "name">,
): CloudflareDnsRecord => ({
	type: "A",
	content: "1.2.3.4",
	ttl: 1,
	proxied: true,
	...partial,
})

describe("pickCloudflareDnsRecord", () => {
	it("prefers the stored Cloudflare record id", () => {
		const existing = [
			record({ id: "old", name: "app.example.com", content: "9.9.9.9" }),
			record({ id: "wanted", name: "app.example.com", content: "1.2.3.4" }),
		]

		const picked = pickCloudflareDnsRecord(existing, {
			recordId: "wanted",
			name: "app.example.com",
			type: "A",
		})

		expect(picked?.id).toBe("wanted")
	})

	it("falls back to normalized name/type match", () => {
		const existing = [
			record({ id: "other", name: "www.example.com.", content: "8.8.8.8" }),
			record({ id: "match", name: "App.Example.com.", content: "1.2.3.4" }),
		]

		const picked = pickCloudflareDnsRecord(existing, {
			name: "app.example.com",
			type: "A",
		})

		expect(picked?.id).toBe("match")
	})

	it("returns null when there are no candidates", () => {
		expect(pickCloudflareDnsRecord([], { name: "app.example.com" })).toBeNull()
	})
})
