export type CloudflareApiError = {
	code: number
	message: string
}

export type CloudflareApiResponse<T> =
	| {
			success: true
			result: T
			errors: CloudflareApiError[]
			messages: Array<{ code: number; message: string }>
			result_info?: {
				page: number
				per_page: number
				total_pages: number
				count: number
				total_count: number
			}
	  }
	| {
			success: false
			result: null
			errors: CloudflareApiError[]
			messages: Array<{ code: number; message: string }>
	  }

export class CloudflareApiRequestError extends Error {
	status: number
	errors: CloudflareApiError[]

	constructor(input: { status: number; message: string; errors: CloudflareApiError[] }) {
		super(input.message)
		this.name = "CloudflareApiRequestError"
		this.status = input.status
		this.errors = input.errors
	}
}

const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4"

const safeJson = async (res: Response) => {
	try {
		return (await res.json()) as unknown
	} catch {
		return null
	}
}

export const cloudflareFetch = async <TResult>(
	input: {
		token: string
		path: string
		method: "GET" | "POST" | "PUT" | "DELETE"
		query?: Record<string, string | number | boolean | undefined>
		body?: unknown
	},
): Promise<TResult> => {
	const url = new URL(`${CLOUDFLARE_API_BASE_URL}${input.path}`)
	if (input.query) {
		for (const [k, v] of Object.entries(input.query)) {
			if (v === undefined) continue
			url.searchParams.set(k, String(v))
		}
	}

	const res = await fetch(url.toString(), {
		method: input.method,
		headers: {
			Authorization: `Bearer ${input.token}`,
			Accept: "application/json",
			...(input.body ? { "Content-Type": "application/json" } : {}),
		},
		body: input.body ? JSON.stringify(input.body) : undefined,
	})

	const json = (await safeJson(res)) as CloudflareApiResponse<TResult> | null

	if (!res.ok) {
		const apiErrors = json && "errors" in json ? json.errors : []
		const message =
			apiErrors?.[0]?.message ??
			`Cloudflare API request failed: ${res.status} ${res.statusText}`
		throw new CloudflareApiRequestError({
			status: res.status,
			message,
			errors: apiErrors,
		})
	}

	if (!json) {
		throw new CloudflareApiRequestError({
			status: res.status,
			message: "Cloudflare API returned invalid JSON",
			errors: [],
		})
	}

	if (!json.success) {
		const message = json.errors?.[0]?.message ?? "Cloudflare API request failed"
		throw new CloudflareApiRequestError({
			status: res.status,
			message,
			errors: json.errors ?? [],
		})
	}

	return json.result
}

