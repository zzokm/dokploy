import argon2 from "argon2"

export const hashMailboxPassword = async (plain: string): Promise<string> =>
	argon2.hash(plain, { type: argon2.argon2id })

export const verifyMailboxPassword = async (
	plain: string,
	hash: string,
): Promise<boolean> => {
	try {
		return await argon2.verify(hash, plain)
	} catch {
		return false
	}
}
