import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	decodeNs1RecordId,
	encodeNs1RecordId,
	ns1DnsAdapter,
} from "./ns1";
import { DNS_PROVIDER_CAPABILITIES } from "../types";

const KEY = "ns1-test-api-key-secret-value";

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

describe("encodeNs1RecordId / decodeNs1RecordId", () => {
	it("round-trips domain and type", () => {
		const id = encodeNs1RecordId("www.example.com", "a");
		expect(id).toBe("www.example.com/A");
		expect(decodeNs1RecordId(id)).toEqual({
			domain: "www.example.com",
			type: "A",
		});
	});
});

describe("ns1DnsAdapter", () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("exposes ns1 capabilities without proxy", () => {
		expect(ns1DnsAdapter.id).toBe("ns1");
		expect(ns1DnsAdapter.capabilities).toEqual(DNS_PROVIDER_CAPABILITIES.ns1);
		expect(ns1DnsAdapter.capabilities.supportsProxy).toBe(false);
		expect(ns1DnsAdapter.capabilities.forcesProxy).toBe(false);
		expect(ns1DnsAdapter.capabilities.auth).toBe("api_key");
		expect(ns1DnsAdapter.capabilities.legoProvider).toBe("ns1");
	});

	it("testCredentials succeeds when zones list is authorized", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse([]));

		const result = await ns1DnsAdapter.testCredentials({ secret: KEY });

		expect(result.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(String(url)).toBe("https://api.nsone.net/v1/zones");
		expect(init.headers["X-NSONE-Key"]).toBe(KEY);
		expect(init.signal).toBeDefined();
	});

	it("testCredentials returns ok:false without echoing the secret", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ message: "Unauthorized" }, 401),
		);

		const result = await ns1DnsAdapter.testCredentials({ secret: KEY });

		expect(result.ok).toBe(false);
		expect(result.detail).toContain("401");
		expect(JSON.stringify(result)).not.toContain(KEY);
	});

	it("listZones maps zone name as id", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse([
				{
					id: "zhash",
					zone: "example.com",
					ttl: 3600,
					dns_servers: ["dns1.p01.nsone.net"],
				},
			]),
		);

		const zones = await ns1DnsAdapter.listZones({ secret: KEY });
		expect(zones).toEqual([
			{
				id: "example.com",
				name: "example.com",
				status: "active",
				meta: {
					ttl: 3600,
					ns1Id: "zhash",
					dnsServers: ["dns1.p01.nsone.net"],
				},
			},
		]);
	});

	it("listRecords maps short_answers under the zone", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				zone: "example.com",
				records: [
					{
						domain: "www.example.com",
						type: "A",
						ttl: 600,
						short_answers: ["1.2.3.4"],
					},
					{
						domain: "example.com",
						type: "MX",
						ttl: 3600,
						short_answers: ["10 mail.example.com"],
					},
				],
			}),
		);

		const records = await ns1DnsAdapter.listRecords(
			{ secret: KEY },
			"example.com",
		);

		expect(records).toEqual([
			{
				id: "www.example.com/A",
				zoneId: "example.com",
				name: "www.example.com",
				type: "A",
				content: "1.2.3.4",
				ttl: 600,
			},
			{
				id: "example.com/MX",
				zoneId: "example.com",
				name: "example.com",
				type: "MX",
				content: "10 mail.example.com",
				ttl: 3600,
			},
		]);
		expect(String(fetchMock.mock.calls[0]![0])).toBe(
			"https://api.nsone.net/v1/zones/example.com",
		);
	});

	it("upsertRecord PUTs when record does not exist", async () => {
		fetchMock
			.mockResolvedValueOnce(new Response("not found", { status: 404 }))
			.mockResolvedValueOnce(
				jsonResponse({
					domain: "www.example.com",
					type: "A",
					ttl: 600,
					answers: [{ answer: ["1.2.3.4"] }],
					short_answers: ["1.2.3.4"],
				}),
			);

		const record = await ns1DnsAdapter.upsertRecord(
			{ secret: KEY },
			{
				zoneId: "example.com",
				name: "www.example.com",
				type: "A",
				content: "1.2.3.4",
				ttl: 600,
			},
		);

		expect(record).toMatchObject({
			id: "www.example.com/A",
			content: "1.2.3.4",
			ttl: 600,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const createCall = fetchMock.mock.calls[1]!;
		expect(createCall[1].method).toBe("PUT");
		expect(JSON.parse(createCall[1].body)).toEqual({
			zone: "example.com",
			domain: "www.example.com",
			type: "A",
			ttl: 600,
			answers: [{ answer: ["1.2.3.4"] }],
		});
		expect(createCall[1].headers["X-NSONE-Key"]).toBe(KEY);
	});

	it("upsertRecord POSTs when record already exists", async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({
					domain: "www.example.com",
					type: "A",
					ttl: 3600,
					answers: [{ answer: ["9.9.9.9"] }],
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					domain: "www.example.com",
					type: "A",
					ttl: 300,
					answers: [{ answer: ["1.2.3.4"] }],
					short_answers: ["1.2.3.4"],
				}),
			);

		const record = await ns1DnsAdapter.upsertRecord(
			{ secret: KEY },
			{
				zoneId: "example.com",
				name: "www",
				type: "A",
				content: "1.2.3.4",
				ttl: 300,
			},
		);

		expect(record.content).toBe("1.2.3.4");
		const updateCall = fetchMock.mock.calls[1]!;
		expect(String(updateCall[0])).toBe(
			"https://api.nsone.net/v1/zones/example.com/www.example.com/A",
		);
		expect(updateCall[1].method).toBe("POST");
	});

	it("deleteRecord calls DELETE on the zone/domain/type path", async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		await ns1DnsAdapter.deleteRecord(
			{ secret: KEY },
			"example.com",
			"www.example.com/A",
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(String(url)).toBe(
			"https://api.nsone.net/v1/zones/example.com/www.example.com/A",
		);
		expect(init.method).toBe("DELETE");
		expect(init.headers["X-NSONE-Key"]).toBe(KEY);
	});

	it("never embeds the secret in thrown API errors", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ message: "Forbidden" }, 403),
		);

		let thrown: unknown;
		try {
			await ns1DnsAdapter.listZones({ secret: KEY });
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect(String(thrown)).toContain("403");
		expect(String(thrown)).not.toContain(KEY);
	});
});
