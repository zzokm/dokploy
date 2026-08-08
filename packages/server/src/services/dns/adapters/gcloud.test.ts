import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DNS_PROVIDER_CAPABILITIES } from "../types";
import type { DnsCredentials } from "../types";
import {
	createGcloudDnsAdapter,
	encodeGcloudRecordId,
	exchangeServiceAccountToken,
	parseGcloudRecordId,
	resolveGcloudProjectId,
} from "./gcloud";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = rsa.privateKey.export({
	type: "pkcs8",
	format: "pem",
}) as string;

const saJson = JSON.stringify({
	type: "service_account",
	project_id: "proj-from-sa",
	private_key_id: "key-1",
	private_key: privateKeyPem,
	client_email: "dns-bot@proj-from-sa.iam.gserviceaccount.com",
	token_uri: "https://oauth2.googleapis.com/token",
});

const baseCreds = (): DnsCredentials => ({
	secret: saJson,
	meta: { projectId: "my-project" },
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("gcloud record id helpers", () => {
	it("encodes and parses name|type", () => {
		const id = encodeGcloudRecordId("www.example.com", "A");
		expect(id).toBe("www.example.com.|A");
		expect(parseGcloudRecordId(id)).toEqual({
			name: "www.example.com.",
			type: "A",
			index: undefined,
		});
	});

	it("preserves optional index", () => {
		const id = encodeGcloudRecordId("example.com.", "TXT", 2);
		expect(parseGcloudRecordId(id)).toEqual({
			name: "example.com.",
			type: "TXT",
			index: 2,
		});
	});
});

describe("resolveGcloudProjectId", () => {
	it("prefers meta.projectId", () => {
		expect(
			resolveGcloudProjectId({
				secret: saJson,
				meta: { projectId: "meta-proj" },
			}),
		).toBe("meta-proj");
	});

	it("falls back to SA project_id", () => {
		expect(resolveGcloudProjectId({ secret: saJson })).toBe("proj-from-sa");
	});
});

describe("createGcloudDnsAdapter", () => {
	it("exposes gcloud capabilities", () => {
		const adapter = createGcloudDnsAdapter({
			tokenProvider: async () => "tok",
		});
		expect(adapter.id).toBe("gcloud");
		expect(adapter.capabilities).toEqual(DNS_PROVIDER_CAPABILITIES.gcloud);
	});

	it("lists managed zones via DNS REST", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			expect(url).toContain(
				"https://dns.googleapis.com/dns/v1/projects/my-project/managedZones",
			);
			return new Response(
				JSON.stringify({
					managedZones: [
						{
							id: "123",
							name: "example-com",
							dnsName: "example.com.",
							visibility: "public",
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const adapter = createGcloudDnsAdapter({
			fetch: fetchMock as unknown as typeof fetch,
			tokenProvider: async () => "test-token",
		});

		const zones = await adapter.listZones(baseCreds());
		expect(zones).toEqual([
			{
				id: "example-com",
				name: "example.com",
				status: "public",
				meta: {
					dnsName: "example.com.",
					managedZoneName: "example-com",
					numericId: "123",
					description: undefined,
				},
			},
		]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(init.headers).toMatchObject({
			Authorization: "Bearer test-token",
		});
	});

	it("lists rrsets as DnsRecords", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					rrsets: [
						{
							name: "www.example.com.",
							type: "A",
							ttl: 300,
							rrdatas: ["1.2.3.4", "5.6.7.8"],
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const adapter = createGcloudDnsAdapter({
			fetch: fetchMock as unknown as typeof fetch,
			tokenProvider: async () => "tok",
		});

		const records = await adapter.listRecords(baseCreds(), "example-com");
		expect(records).toHaveLength(2);
		expect(records[0]).toMatchObject({
			id: "www.example.com.|A|0",
			zoneId: "example-com",
			name: "www.example.com",
			type: "A",
			content: "1.2.3.4",
			ttl: 300,
		});
		expect(records[1]?.id).toBe("www.example.com.|A|1");
	});

	it("upsert creates rrset when missing (replace semantics)", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			if (method === "GET" && url.includes("/rrsets/")) {
				return new Response(JSON.stringify({ error: { message: "not found" } }), {
					status: 404,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (method === "POST" && url.endsWith("/rrsets")) {
				expect(JSON.parse(String(init?.body))).toEqual({
					name: "api.example.com.",
					type: "A",
					ttl: 120,
					rrdatas: ["9.9.9.9"],
				});
				return new Response(
					JSON.stringify({
						name: "api.example.com.",
						type: "A",
						ttl: 120,
						rrdatas: ["9.9.9.9"],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected ${method} ${url}`);
		});

		const adapter = createGcloudDnsAdapter({
			fetch: fetchMock as unknown as typeof fetch,
			tokenProvider: async () => "tok",
		});

		const record = await adapter.upsertRecord(baseCreds(), {
			zoneId: "example-com",
			name: "api.example.com",
			type: "A",
			content: "9.9.9.9",
			ttl: 120,
		});

		expect(record.content).toBe("9.9.9.9");
		expect(record.id).toBe("api.example.com.|A");
		const methods = fetchMock.mock.calls.map(
			(c) => (c[1] as RequestInit | undefined)?.method ?? "GET",
		);
		expect(methods).toEqual(["GET", "POST"]);
	});

	it("upsert patches existing rrset (full replace of rrdatas)", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			if (method === "GET") {
				return new Response(
					JSON.stringify({
						name: "www.example.com.",
						type: "A",
						ttl: 300,
						rrdatas: ["1.1.1.1", "2.2.2.2"],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (method === "PATCH") {
				const body = JSON.parse(String(init?.body));
				// Replace — single value, not merged with prior rrdatas.
				expect(body.rrdatas).toEqual(["3.3.3.3"]);
				expect(body.rrdatas).not.toContain("1.1.1.1");
				return new Response(JSON.stringify(body), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			throw new Error(`unexpected ${method} ${url}`);
		});

		const adapter = createGcloudDnsAdapter({
			fetch: fetchMock as unknown as typeof fetch,
			tokenProvider: async () => "tok",
		});

		const record = await adapter.upsertRecord(baseCreds(), {
			zoneId: "example-com",
			name: "www.example.com.",
			type: "A",
			content: "3.3.3.3",
		});

		expect(record.content).toBe("3.3.3.3");
		expect(
			fetchMock.mock.calls.some(
				(c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
			),
		).toBe(true);
	});

	it("quotes TXT rrdata on upsert", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			if (method === "GET") {
				return new Response(JSON.stringify({ error: { message: "nf" } }), {
					status: 404,
					headers: { "Content-Type": "application/json" },
				});
			}
			const body = JSON.parse(String(init?.body));
			expect(body.rrdatas).toEqual(['"v=spf1 include:_spf.google.com ~all"']);
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});

		const adapter = createGcloudDnsAdapter({
			fetch: fetchMock as unknown as typeof fetch,
			tokenProvider: async () => "tok",
		});

		await adapter.upsertRecord(baseCreds(), {
			zoneId: "example-com",
			name: "example.com",
			type: "TXT",
			content: "v=spf1 include:_spf.google.com ~all",
		});
	});

	it("deletes rrset by composite record id", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.method).toBe("DELETE");
			expect(String(input)).toContain(
				"/managedZones/example-com/rrsets/www.example.com./A",
			);
			return new Response(null, { status: 204 });
		});

		const adapter = createGcloudDnsAdapter({
			fetch: fetchMock as unknown as typeof fetch,
			tokenProvider: async () => "tok",
		});

		await adapter.deleteRecord(
			baseCreds(),
			"example-com",
			"www.example.com.|A|0",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("testCredentials returns ok on successful list", async () => {
		const adapter = createGcloudDnsAdapter({
			fetch: vi.fn(async () => {
				return new Response(JSON.stringify({ managedZones: [] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}) as unknown as typeof fetch,
			tokenProvider: async () => "tok",
		});

		await expect(adapter.testCredentials(baseCreds())).resolves.toEqual({
			ok: true,
		});
	});

	it("testCredentials returns detail on failure", async () => {
		const adapter = createGcloudDnsAdapter({
			fetch: vi.fn(async () => {
				return new Response(
					JSON.stringify({ error: { message: "Permission denied" } }),
					{ status: 403, headers: { "Content-Type": "application/json" } },
				);
			}) as unknown as typeof fetch,
			tokenProvider: async () => "tok",
		});

		const result = await adapter.testCredentials(baseCreds());
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("Permission denied");
	});
});

describe("exchangeServiceAccountToken", () => {
	it("POSTs JWT bearer assertion to oauth token endpoint", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(String(input)).toBe("https://oauth2.googleapis.com/token");
			expect(init?.method).toBe("POST");
			const body = String(init?.body);
			expect(body).toContain(
				"grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer",
			);
			expect(body).toContain("assertion=");
			// Assertion is three base64url segments.
			const assertion = new URLSearchParams(body).get("assertion") ?? "";
			expect(assertion.split(".")).toHaveLength(3);

			return new Response(
				JSON.stringify({
					access_token: "ya29.access",
					token_type: "Bearer",
					expires_in: 3600,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const token = await exchangeServiceAccountToken(
			{ secret: saJson },
			fetchMock as unknown as typeof fetch,
		);
		expect(token).toBe("ya29.access");
	});

	it("default adapter uses token exchange when tokenProvider omitted", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes("oauth2.googleapis.com/token")) {
				return new Response(
					JSON.stringify({ access_token: "from-jwt" }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			expect(init?.headers).toMatchObject({
				Authorization: "Bearer from-jwt",
			});
			return new Response(JSON.stringify({ managedZones: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});

		const adapter = createGcloudDnsAdapter({
			fetch: fetchMock as unknown as typeof fetch,
		});

		await adapter.listZones({ secret: saJson, meta: { projectId: "p1" } });
		expect(
			fetchMock.mock.calls.some((c) =>
				String(c[0]).includes("oauth2.googleapis.com/token"),
			),
		).toBe(true);
		expect(
			fetchMock.mock.calls.some((c) =>
				String(c[0]).includes("dns.googleapis.com"),
			),
		).toBe(true);
	});
});
