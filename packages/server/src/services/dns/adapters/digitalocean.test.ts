import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	digitalOceanDnsAdapter,
	toDigitalOceanRelativeName,
} from "./digitalocean";
import { DNS_PROVIDER_CAPABILITIES } from "../types";

const TOKEN = "dop_v1_test_token_secret_value";

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

describe("toDigitalOceanRelativeName", () => {
	it("maps apex and FQDN forms to @", () => {
		expect(toDigitalOceanRelativeName("@", "example.com")).toBe("@");
		expect(toDigitalOceanRelativeName("example.com", "example.com")).toBe(
			"@",
		);
		expect(toDigitalOceanRelativeName("example.com.", "example.com")).toBe(
			"@",
		);
	});

	it("strips zone suffix from FQDN", () => {
		expect(toDigitalOceanRelativeName("www.example.com", "example.com")).toBe(
			"www",
		);
		expect(
			toDigitalOceanRelativeName("api.staging.example.com", "example.com"),
		).toBe("api.staging");
	});

	it("keeps relative labels", () => {
		expect(toDigitalOceanRelativeName("www", "example.com")).toBe("www");
	});
});

describe("digitalOceanDnsAdapter", () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("exposes digitalocean capabilities without proxy", () => {
		expect(digitalOceanDnsAdapter.id).toBe("digitalocean");
		expect(digitalOceanDnsAdapter.capabilities).toEqual(
			DNS_PROVIDER_CAPABILITIES.digitalocean,
		);
		expect(digitalOceanDnsAdapter.capabilities.supportsProxy).toBe(false);
		expect(digitalOceanDnsAdapter.capabilities.forcesProxy).toBe(false);
	});

	it("testCredentials succeeds when domains list is authorized", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ domains: [], links: {}, meta: { total: 0 } }),
		);

		const result = await digitalOceanDnsAdapter.testCredentials({
			secret: TOKEN,
		});

		expect(result).toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(String(url)).toContain("https://api.digitalocean.com/v2/domains");
		expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
		expect(init.signal).toBeDefined();
	});

	it("testCredentials returns ok:false without echoing the secret", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(
				{ id: "unauthorized", message: "Unable to authenticate you." },
				401,
			),
		);

		const result = await digitalOceanDnsAdapter.testCredentials({
			secret: TOKEN,
		});

		expect(result.ok).toBe(false);
		expect(result.detail).toBe("Unable to authenticate you.");
		expect(JSON.stringify(result)).not.toContain(TOKEN);
	});

	it("listZones maps domains to zones keyed by domain name", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				domains: [{ name: "example.com", ttl: 1800 }],
				links: {},
				meta: { total: 1 },
			}),
		);

		const zones = await digitalOceanDnsAdapter.listZones({ secret: TOKEN });
		expect(zones).toEqual([
			{ id: "example.com", name: "example.com", meta: { ttl: 1800 } },
		]);
	});

	it("listRecords maps domain_records under the zone", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				domain_records: [
					{
						id: 10,
						type: "A",
						name: "@",
						data: "1.2.3.4",
						ttl: 1800,
						priority: null,
					},
					{
						id: 11,
						type: "MX",
						name: "@",
						data: "mail.example.com",
						ttl: 1800,
						priority: 10,
					},
				],
				links: {},
				meta: { total: 2 },
			}),
		);

		const records = await digitalOceanDnsAdapter.listRecords(
			{ secret: TOKEN },
			"example.com",
		);

		expect(records).toEqual([
			{
				id: "10",
				zoneId: "example.com",
				name: "@",
				type: "A",
				content: "1.2.3.4",
				ttl: 1800,
			},
			{
				id: "11",
				zoneId: "example.com",
				name: "@",
				type: "MX",
				content: "mail.example.com",
				ttl: 1800,
				options: { priority: 10 },
			},
		]);
		expect(String(fetchMock.mock.calls[0]![0])).toContain(
			"/v2/domains/example.com/records",
		);
	});

	it("upsertRecord creates when no name+type match exists", async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({
					domain_records: [
						{
							id: 1,
							type: "A",
							name: "@",
							data: "9.9.9.9",
							ttl: 1800,
						},
					],
					links: {},
					meta: { total: 1 },
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					domain_record: {
						id: 99,
						type: "A",
						name: "www",
						data: "1.2.3.4",
						ttl: 600,
					},
				}),
			);

		const record = await digitalOceanDnsAdapter.upsertRecord(
			{ secret: TOKEN },
			{
				zoneId: "example.com",
				name: "www.example.com",
				type: "A",
				content: "1.2.3.4",
				ttl: 600,
			},
		);

		expect(record.id).toBe("99");
		expect(record.name).toBe("www");
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const createCall = fetchMock.mock.calls[1]!;
		expect(createCall[1].method).toBe("POST");
		expect(JSON.parse(createCall[1].body)).toEqual({
			type: "A",
			name: "www",
			data: "1.2.3.4",
			ttl: 600,
		});
	});

	it("upsertRecord updates when name+type already exists", async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({
					domain_records: [
						{
							id: 42,
							type: "A",
							name: "www",
							data: "9.9.9.9",
							ttl: 1800,
						},
					],
					links: {},
					meta: { total: 1 },
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					domain_record: {
						id: 42,
						type: "A",
						name: "www",
						data: "1.2.3.4",
						ttl: 300,
					},
				}),
			);

		const record = await digitalOceanDnsAdapter.upsertRecord(
			{ secret: TOKEN },
			{
				zoneId: "example.com",
				name: "www",
				type: "A",
				content: "1.2.3.4",
				ttl: 300,
			},
		);

		expect(record).toMatchObject({
			id: "42",
			content: "1.2.3.4",
			ttl: 300,
		});
		const updateCall = fetchMock.mock.calls[1]!;
		expect(String(updateCall[0])).toContain(
			"/v2/domains/example.com/records/42",
		);
		expect(updateCall[1].method).toBe("PUT");
	});

	it("deleteRecord calls DELETE on the record path", async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		await digitalOceanDnsAdapter.deleteRecord(
			{ secret: TOKEN },
			"example.com",
			"42",
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(String(url)).toBe(
			"https://api.digitalocean.com/v2/domains/example.com/records/42",
		);
		expect(init.method).toBe("DELETE");
		expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
	});

	it("never embeds the secret in thrown API errors", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(
				{ id: "forbidden", message: "You do not have access." },
				403,
			),
		);

		let thrown: unknown;
		try {
			await digitalOceanDnsAdapter.listZones({ secret: TOKEN });
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect(String(thrown)).toContain("You do not have access.");
		expect(String(thrown)).not.toContain(TOKEN);
	});
});
