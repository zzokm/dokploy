import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { serverPaths } from "../../constants/server-paths";
import type * as schema from "../../db/schema";
import {
	hostedDomain,
	mailAlias,
	mailbox,
} from "../../db/schema/hosted-domain";
import {
	applyDnsForDomain,
	getHostedDomainById,
	replaceStandardMailDnsRecords,
} from "../dns";
import {
	generateDkimKeyPair,
	readDkimDnsTxtFromPublicKeyFile,
} from "../../utils/mail/dkim-openssl";
import { extractMailTlsFromAcmeJson } from "../../utils/mail/extract-acme-certs";
import {
	type AliasLine,
	buildPasswdFile,
	buildVirtualAliasesFile,
	formatVirtualDomains,
	type MailboxLine,
} from "../../utils/mail/mail-flat-files";
import { hashMailboxPassword } from "../../utils/mail/password";
import { reloadMailServices } from "../docker/reload-mail";
import { getRemoteDocker } from "../../utils/servers/remote-docker";

const defaultMailUid = "5000";
const defaultMailGid = "5000";

const MAIL_DKIM_SELECTOR = "mail";

/**
 * Writes Traefik ACME material for `mail.<apex>` (fallback: apex) into
 * `mailTlsDir/<apex>/cert.pem` and `key.pem` for Exim/Dovecot mounts.
 */
export const syncMailTlsFromTraefikForApex = async (opts: {
	apexDomain: string;
	isServer?: boolean;
}): Promise<void> => {
	const p = serverPaths(opts.isServer);
	const apex = opts.apexDomain.trim().toLowerCase();
	const mailHost = `mail.${apex}`;
	const outDir = path.join(p.mailTlsDir, apex);
	await mkdir(outDir, { recursive: true });
	await extractMailTlsFromAcmeJson({
		acmeJsonPath: p.acmeJsonPath,
		domainCandidates: [mailHost, apex],
		outCertPath: path.join(outDir, "cert.pem"),
		outKeyPath: path.join(outDir, "key.pem"),
	});
};

/** @deprecated Prefer `syncMailTlsFromTraefikForApex`; `domain` is the apex hostname. */
export const extractMailTlsForDomain = async (opts: {
	domain: string;
	isServer?: boolean;
}) => {
	await syncMailTlsFromTraefikForApex({
		apexDomain: opts.domain,
		isServer: opts.isServer,
	});
};

const writeDkimPemCopy = async (
	dkimKeysDir: string,
	apexDomain: string,
	privateKeyPath: string,
) => {
	const dir = path.join(dkimKeysDir, apexDomain);
	await mkdir(dir, { recursive: true });
	const dest = path.join(dir, "dkim.pem");
	await copyFile(privateKeyPath, dest);
};

export const ensureDkimForMailDomain = async (
	db: PostgresJsDatabase<typeof schema>,
	domainId: string,
	isServer?: boolean,
) => {
	const [domain] = await db
		.select()
		.from(hostedDomain)
		.where(eq(hostedDomain.id, domainId))
		.limit(1);
	if (!domain?.isMailManaged) {
		return;
	}
	const p = serverPaths(isServer);
	const mailHost = `mail.${domain.name}`;
	let dnsTxtValue: string;

	const needsNewKeys =
		!domain.dkimPrivateKeyPath ||
		!domain.dkimSelector ||
		domain.dkimSelector !== MAIL_DKIM_SELECTOR;

	if (needsNewKeys) {
		const generated = await generateDkimKeyPair({
			keysDir: p.dkimKeysDir,
			domain: domain.name,
			selector: MAIL_DKIM_SELECTOR,
		});
		dnsTxtValue = generated.dnsTxtValue;
		await db
			.update(hostedDomain)
			.set({
				dkimSelector: generated.selector,
				dkimPrivateKeyPath: generated.privateKeyPath,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(hostedDomain.id, domainId));
		await writeDkimPemCopy(p.dkimKeysDir, domain.name, generated.privateKeyPath);
	} else {
		const publicPath = path.join(
			p.dkimKeysDir,
			`${domain.name}.${domain.dkimSelector}.public.pem`,
		);
		dnsTxtValue = await readDkimDnsTxtFromPublicKeyFile(publicPath);
		await writeDkimPemCopy(
			p.dkimKeysDir,
			domain.name,
			domain.dkimPrivateKeyPath!,
		);
	}

	await replaceStandardMailDnsRecords(db, domainId, {
		mailHost,
		dkimTxt: dnsTxtValue,
	});
};

/**
 * When mail is first enabled: DKIM + standard DNS rows, TLS export from Traefik ACME,
 * mail flat files, and optional BIND zone push.
 */
export const onboardMailServiceForDomain = async (
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
	if (!domain?.isMailManaged) {
		return;
	}
	await ensureDkimForMailDomain(db, opts.domainId, opts.isServer);
	try {
		await syncMailTlsFromTraefikForApex({
			apexDomain: domain.name,
			isServer: opts.isServer,
		});
	} catch {
		// Certificate may not exist until Traefik has issued for mail.<apex>
	}
	await applyMailConfigurations(db, {
		organizationId: opts.organizationId,
		serverId: domain.serverId,
	});
	if (domain.isDnsManaged) {
		await applyDnsForDomain(db, {
			domainId: opts.domainId,
			organizationId: opts.organizationId,
			isServer: opts.isServer,
		});
	}
};

/**
 * Writes global `passwd`, `virtual_domains`, and `virtual` (tab-separated aliases)
 * for all mail-managed domains in the organization, then reloads Dovecot/Exim.
 */
export const applyMailConfigurations = async (
	db: PostgresJsDatabase<typeof schema>,
	opts: {
		organizationId: string;
		isServer?: boolean;
		serverId?: string | null;
	},
): Promise<void> => {
	const mailDomains = await db
		.select()
		.from(hostedDomain)
		.where(
			and(
				eq(hostedDomain.organizationId, opts.organizationId),
				eq(hostedDomain.isMailManaged, true),
			),
		);

	const allMailLines: MailboxLine[] = [];
	const allAliasLines: AliasLine[] = [];

	const p = serverPaths(opts.isServer);
	for (const domain of mailDomains) {
		const boxes = await db
			.select()
			.from(mailbox)
			.where(eq(mailbox.domainId, domain.id));
		const aliases = await db
			.select()
			.from(mailAlias)
			.where(eq(mailAlias.domainId, domain.id));

		for (const b of boxes.filter((x) => x.isActive)) {
			allMailLines.push({
				email: `${b.localPart}@${domain.name}`,
				passwordHash: b.passwordHash,
				uid: defaultMailUid,
				gid: defaultMailGid,
				home: path.join(p.mailDataDir, domain.name, b.localPart),
			});
		}
		for (const a of aliases) {
			allAliasLines.push({
				source: `${a.sourceLocalPart}@${domain.name}`,
				destination: a.destination,
			});
		}
		if (domain.catchAllLocalPart) {
			allAliasLines.push({
				source: `@${domain.name}`,
				destination: `${domain.catchAllLocalPart}@${domain.name}`,
			});
		}
	}

	await mkdir(p.mailAuthDir, { recursive: true });

	const passwdPath = path.join(p.mailAuthDir, p.mailPasswdFileName);
	const vdPath = path.join(p.mailAuthDir, p.mailVirtualDomainsFileName);
	const vaPath = path.join(p.mailAuthDir, p.mailVirtualAliasFileName);
	const tmpP = `${passwdPath}.tmp`;
	const tmpVd = `${vdPath}.tmp`;
	const tmpVa = `${vaPath}.tmp`;

	const domainNames = mailDomains.map((d) => d.name);
	await writeFile(tmpP, buildPasswdFile(allMailLines), "utf8");
	await writeFile(tmpVd, formatVirtualDomains(domainNames), "utf8");
	await writeFile(tmpVa, buildVirtualAliasesFile(allAliasLines), "utf8");
	await rename(tmpP, passwdPath);
	await rename(tmpVd, vdPath);
	await rename(tmpVa, vaPath);

	const serverId =
		opts.serverId ?? mailDomains.find((d) => d.serverId)?.serverId ?? null;
	const docker = await getRemoteDocker(serverId ?? undefined);
	await reloadMailServices(docker, p);
};

export const createMailbox = async (
	db: PostgresJsDatabase<typeof schema>,
	input: {
		organizationId: string;
		domainId: string;
		localPart: string;
		password: string;
		quotaBytes?: number;
	},
) => {
	const domain = await getHostedDomainById(
		db,
		input.domainId,
		input.organizationId,
	);
	if (!domain) {
		throw new Error("Domain not found");
	}
	if (!domain.isMailManaged) {
		throw new Error("Mail not enabled for this domain");
	}
	const hash = await hashMailboxPassword(input.password);
	const [row] = await db
		.insert(mailbox)
		.values({
			domainId: input.domainId,
			localPart: input.localPart,
			passwordHash: hash,
			quotaBytes: input.quotaBytes ?? 5_368_709_120,
		})
		.returning();
	await applyMailConfigurations(db, {
		organizationId: input.organizationId,
		serverId: domain.serverId,
	});
	return row;
};

export const listMailboxesForDomain = async (
	db: PostgresJsDatabase<typeof schema>,
	domainId: string,
	organizationId: string,
) => {
	const d = await getHostedDomainById(db, domainId, organizationId);
	if (!d) {
		return null;
	}
	return db
		.select()
		.from(mailbox)
		.where(eq(mailbox.domainId, domainId));
};

export const listAliasesForDomain = async (
	db: PostgresJsDatabase<typeof schema>,
	domainId: string,
	organizationId: string,
) => {
	const d = await getHostedDomainById(db, domainId, organizationId);
	if (!d) {
		return null;
	}
	return db
		.select()
		.from(mailAlias)
		.where(eq(mailAlias.domainId, domainId));
};

export const listMailManagedDomains = async (
	db: PostgresJsDatabase<typeof schema>,
	organizationId: string,
) =>
	db
		.select()
		.from(hostedDomain)
		.where(
			and(
				eq(hostedDomain.organizationId, organizationId),
				eq(hostedDomain.isMailManaged, true),
			),
		);
