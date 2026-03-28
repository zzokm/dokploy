import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, like, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
	bindZoneFilePathForNamedConf,
	serverPaths,
} from "../../constants/server-paths";
import type * as schema from "../../db/schema";
import { dnsRecord, hostedDomain } from "../../db/schema/hosted-domain";
import { rndcReloadBind } from "../../utils/docker/reload-bind";
import {
	computeSoaSerial,
	generateZoneFile,
	type SoaMeta,
} from "../../utils/dns/zone-file";
import { generateNamedConfLocal } from "../../utils/dns/named-local";
import { getRemoteDocker } from "../../utils/servers/remote-docker";

export const listHostedDomains = async (
	db: PostgresJsDatabase<typeof schema>,
	organizationId: string,
) =>
	db
		.select()
		.from(hostedDomain)
		.where(eq(hostedDomain.organizationId, organizationId));

export const getHostedDomainById = async (
	db: PostgresJsDatabase<typeof schema>,
	id: string,
	organizationId: string,
) => {
	const [row] = await db
		.select()
		.from(hostedDomain)
		.where(
			and(
				eq(hostedDomain.id, id),
				eq(hostedDomain.organizationId, organizationId),
			),
		)
		.limit(1);
	return row ?? null;
};

export const createHostedDomain = async (
	db: PostgresJsDatabase<typeof schema>,
	input: {
		organizationId: string;
		name: string;
		isDnsManaged?: boolean;
		isMailManaged?: boolean;
		serverId?: string | null;
	},
) => {
	const [row] = await db
		.insert(hostedDomain)
		.values({
			organizationId: input.organizationId,
			name: input.name.trim().toLowerCase(),
			isDnsManaged: input.isDnsManaged ?? true,
			isMailManaged: input.isMailManaged ?? false,
			serverId: input.serverId ?? null,
		})
		.returning();
	return row;
};

export const applyDnsForDomain = async (
	db: PostgresJsDatabase<typeof schema>,
	opts: {
		domainId: string;
		organizationId: string;
		isServer?: boolean;
	},
): Promise<void> => {
	const domain = await getHostedDomainById(
		db,
		opts.domainId,
		opts.organizationId,
	);
	if (!domain || !domain.isDnsManaged) {
		throw new Error("Domain not found or DNS not managed");
	}

	const records = await db
		.select()
		.from(dnsRecord)
		.where(eq(dnsRecord.domainId, domain.id));

	const p = serverPaths(opts.isServer);
	const zonesDir = path.join(p.dnsConfigDir, "zones");
	await mkdir(zonesDir, { recursive: true });

	const zoneFileName = path.join(zonesDir, `${domain.name}.zone`);
	const soa: SoaMeta = {
		primaryNs: `ns1.${domain.name}`,
		adminEmail: `hostmaster@${domain.name}`,
		serial: computeSoaSerial(),
	};

	const body = generateZoneFile(domain.name, records, soa);
	const tmp = `${zoneFileName}.tmp`;
	await writeFile(tmp, body, "utf8");
	await rename(tmp, zoneFileName);

	const allDomains = await db
		.select()
		.from(hostedDomain)
		.where(
			and(
				eq(hostedDomain.organizationId, opts.organizationId),
				eq(hostedDomain.isDnsManaged, true),
			),
		);

	const namedBody = generateNamedConfLocal(
		allDomains.map((d) => ({
			zoneName: d.name,
			fileName: bindZoneFilePathForNamedConf(d.name),
		})),
	);
	const namedPath = path.join(p.dnsConfigDir, "named.conf.local");
	const namedTmp = `${namedPath}.tmp`;
	await writeFile(namedTmp, namedBody, "utf8");
	await rename(namedTmp, namedPath);

	if (process.env.PANEL_SKIP_RNDC_RELOAD === "true") {
		return;
	}
	const dockerClient = await getRemoteDocker(domain.serverId);
	await rndcReloadBind(dockerClient, p.bindContainerName);
};

/**
 * Replaces standard automated mail DNS rows (MX, SPF, DMARC, DKIM) for a domain.
 * Deletes prior rows this flow manages, then bulk-inserts fresh values.
 */
export const replaceStandardMailDnsRecords = async (
	db: PostgresJsDatabase<typeof schema>,
	domainId: string,
	opts: { mailHost: string; dkimTxt: string },
) => {
	const exists = await db
		.select({ id: hostedDomain.id })
		.from(hostedDomain)
		.where(eq(hostedDomain.id, domainId))
		.limit(1);
	if (!exists[0]) {
		return;
	}
	const spf = "v=spf1 mx ~all";
	const dmarc = "v=DMARC1; p=quarantine; adkim=r; aspf=r;";
	const mailHost = opts.mailHost.replace(/\.$/, "");
	const rows = [
		{
			domainId,
			type: "MX",
			recordName: "@",
			content: mailHost,
			ttl: 3600,
			priority: 10,
			srvWeight: null,
			srvPort: null,
			srvTarget: null,
		},
		{
			domainId,
			type: "TXT",
			recordName: "@",
			content: spf,
			ttl: 3600,
			priority: null,
			srvWeight: null,
			srvPort: null,
			srvTarget: null,
		},
		{
			domainId,
			type: "TXT",
			recordName: "_dmarc",
			content: dmarc,
			ttl: 3600,
			priority: null,
			srvWeight: null,
			srvPort: null,
			srvTarget: null,
		},
		{
			domainId,
			type: "TXT",
			recordName: "mail._domainkey",
			content: opts.dkimTxt,
			ttl: 3600,
			priority: null,
			srvWeight: null,
			srvPort: null,
			srvTarget: null,
		},
	];

	await db.transaction(async (tx) => {
		await tx.delete(dnsRecord).where(
			and(
				eq(dnsRecord.domainId, domainId),
				or(
					and(eq(dnsRecord.type, "MX"), eq(dnsRecord.recordName, "@")),
					and(eq(dnsRecord.type, "TXT"), eq(dnsRecord.recordName, "_dmarc")),
					and(
						eq(dnsRecord.type, "TXT"),
						eq(dnsRecord.recordName, "mail._domainkey"),
					),
					and(
						eq(dnsRecord.type, "TXT"),
						eq(dnsRecord.recordName, "default._domainkey"),
					),
					and(
						eq(dnsRecord.type, "TXT"),
						eq(dnsRecord.recordName, "@"),
						like(dnsRecord.content, "v=spf1%"),
					),
				),
			),
		);
		await tx.insert(dnsRecord).values(rows);
	});
};

export const checkDnsStackStatus = async (serverId?: string | null) => {
	const p = serverPaths();
	const docker = await getRemoteDocker(serverId ?? undefined);
	try {
		const container = docker.getContainer(p.bindContainerName);
		await container.inspect();
		return {
			ok: true as const,
			message: `BIND container "${p.bindContainerName}" is running.`,
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Unknown error";
		return {
			ok: false as const,
			message: `Cannot reach BIND container "${p.bindContainerName}": ${msg}`,
		};
	}
};
