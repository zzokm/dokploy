import { and, desc, eq } from "drizzle-orm"
import { db } from "../../db"
import {
	applications,
	compose,
	deployments,
	environments,
	projects,
} from "../../db/schema"
import { getContainerLogs } from "../docker"
import { OperatorError, OperatorErrorCode } from "./errors"
import { redactSecrets } from "./redact"

export const listOperatorProjects = async (organizationId: string) => {
	return await db
		.select({
			projectId: projects.projectId,
			name: projects.name,
			description: projects.description,
			createdAt: projects.createdAt,
		})
		.from(projects)
		.where(eq(projects.organizationId, organizationId))
		.orderBy(projects.name)
}

export const listOperatorEnvironments = async (
	organizationId: string,
	projectId?: string,
) => {
	const rows = await db
		.select({
			environmentId: environments.environmentId,
			name: environments.name,
			projectId: environments.projectId,
			createdAt: environments.createdAt,
		})
		.from(environments)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			projectId
				? and(
						eq(projects.organizationId, organizationId),
						eq(environments.projectId, projectId),
					)
				: eq(projects.organizationId, organizationId),
		)
		.orderBy(environments.name)
	return rows
}

export const listOperatorApplications = async (
	organizationId: string,
	environmentId?: string,
) => {
	const rows = await db
		.select({
			applicationId: applications.applicationId,
			name: applications.name,
			appName: applications.appName,
			applicationStatus: applications.applicationStatus,
			environmentId: applications.environmentId,
			serverId: applications.serverId,
			createdAt: applications.createdAt,
		})
		.from(applications)
		.innerJoin(
			environments,
			eq(applications.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			environmentId
				? and(
						eq(projects.organizationId, organizationId),
						eq(applications.environmentId, environmentId),
					)
				: eq(projects.organizationId, organizationId),
		)
		.orderBy(applications.name)
	return rows
}

export const listOperatorComposeServices = async (
	organizationId: string,
	environmentId?: string,
) => {
	const rows = await db
		.select({
			composeId: compose.composeId,
			name: compose.name,
			appName: compose.appName,
			composeStatus: compose.composeStatus,
			environmentId: compose.environmentId,
			serverId: compose.serverId,
			createdAt: compose.createdAt,
		})
		.from(compose)
		.innerJoin(
			environments,
			eq(compose.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			environmentId
				? and(
						eq(projects.organizationId, organizationId),
						eq(compose.environmentId, environmentId),
					)
				: eq(projects.organizationId, organizationId),
		)
		.orderBy(compose.name)
	return rows
}

export const getOperatorServiceStatus = async (input: {
	organizationId: string
	applicationId?: string
	composeId?: string
}) => {
	if (input.applicationId) {
		const [app] = await db
			.select({
				applicationId: applications.applicationId,
				name: applications.name,
				appName: applications.appName,
				applicationStatus: applications.applicationStatus,
				environmentId: applications.environmentId,
			})
			.from(applications)
			.innerJoin(
				environments,
				eq(applications.environmentId, environments.environmentId),
			)
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(
				and(
					eq(projects.organizationId, input.organizationId),
					eq(applications.applicationId, input.applicationId),
				),
			)
			.limit(1)

		if (!app) {
			throw new OperatorError(
				OperatorErrorCode.not_found,
				"Application not found",
			)
		}

		const [lastDeploy] = await db
			.select({
				deploymentId: deployments.deploymentId,
				status: deployments.status,
				title: deployments.title,
				createdAt: deployments.createdAt,
			})
			.from(deployments)
			.where(eq(deployments.applicationId, input.applicationId))
			.orderBy(desc(deployments.createdAt))
			.limit(1)

		return {
			kind: "application" as const,
			...app,
			status: app.applicationStatus,
			lastDeploy: lastDeploy ?? null,
		}
	}

	if (input.composeId) {
		const [c] = await db
			.select({
				composeId: compose.composeId,
				name: compose.name,
				appName: compose.appName,
				composeStatus: compose.composeStatus,
				environmentId: compose.environmentId,
			})
			.from(compose)
			.innerJoin(
				environments,
				eq(compose.environmentId, environments.environmentId),
			)
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(
				and(
					eq(projects.organizationId, input.organizationId),
					eq(compose.composeId, input.composeId),
				),
			)
			.limit(1)

		if (!c) {
			throw new OperatorError(
				OperatorErrorCode.not_found,
				"Compose service not found",
			)
		}

		const [lastDeploy] = await db
			.select({
				deploymentId: deployments.deploymentId,
				status: deployments.status,
				title: deployments.title,
				createdAt: deployments.createdAt,
			})
			.from(deployments)
			.where(eq(deployments.composeId, input.composeId))
			.orderBy(desc(deployments.createdAt))
			.limit(1)

		return {
			kind: "compose" as const,
			...c,
			status: c.composeStatus,
			lastDeploy: lastDeploy ?? null,
		}
	}

	throw new OperatorError(
		OperatorErrorCode.validation_error,
		"applicationId or composeId is required",
	)
}

export const getOperatorServiceLogs = async (input: {
	appName: string
	tail?: number
	search?: string
	serverId?: string | null
}) => {
	const raw = await getContainerLogs(
		input.appName,
		input.tail ?? 100,
		"all",
		input.search,
		input.serverId,
	)
	return redactSecrets(raw)
}
