import { cloudflareFetch } from "./client"

export type CloudflareZone = {
	id: string
	name: string
	status: string
	paused: boolean
	type: "full" | "partial" | (string & {})
}

export const listCloudflareZones = async (input: { token: string }) => {
	return await cloudflareFetch<CloudflareZone[]>({
		token: input.token,
		method: "GET",
		path: "/zones",
	})
}

