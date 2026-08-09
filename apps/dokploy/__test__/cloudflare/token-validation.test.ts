import { describe, expect, it, vi } from "vitest"
import { validateCloudflareApiToken } from "../../../../packages/server/src/services/cloudflare/token-validation"
import { zoneDnsRecordInputSchema } from "../../../../packages/server/src/services/cloudflare/zone-dns-record-schema"

vi.mock("../../../../packages/server/src/services/cloudflare/client", () => ({
	CloudflareApiRequestError: class CloudflareApiRequestError extends Error {
		status: number
		errors: Array<{ code: number; message: string }>
		constructor(input: {
			status: number
			message: string
			errors: Array<{ code: number; message: string }>
		}) {
			super(input.message)
			this.status = input.status
			this.errors = input.errors
		}
	},
	cloudflareFetch: vi.fn(),
}))

vi.mock("../../../../packages/server/src/services/cloudflare/zones", () => ({
	listCloudflareZones: vi.fn(),
}))

import {
	CloudflareApiRequestError,
	cloudflareFetch,
} from "../../../../packages/server/src/services/cloudflare/client"
import { listCloudflareZones } from "../../../../packages/server/src/services/cloudflare/zones"

const mockedFetch = vi.mocked(cloudflareFetch)
const mockedListZones = vi.mocked(listCloudflareZones)

describe("validateCloudflareApiToken", () => {
	it("rejects empty tokens", async () => {
		const result = await validateCloudflareApiToken("   ")
		expect(result.ok).toBe(false)
		expect(result.message).toMatch(/required/i)
	})

	it("verifies zone read and dns read without claiming write", async () => {
		mockedFetch.mockImplementation(async (input) => {
			if (input.path === "/user/tokens/verify") {
				return { id: "tok", status: "active" }
			}
			if (input.path.includes("/dns_records")) {
				return []
			}
			throw new Error(`unexpected path ${input.path}`)
		})
		mockedListZones.mockResolvedValue([
			{
				id: "zone1",
				name: "example.com",
				status: "active",
				paused: false,
				type: "full",
			},
		])

		const result = await validateCloudflareApiToken("x".repeat(40))
		expect(result.ok).toBe(true)
		expect(result.zoneRead).toBe(true)
		expect(result.dnsRead).toBe(true)
		expect(result.dnsWrite).toBe("unverified")
		expect(result.warning).toMatch(/DNS → Edit/i)
	})

	it("fails when zone list is unauthorized", async () => {
		mockedFetch.mockResolvedValue({ id: "tok", status: "active" })
		mockedListZones.mockRejectedValue(new Error("Authentication error"))

		const result = await validateCloudflareApiToken("x".repeat(40))
		expect(result.ok).toBe(false)
		expect(result.zoneRead).toBe(false)
		expect(result.message).toMatch(/zone/i)
	})

	it("accepts account-owned tokens when user verify fails but zones work", async () => {
		mockedFetch.mockImplementation(async (input) => {
			if (input.path === "/user/tokens/verify") {
				throw new CloudflareApiRequestError({
					status: 401,
					message: "Invalid API Token",
					errors: [{ code: 1000, message: "Invalid API Token" }],
				})
			}
			if (input.path.includes("/dns_records")) {
				return []
			}
			throw new Error(`unexpected path ${input.path}`)
		})
		mockedListZones.mockResolvedValue([
			{
				id: "zone1",
				name: "example.com",
				status: "active",
				paused: false,
				type: "full",
			},
		])

		const result = await validateCloudflareApiToken(
			"cfat_" + "a".repeat(40) + "b6",
		)
		expect(result.ok).toBe(true)
		expect(result.tokenActive).toBe(true)
		expect(result.zoneRead).toBe(true)
		expect(result.dnsRead).toBe(true)
	})

	it("rejects when both user verify and zone list fail", async () => {
		mockedFetch.mockRejectedValue(
			new CloudflareApiRequestError({
				status: 401,
				message: "Invalid API Token",
				errors: [{ code: 1000, message: "Invalid API Token" }],
			}),
		)
		mockedListZones.mockRejectedValue(
			new CloudflareApiRequestError({
				status: 401,
				message: "Invalid API Token",
				errors: [{ code: 1000, message: "Invalid API Token" }],
			}),
		)

		const result = await validateCloudflareApiToken(
			"cfat_" + "a".repeat(40) + "b6",
		)
		expect(result.ok).toBe(false)
		expect(result.tokenActive).toBe(false)
		expect(result.message).toMatch(/rejected this API token/i)
	})
})

describe("zoneDnsRecordInputSchema", () => {
	it("requires MX priority", () => {
		const parsed = zoneDnsRecordInputSchema.safeParse({
			type: "MX",
			name: "@",
			content: "mail.example.com",
			ttl: 1,
		})
		expect(parsed.success).toBe(false)
	})

	it("rejects proxied TXT", () => {
		const parsed = zoneDnsRecordInputSchema.safeParse({
			type: "TXT",
			name: "@",
			content: "v=spf1",
			ttl: 1,
			proxied: true,
		})
		expect(parsed.success).toBe(false)
	})

	it("accepts proxied A records", () => {
		const parsed = zoneDnsRecordInputSchema.safeParse({
			type: "A",
			name: "app",
			content: "1.2.3.4",
			ttl: 1,
			proxied: true,
		})
		expect(parsed.success).toBe(true)
	})
})
