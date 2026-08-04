import { describe, expect, it } from "vitest"
import { getUnderlyingErrorMessage } from "../../../../packages/server/src/utils/domain-create-debug"

describe("getUnderlyingErrorMessage", () => {
	it("includes nested Postgres cause from DrizzleQueryError-like wrappers", () => {
		const pg = Object.assign(
			new Error("cannot pass more than 100 arguments to a function"),
			{ code: "54023" },
		)
		const drizzle = Object.assign(new Error("Failed query: select ..."), {
			cause: pg,
		})
		const msg = getUnderlyingErrorMessage(drizzle)
		expect(msg).toContain("Failed query")
		expect(msg).toContain("cannot pass more than 100 arguments to a function")
		expect(msg).toContain("code=54023")
	})
})
