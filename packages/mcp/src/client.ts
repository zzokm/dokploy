import axios, { type AxiosError, type AxiosInstance } from "axios";
import { loadConfig } from "./config.js";

let client: AxiosInstance | null = null;

export function getApiClient(): AxiosInstance {
	if (client) return client;
	const config = loadConfig();
	client = axios.create({
		baseURL: `${config.dokployUrl}/api`,
		timeout: config.timeoutMs,
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			"x-api-key": config.apiKey,
		},
	});
	return client;
}

export type ApiResult =
	| { ok: true; data: unknown }
	| { ok: false; code: string; message: string; details?: unknown };

const parseOperatorPayload = (message: unknown): ApiResult | null => {
	if (typeof message !== "string") return null;
	try {
		const parsed = JSON.parse(message) as {
			ok?: boolean;
			code?: string;
			message?: string;
			details?: unknown;
		};
		if (parsed && parsed.ok === false && parsed.code) {
			return {
				ok: false,
				code: parsed.code,
				message: parsed.message || message,
				details: parsed.details,
			};
		}
	} catch {
		return null;
	}
	return null;
};

export async function apiGet(
	path: string,
	params?: Record<string, unknown>,
): Promise<ApiResult> {
	try {
		const res = await getApiClient().get(path, { params });
		return { ok: true, data: res.data };
	} catch (e) {
		return toErrorResult(e);
	}
}

export async function apiPost(
	path: string,
	body?: Record<string, unknown>,
): Promise<ApiResult> {
	try {
		const res = await getApiClient().post(path, body ?? {});
		return { ok: true, data: res.data };
	} catch (e) {
		return toErrorResult(e);
	}
}

function toErrorResult(e: unknown): ApiResult {
	const err = e as AxiosError<{ message?: string }>;
	const status = err.response?.status;
	const message =
		err.response?.data?.message ||
		err.message ||
		"Dokploy API request failed";

	const nested = parseOperatorPayload(message);
	if (nested) return nested;

	if (status === 401 || status === 403) {
		return {
			ok: false,
			code: "unauthorized",
			message:
				"Unauthorized — check DOKPLOY_API_KEY and that the key is enabled for this organization.",
		};
	}
	if (status === 404) {
		return { ok: false, code: "not_found", message };
	}
	return {
		ok: false,
		code: "internal",
		message: typeof message === "string" ? message : "Request failed",
		details: err.response?.data,
	};
}

export function formatToolResult(result: ApiResult) {
	if (result.ok) {
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ ok: true, data: result.data }, null, 2),
				},
			],
		};
	}
	return {
		isError: true,
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(
					{
						ok: false,
						code: result.code,
						message: result.message,
						...(result.details ? { details: result.details } : {}),
					},
					null,
					2,
				),
			},
		],
	};
}
