import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createHetznerDnsAdapter,
	HetznerDnsApiError,
} from "./hetzner";

const ZONE_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const RECORD_ID = "11111111-2222-3333-4444-555555555555";
const TOKEN = "hetzner-dns-test-token-secret";

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

describe("hetznerDnsAdapter", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("exposes hetzner capabilities without proxy", () => {
		const adapter = createHetznerDnsAdapter();
		expect(adapter.id).toBe("hetzner");
		expect(adapter.capabilities.supportsProxy).toBe(false);
		expect(adapter.capabilities.forcesProxy).toBe(false);
		expect(adapter.capabilities.auth).toBe("api_token");
		expect(adapter.capabilities.legoProvider).toBe("hetzner");
	});

	it("sends Auth-API-Token and never includes the secret in errors", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ error: { message: "unauthorized", code: 401 } }, 401),
		);
		const adapter = createHetznerDnsAdapter({ fetch: fetchMock });

		const result = await adapter.testCredentials({ secret: TOKEN });
		expect(result.ok).toBe(false);
		expect(result.detail).toBe("unauthorized");
		expect(result.detail).not.toContain(TOKEN);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(String(url)).toBe(
			"https://dns.hetzner.com/api/v1/zones?page=1&per_page=100",
		);
		expect(init?.headers).toMatchObject({
			"Auth-API-Token": TOKEN,
			Accept: "application/json",
		});
	});

	it("lists zones with UUID ids", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				zones: [
					{
						id: ZONE_ID,
						name: "example.com",
						status: "verified",
						paused: false,
						ttl: 86400,
					},
				],
				meta: { pagination: { page: 1, last_page: 1 } },
			}),
		);
		const adapter = createHetznerDnsAdapter({ fetch: fetchMock });

		const zones = await adapter.listZones({ secret: TOKEN });
		expect(zones).toEqual([
			{
				id: ZONE_ID,
				name: "example.com",
				status: "verified",
				paused: false,
				meta: { ttl: 86400 },
			},
		]);
	});

	it("lists records for a zone", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			expect(url).toContain(`zone_id=${ZONE_ID}`);
			return jsonResponse({
				records: [
					{
						id: RECORD_ID,
						zone_id: ZONE_ID,
						name: "www",
						type: "A",
						value: "1.2.3.4",
						ttl: 3600,
					},
				],
				meta: { pagination: { page: 1, last_page: 1 } },
			});
		});
		const adapter = createHetznerDnsAdapter({ fetch: fetchMock });

		const records = await adapter.listRecords({ secret: TOKEN }, ZONE_ID);
		expect(records).toEqual([
			{
				id: RECORD_ID,
				zoneId: ZONE_ID,
				name: "www",
				type: "A",
				content: "1.2.3.4",
				ttl: 3600,
			},
		]);
	});

	it("creates a record when no match exists", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			if (method === "GET" && url.includes("/records")) {
				return jsonResponse({
					records: [],
					meta: { pagination: { page: 1, last_page: 1 } },
				});
			}
			if (method === "POST" && url.endsWith("/records")) {
				const body = JSON.parse(String(init?.body));
				expect(body).toEqual({
					zone_id: ZONE_ID,
					type: "A",
					name: "app",
					value: "9.9.9.9",
					ttl: 3600,
				});
				expect(init?.headers).toMatchObject({
					"Auth-API-Token": TOKEN,
					"Content-Type": "application/json",
				});
				return jsonResponse({
					record: {
						id: RECORD_ID,
						zone_id: ZONE_ID,
						name: "app",
						type: "A",
						value: "9.9.9.9",
						ttl: 3600,
					},
				});
			}
			throw new Error(`unexpected ${method} ${url}`);
		});
		const adapter = createHetznerDnsAdapter({ fetch: fetchMock });

		const record = await adapter.upsertRecord(
			{ secret: TOKEN },
			{
				zoneId: ZONE_ID,
				name: "app",
				type: "A",
				content: "9.9.9.9",
			},
		);
		expect(record.id).toBe(RECORD_ID);
		expect(record.content).toBe("9.9.9.9");
	});

	it("updates an existing record matched by name+type", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			if (method === "GET" && url.includes("/records")) {
				return jsonResponse({
					records: [
						{
							id: RECORD_ID,
							zone_id: ZONE_ID,
							name: "www",
							type: "A",
							value: "1.1.1.1",
							ttl: 3600,
						},
					],
					meta: { pagination: { page: 1, last_page: 1 } },
				});
			}
			if (method === "PUT" && url.endsWith(`/records/${RECORD_ID}`)) {
				const body = JSON.parse(String(init?.body));
				expect(body.value).toBe("2.2.2.2");
				return jsonResponse({
					record: {
						id: RECORD_ID,
						zone_id: ZONE_ID,
						name: "www",
						type: "A",
						value: "2.2.2.2",
						ttl: 3600,
					},
				});
			}
			throw new Error(`unexpected ${method} ${url}`);
		});
		const adapter = createHetznerDnsAdapter({ fetch: fetchMock });

		const record = await adapter.upsertRecord(
			{ secret: TOKEN },
			{
				zoneId: ZONE_ID,
				name: "www",
				type: "A",
				content: "2.2.2.2",
				options: { proxied: true },
			},
		);
		expect(record.content).toBe("2.2.2.2");
		const putCall = fetchMock.mock.calls.find(
			([, init]) => init?.method === "PUT",
		);
		expect(putCall).toBeTruthy();
		expect(String(putCall?.[1]?.body)).not.toContain("proxied");
	});

	it("deletes a record by id", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(String(input)).toBe(
				`https://dns.hetzner.com/api/v1/records/${RECORD_ID}`,
			);
			expect(init?.method).toBe("DELETE");
			return new Response(null, { status: 204 });
		});
		const adapter = createHetznerDnsAdapter({ fetch: fetchMock });

		await expect(
			adapter.deleteRecord({ secret: TOKEN }, ZONE_ID, RECORD_ID),
		).resolves.toBeUndefined();
	});

	it("rejects empty credentials without calling the API", async () => {
		const fetchMock = vi.fn();
		const adapter = createHetznerDnsAdapter({ fetch: fetchMock });

		await expect(adapter.listZones({ secret: "  " })).rejects.toBeInstanceOf(
			HetznerDnsApiError,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
