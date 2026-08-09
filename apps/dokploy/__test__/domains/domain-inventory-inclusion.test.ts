import { describe, expect, it } from "vitest";
import {
	isInventoryHostnameRecordType,
	normalizeInventoryHost,
	shouldIncludeDnsHostnameInInventory,
	shouldIncludeDomainBindingInInventory,
} from "@dokploy/server";

describe("normalizeInventoryHost", () => {
	it("lowercases and strips trailing dots", () => {
		expect(normalizeInventoryHost(" DevDB.hiy.me. ")).toBe("devdb.hiy.me");
	});
});

describe("shouldIncludeDomainBindingInInventory", () => {
	it("always includes application, compose, preview bindings", () => {
		expect(
			shouldIncludeDomainBindingInInventory({
				domainType: "compose",
				dnsProvider: "none",
				https: false,
				port: 5432,
				serviceName: "postgres",
			}),
		).toBe(true);
		expect(
			shouldIncludeDomainBindingInInventory({
				domainType: "application",
				dnsProvider: "cloudflare",
			}),
		).toBe(true);
		expect(
			shouldIncludeDomainBindingInInventory({
				domainType: "preview",
			}),
		).toBe(true);
	});
});

describe("shouldIncludeDnsHostnameInInventory", () => {
	it("includes unbound A records such as host-published DB hostnames", () => {
		expect(
			shouldIncludeDnsHostnameInInventory({
				type: "A",
				managedBy: "manual",
				host: "devdb.hiy.me",
				existingHosts: new Set(["jelly.hiy.me"]),
			}),
		).toBe(true);
	});

	it("skips hosts already covered by a domain binding", () => {
		expect(
			shouldIncludeDnsHostnameInInventory({
				type: "A",
				managedBy: "manual",
				host: "devdb.hiy.me",
				existingHosts: new Set(["devdb.hiy.me"]),
			}),
		).toBe(false);
	});

	it("skips legacy mail_stack and non-hostname types", () => {
		expect(
			shouldIncludeDnsHostnameInInventory({
				type: "A",
				managedBy: "mail_stack",
				host: "mail.hiy.me",
				existingHosts: new Set(),
			}),
		).toBe(false);
		expect(
			shouldIncludeDnsHostnameInInventory({
				type: "TXT",
				managedBy: "manual",
				host: "hiy.me",
				existingHosts: new Set(),
			}),
		).toBe(false);
	});

	it("accepts CNAME and AAAA", () => {
		expect(isInventoryHostnameRecordType("cname")).toBe(true);
		expect(isInventoryHostnameRecordType("AAAA")).toBe(true);
		expect(
			shouldIncludeDnsHostnameInInventory({
				type: "CNAME",
				host: "db.hiy.me",
				existingHosts: new Set(),
			}),
		).toBe(true);
	});
});
