import { CLEANUP_CRON_JOB } from "@dokploy/server/constants";
import { member } from "@dokploy/server/db/schema";
import type { BackupSchedule } from "@dokploy/server/services/backup";
import { findDestinationById } from "@dokploy/server/services/destination";
import { getAllServers } from "@dokploy/server/services/server";
import { getWebServerSettings } from "@dokploy/server/services/web-server-settings";
import { pollDomainConnectionsOnce } from "@dokploy/server/services/domain-connection";
import { syncAllDnsZonesAndRecords } from "@dokploy/server/services/dns/sync-zones";
import { eq } from "drizzle-orm";
import { scheduleJob } from "node-schedule";
import { db } from "../../db/index";
import { startLogCleanup } from "../access-log/handler";
import { cleanupAll } from "../docker/utils";
import { sendDockerCleanupNotifications } from "../notifications/docker-cleanup";
import { execAsync, execAsyncRemote } from "../process/execAsync";
import { redactRcloneCredentials } from "./redact";
import { getS3Credentials, normalizeS3Path, scheduleBackup } from "./utils";

/** Every 6 hours: refresh mirrored DNS zones + records for all orgs with vault credentials. */
const DNS_ZONE_SYNC_CRON = "0 */6 * * *";

export const initCronJobs = async () => {
	console.log("Setting up cron jobs....");

	const admin = await db.query.member.findFirst({
		where: eq(member.role, "owner"),
		with: {
			user: true,
		},
	});

	if (!admin) {
		return;
	}

	const webServerSettings = await getWebServerSettings();

	if (webServerSettings?.enableDockerCleanup) {
		try {
			scheduleJob("docker-cleanup", CLEANUP_CRON_JOB, async () => {
				console.log(
					`Docker Cleanup ${new Date().toLocaleString()}]  Running docker cleanup`,
				);

				await cleanupAll();

				await sendDockerCleanupNotifications(admin.user.id);
			});
		} catch (error) {
			console.error("[Backup] Docker Cleanup Error", error);
		}
	}

	const servers = await getAllServers();

	for (const server of servers) {
		const { serverId, enableDockerCleanup, name } = server;
		if (enableDockerCleanup) {
			try {
				scheduleJob(serverId, CLEANUP_CRON_JOB, async () => {
					console.log(
						`SERVER-BACKUP[${new Date().toLocaleString()}] Running Cleanup ${name}`,
					);

					await cleanupAll(serverId);

					await sendDockerCleanupNotifications(
						admin.user.id,
						`Docker cleanup for Server ${name} (${serverId})`,
					);
				});
			} catch (error) {
				console.error(`[Backup] ${error}`);
			}
		}
	}

	const backups = await db.query.backups.findMany({
		with: {
			destination: true,
			postgres: true,
			mariadb: true,
			mysql: true,
			mongo: true,
			libsql: true,
			user: true,
			compose: true,
		},
	});

	for (const backup of backups) {
		try {
			if (backup.enabled) {
				scheduleBackup(backup);
				console.log(
					`[Backup] ${backup.databaseType} Enabled with cron: [${backup.schedule}]`,
				);
			}
		} catch (error) {
			console.error(`[Backup] ${backup.databaseType} Error`, error);
		}
	}

	if (webServerSettings?.logCleanupCron) {
		try {
			console.log(
				"Starting log requests cleanup",
				webServerSettings.logCleanupCron,
			);
			await startLogCleanup(webServerSettings.logCleanupCron);
		} catch (error) {
			console.error("[Backup] Log Cleanup Error", error);
		}
	}

	try {
		scheduleJob("domain-connection-poll", "*/10 * * * *", async () => {
			const result = await pollDomainConnectionsOnce({ limit: 20 });
			if (result.checked > 0) {
				console.log(
					`[Domain] Polled ${result.checked} domain connection checks`,
				);
			}
		});
	} catch (error) {
		console.error("[Domain] Poll schedule error", error);
	}

	try {
		scheduleJob("dns-zones-sync", DNS_ZONE_SYNC_CRON, async () => {
			const result = await syncAllDnsZonesAndRecords();
			console.log(
				`[DNS] Auto sync finished orgs=${result.orgs} zones=${result.zonesSynced} records=${result.recordsSynced} errors=${result.errors}`,
			);
		});
		console.log(`[DNS] Auto sync enabled with cron: [${DNS_ZONE_SYNC_CRON}]`);
	} catch (error) {
		console.error("[DNS] Auto sync schedule error", error);
	}
};

const getServiceAppName = (backup: BackupSchedule): string => {
	if (backup.compose?.appName) {
		return backup.serviceName
			? `${backup.compose.appName}_${backup.serviceName}`
			: backup.compose.appName;
	}
	const serviceAppName =
		backup.postgres?.appName ||
		backup.mysql?.appName ||
		backup.mariadb?.appName ||
		backup.mongo?.appName ||
		backup.libsql?.appName;
	return serviceAppName || backup.appName;
};

export const keepLatestNBackups = async (
	backup: BackupSchedule,
	serverId?: string | null,
) => {
	// 0 also immediately returns which is good as the empty "keep latest" field in the UI
	// is saved as 0 in the database
	if (!backup.keepLatestCount) return;

	try {
		const destination = await findDestinationById(backup.destinationId);
		const rcloneFlags = getS3Credentials(destination);
		const appName = getServiceAppName(backup);
		const backupFilesPath = `:s3:${destination.bucket}/${appName}/${normalizeS3Path(backup.prefix)}`;

		// --include "*.bson.gz" or "*.sql.gz" or "*.zip" ensures nothing else other than the dokploy backup files are touched by rclone
		const rcloneList = `rclone lsf ${rcloneFlags.join(" ")} --include "*${backup.databaseType === "web-server" ? ".zip" : ".{sql.gz,bson.gz}"}" ${backupFilesPath}`;
		// when we pipe the above command with this one, we only get the list of files we want to delete
		const sortAndPickUnwantedBackups = `sort -r | tail -n +$((${backup.keepLatestCount}+1)) | xargs -I{}`;
		// this command deletes the files
		// to test the deletion before actually deleting we can add --dry-run before ${backupFilesPath}{}
		const rcloneDelete = `rclone delete ${rcloneFlags.join(" ")} ${backupFilesPath}{}`;

		const rcloneCommand = `${rcloneList} | ${sortAndPickUnwantedBackups} ${rcloneDelete}`;

		if (serverId) {
			await execAsyncRemote(serverId, rcloneCommand);
		} else {
			await execAsync(rcloneCommand);
		}
	} catch (error) {
		console.error(redactRcloneCredentials(String(error)));
	}
};
