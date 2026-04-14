import { describe, expect, it } from "vitest"
import { sealString, unsealString } from "../../../../packages/server/src/utils/crypto/seal"

describe("sealString/unsealString", () => {
	it("roundtrips with a valid key", () => {
		process.env.DOKPLOY_ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString("base64")
		const sealed = sealString("secret-token")
		expect(sealed).toMatch(/^v1:/)
		const plain = unsealString(sealed)
		expect(plain).toBe("secret-token")
	})

	it("fails when key is missing", () => {
		delete process.env.DOKPLOY_ENCRYPTION_KEY
		expect(() => sealString("x")).toThrow(/DOKPLOY_ENCRYPTION_KEY/)
	})
})

