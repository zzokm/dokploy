import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("node:dns/promises", () => ({
	default: {
		lookup: vi.fn(),
	},
}))

import dns from "node:dns/promises"
import {
	OperatorError,
	OperatorErrorCode,
	redactSecrets,
	resolveHostnameAddresses,
	waitForHostnameResolution,
} from "../../../../packages/server/src/services/operator"

const mockedLookup = vi.mocked(dns.lookup)

describe("operator redactSecrets", () => {
	it("redacts bearer tokens and api keys", () => {
		const raw =
			'Authorization: Bearer abcdefghijklmnop CF_DNS_API_TOKEN=supersecretvalue password=hunter2'
		const out = redactSecrets(raw)
		expect(out).not.toContain("abcdefghijklmnop")
		expect(out).not.toContain("supersecretvalue")
		expect(out).not.toContain("hunter2")
		expect(out).toMatch(/REDACTED/)
	})
})

describe("operator DNS resolve", () => {
	beforeEach(() => {
		mockedLookup.mockReset()
	})

	it("returns addresses on success", async () => {
		mockedLookup.mockResolvedValue([
			{ address: "23.94.107.153", family: 4 },
		] as never)
		await expect(resolveHostnameAddresses("app.example.com")).resolves.toEqual([
			"23.94.107.153",
		])
	})

	it("maps ENOTFOUND to dns_missing", async () => {
		const err = Object.assign(new Error("not found"), { code: "ENOTFOUND" })
		mockedLookup.mockRejectedValue(err)
		await expect(resolveHostnameAddresses("missing.example.com")).rejects.toMatchObject({
			code: OperatorErrorCode.dns_missing,
		})
	})

	it("waitForHostnameResolution succeeds when IP matches", async () => {
		mockedLookup.mockResolvedValue([
			{ address: "1.2.3.4", family: 4 },
		] as never)
		const result = await waitForHostnameResolution({
			host: "ok.example.com",
			expectedIp: "1.2.3.4",
			timeoutMs: 2_000,
			intervalMs: 100,
		})
		expect(result.ok).toBe(true)
		expect(result.matchedExpected).toBe(true)
	})

	it("waitForHostnameResolution times out on mismatch with dns_mismatch", async () => {
		mockedLookup.mockResolvedValue([
			{ address: "9.9.9.9", family: 4 },
		] as never)
		await expect(
			waitForHostnameResolution({
				host: "bad.example.com",
				expectedIp: "1.2.3.4",
				timeoutMs: 500,
				intervalMs: 100,
			}),
		).rejects.toBeInstanceOf(OperatorError)
		try {
			await waitForHostnameResolution({
				host: "bad.example.com",
				expectedIp: "1.2.3.4",
				timeoutMs: 300,
				intervalMs: 100,
			})
		} catch (e) {
			expect(e).toMatchObject({ code: OperatorErrorCode.dns_mismatch })
		}
	})
})
