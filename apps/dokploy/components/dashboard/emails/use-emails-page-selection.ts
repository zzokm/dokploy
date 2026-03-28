"use client"

import { useRouter } from "next/router"
import { useCallback, useEffect, useMemo, useState } from "react"

/**
 * Keeps selected mail domain in sync with `?domainId=` only (like manage-dns).
 * Manual selection updates the URL so refetches do not overwrite the choice.
 */
export const useEmailsPageSelection = () => {
	const router = useRouter()
	const q = router.query.domainId
	const domainIdParam: string | null = useMemo(
		() =>
			typeof q === "string" ? q : Array.isArray(q) ? (q[0] ?? null) : null,
		[q],
	)
	const [selectedId, setSelectedId] = useState<string | null>(domainIdParam)

	useEffect(() => {
		setSelectedId(domainIdParam)
	}, [domainIdParam])

	const selectMailDomain = useCallback(
		(id: string) => {
			setSelectedId(id)
			void router.replace(
				{ pathname: "/dashboard/emails", query: { domainId: id } },
				undefined,
				{ shallow: true, scroll: false },
			)
		},
		[router],
	)

	return { selectedId, selectMailDomain }
}
