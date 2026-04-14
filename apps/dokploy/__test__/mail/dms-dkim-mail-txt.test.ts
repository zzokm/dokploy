import { describe, expect, it } from "vitest"
import { parseDkimTxtFromMailDotTxt } from "../../../../packages/server/src/utils/mail/dms-dkim-mail-txt"

describe("parseDkimTxtFromMailDotTxt", () => {
	it("parses standard OpenDKIM BIND mail.txt with comment after closing paren", () => {
		const raw = `mail._domainkey	IN	TXT	( "v=DKIM1; h=sha256; k=rsa; " "p=MIIBAB" ) ; ----- DKIM key mail for example.com
`
		expect(parseDkimTxtFromMailDotTxt(raw)).toBe("v=DKIM1; h=sha256; k=rsa; p=MIIBAB")
	})

	it("parses multi-line parenthesized TXT", () => {
		const raw = `mail._domainkey IN TXT (
  "v=DKIM1; k=rsa; "
  "p=XXXX"
) ; ----- DKIM
`
		expect(parseDkimTxtFromMailDotTxt(raw)).toBe("v=DKIM1; k=rsa; p=XXXX")
	})

	it("returns already-flat DKIM value unchanged aside from whitespace", () => {
		const raw = "  v=DKIM1; k=rsa; p=ABC  \n"
		expect(parseDkimTxtFromMailDotTxt(raw)).toBe("v=DKIM1; k=rsa; p=ABC")
	})
})
