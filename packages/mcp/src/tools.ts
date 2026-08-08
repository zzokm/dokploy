import { z } from "zod";
import { apiGet, apiPost, formatToolResult } from "./client.js";

export type ToolDef = {
	name: string;
	description: string;
	schema: z.ZodObject<z.ZodRawShape>;
	annotations?: {
		title?: string;
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};
	handler: (input: Record<string, unknown>) => Promise<ReturnType<typeof formatToolResult>>;
};

const empty = z.object({});

export const tools: ToolDef[] = [
	{
		name: "dokploy.ping",
		description:
			"Health check for Dokploy operator API. Fails clearly with code unauthorized if DOKPLOY_API_KEY is missing/invalid. Example: {}",
		schema: empty,
		annotations: {
			title: "Dokploy Ping",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async () => formatToolResult(await apiGet("/operator.ping")),
	},
	{
		name: "dokploy.whoami",
		description:
			"Return authenticated user id/email/role/org (never secrets). Use to verify MCP auth. Example: {}",
		schema: empty,
		annotations: {
			title: "Dokploy Whoami",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async () => formatToolResult(await apiGet("/operator.whoami")),
	},
	{
		name: "cloudflare.status",
		description:
			"Show whether Cloudflare integration is configured/healthy for the org. Returns apiTokenLast4 only — never the token. Example: {}",
		schema: empty,
		annotations: {
			title: "Cloudflare Status",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async () =>
			formatToolResult(await apiGet("/operator.cloudflareStatus")),
	},
	{
		name: "cloudflare.listZones",
		description:
			"List Cloudflare zones accessible via the configured Dokploy Cloudflare credential. Example: {}",
		schema: empty,
		annotations: {
			title: "List Cloudflare Zones",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async () => formatToolResult(await apiGet("/operator.listZones")),
	},
	{
		name: "cloudflare.listDnsRecords",
		description:
			"List DNS records in a Cloudflare zone. Params: cfZoneId (required). Example: {\"cfZoneId\":\"abc123\"}",
		schema: z.object({
			cfZoneId: z.string().min(1).describe("Cloudflare zone id"),
		}),
		annotations: {
			title: "List Zone DNS Records",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(
				await apiGet("/operator.listZoneDnsRecords", input),
			),
	},
	{
		name: "cloudflare.upsertDnsRecord",
		description:
			"Idempotent create/update of A/AAAA/CNAME/TXT/MX by zone+name. Default proxied=false (DNS-only) for Traefik HTTP-01. Example: {\"name\":\"app.example.com\",\"type\":\"A\",\"content\":\"23.94.107.153\",\"proxied\":false}",
		schema: z.object({
			cfZoneId: z.string().optional(),
			name: z.string().min(1),
			type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX"]),
			content: z.string().min(1),
			proxied: z.boolean().optional(),
			ttl: z.union([z.literal(1), z.number().int()]).optional(),
			priority: z.number().int().optional(),
		}),
		annotations: {
			title: "Upsert DNS Record",
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.upsertDnsRecord", input)),
	},
	{
		name: "cloudflare.deleteDnsRecord",
		description:
			"Delete a DNS record by Cloudflare ids. Example: {\"cfZoneId\":\"z\",\"cfRecordId\":\"r\"}",
		schema: z.object({
			cfZoneId: z.string().min(1),
			cfRecordId: z.string().min(1),
		}),
		annotations: {
			title: "Delete DNS Record",
			destructiveHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.deleteDnsRecord", input)),
	},
	{
		name: "dns.waitForResolution",
		description:
			"Poll until hostname resolves (optionally to expectedIp). Errors: dns_missing, dns_mismatch, timeout. Example: {\"host\":\"app.example.com\",\"expectedIp\":\"23.94.107.153\",\"timeoutMs\":120000}",
		schema: z.object({
			host: z.string().min(1),
			expectedIp: z.string().optional(),
			timeoutMs: z.number().int().optional(),
			intervalMs: z.number().int().optional(),
		}),
		annotations: {
			title: "Wait for DNS Resolution",
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.waitDns", input)),
	},
	{
		name: "domain.list",
		description:
			"List Dokploy domain bindings for an application or compose. Example: {\"applicationId\":\"...\"} or {\"composeId\":\"...\"}",
		schema: z.object({
			applicationId: z.string().optional(),
			composeId: z.string().optional(),
		}),
		annotations: {
			title: "List Domains",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiGet("/operator.listDomains", input)),
	},
	{
		name: "domain.create",
		description:
			"Low-level domain create (does NOT wait for DNS — prefer domain.provision). Example: {\"host\":\"app.example.com\",\"domainType\":\"application\",\"applicationId\":\"...\",\"https\":true}",
		schema: z.object({
			host: z.string().min(1),
			domainType: z.enum(["application", "compose"]),
			applicationId: z.string().optional(),
			composeId: z.string().optional(),
			serviceName: z.string().optional(),
			port: z.number().int().optional(),
			path: z.string().optional(),
			https: z.boolean().optional(),
			certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
			dnsProvider: z.enum(["none", "cloudflare"]).optional(),
			cfProxied: z.boolean().optional(),
		}),
		annotations: {
			title: "Create Domain (primitive)",
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.createDomain", input)),
	},
	{
		name: "domain.update",
		description:
			"Update an existing domain binding. Example: {\"domainId\":\"...\",\"port\":8080,\"https\":true}",
		schema: z.object({
			domainId: z.string().min(1),
			host: z.string().optional(),
			port: z.number().int().optional(),
			path: z.string().optional(),
			https: z.boolean().optional(),
			certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
			serviceName: z.string().optional(),
			cfProxied: z.boolean().optional(),
		}),
		annotations: {
			title: "Update Domain",
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.updateDomain", input)),
	},
	{
		name: "domain.delete",
		description:
			"Remove a domain binding. Example: {\"domainId\":\"...\"}",
		schema: z.object({
			domainId: z.string().min(1),
		}),
		annotations: {
			title: "Delete Domain",
			destructiveHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.deleteDomain", input)),
	},
	{
		name: "domain.provision",
		description:
			"SAFE Auto DNS workflow: (1) upsert A record (2) wait until DNS resolves (3) attach Dokploy domain+HTTPS (4) observe ACME cert (5) HTTPS health. DNS-before-domain prevents NXDOMAIN races. Cloudflare Auto DNS always forces proxied=true + DNS-01 (letsencrypt-cloudflare); `proxied` input is ignored for CF. Example: {\"host\":\"app.example.com\",\"domainType\":\"compose\",\"composeId\":\"...\",\"serviceName\":\"web\",\"port\":3000}",
		schema: z.object({
			host: z.string().min(1),
			domainType: z.enum(["application", "compose"]),
			applicationId: z.string().optional(),
			composeId: z.string().optional(),
			serviceName: z.string().optional(),
			port: z.number().int().optional(),
			path: z.string().optional(),
			https: z.boolean().optional(),
			/** Ignored for Cloudflare — always proxied+DNS-01. Kept for compat. */
			proxied: z.boolean().optional(),
			targetIp: z.string().optional(),
			waitDnsTimeoutMs: z.number().int().optional(),
			skipHealthCheck: z.boolean().optional(),
			dryRun: z.boolean().optional(),
		}),
		annotations: {
			title: "Provision Domain (ordered)",
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.domainProvision", input)),
	},
	{
		name: "cert.status",
		description:
			"List ACME cert status for a hostname (issued/pending/failed/missing) + last Traefik error if any. Never returns private keys. Example: {\"host\":\"app.example.com\"}",
		schema: z.object({
			host: z.string().min(1),
		}),
		annotations: {
			title: "Certificate Status",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiGet("/operator.certStatus", input)),
	},
	{
		name: "cert.retry",
		description:
			"Remove stored ACME cert for hostname and restart Traefik so issuance retries after DNS was fixed. Example: {\"host\":\"app.example.com\"}",
		schema: z.object({
			host: z.string().min(1),
		}),
		annotations: {
			title: "Retry Certificate",
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.certRetry", input)),
	},
	{
		name: "traefik.acmeErrors",
		description:
			"Recent Traefik/ACME log lines for a hostname (secrets redacted). Example: {\"host\":\"app.example.com\",\"tail\":200}",
		schema: z.object({
			host: z.string().optional(),
			tail: z.number().int().optional(),
		}),
		annotations: {
			title: "Traefik ACME Errors",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiGet("/operator.traefikAcmeErrors", input)),
	},
	{
		name: "project.list",
		description: "List projects in the active organization. Example: {}",
		schema: empty,
		annotations: {
			title: "List Projects",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async () =>
			formatToolResult(await apiGet("/operator.listProjects")),
	},
	{
		name: "environment.list",
		description:
			"List environments (optionally filter by projectId). Example: {\"projectId\":\"...\"}",
		schema: z.object({
			projectId: z.string().optional(),
		}),
		annotations: {
			title: "List Environments",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiGet("/operator.listEnvironments", input)),
	},
	{
		name: "application.list",
		description:
			"List applications (optional environmentId). Example: {\"environmentId\":\"...\"}",
		schema: z.object({
			environmentId: z.string().optional(),
		}),
		annotations: {
			title: "List Applications",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiGet("/operator.listApplications", input)),
	},
	{
		name: "compose.list",
		description:
			"List compose services (optional environmentId). Example: {\"environmentId\":\"...\"}",
		schema: z.object({
			environmentId: z.string().optional(),
		}),
		annotations: {
			title: "List Compose Services",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiGet("/operator.listCompose", input)),
	},
	{
		name: "service.status",
		description:
			"Get running/failed status + last deploy for an application or compose. Example: {\"composeId\":\"...\"}",
		schema: z.object({
			applicationId: z.string().optional(),
			composeId: z.string().optional(),
		}),
		annotations: {
			title: "Service Status",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiGet("/operator.serviceStatus", input)),
	},
	{
		name: "service.logs",
		description:
			"Tail container/service logs with secret redaction. Example: {\"appName\":\"my-app\",\"tail\":200,\"search\":\"error\"}",
		schema: z.object({
			appName: z.string().min(1),
			tail: z.number().int().optional(),
			search: z.string().optional(),
			serverId: z.string().optional(),
		}),
		annotations: {
			title: "Service Logs",
			readOnlyHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiGet("/operator.serviceLogs", input)),
	},
	{
		name: "application.deploy",
		description:
			"Deploy/redeploy an application. Example: {\"applicationId\":\"...\"}",
		schema: z.object({
			applicationId: z.string().min(1),
			title: z.string().optional(),
			description: z.string().optional(),
		}),
		annotations: {
			title: "Deploy Application",
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/application.deploy", input)),
	},
	{
		name: "application.redeploy",
		description:
			"Redeploy an application. Example: {\"applicationId\":\"...\"}",
		schema: z.object({
			applicationId: z.string().min(1),
			title: z.string().optional(),
			description: z.string().optional(),
		}),
		annotations: {
			title: "Redeploy Application",
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/application.redeploy", input)),
	},
	{
		name: "application.reload",
		description:
			"Restart/reload an application service. Example: {\"applicationId\":\"...\",\"appName\":\"...\"}",
		schema: z.object({
			applicationId: z.string().min(1),
			appName: z.string().min(1),
		}),
		annotations: {
			title: "Reload Application",
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/application.reload", input)),
	},
	{
		name: "compose.deploy",
		description:
			"Deploy a compose stack. Example: {\"composeId\":\"...\"}",
		schema: z.object({
			composeId: z.string().min(1),
			title: z.string().optional(),
			description: z.string().optional(),
		}),
		annotations: {
			title: "Deploy Compose",
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/compose.deploy", input)),
	},
	{
		name: "compose.redeploy",
		description:
			"Redeploy a compose stack. Example: {\"composeId\":\"...\"}",
		schema: z.object({
			composeId: z.string().min(1),
			title: z.string().optional(),
			description: z.string().optional(),
		}),
		annotations: {
			title: "Redeploy Compose",
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/compose.redeploy", input)),
	},
	{
		name: "url.health",
		description:
			"Public URL health: DNS resolve + HTTPS status + error class (ENOTFOUND/dns_missing, dns_mismatch, cert_error, backend_down, ok). Example: {\"host\":\"app.example.com\",\"expectedIp\":\"23.94.107.153\"}",
		schema: z.object({
			host: z.string().min(1),
			path: z.string().optional(),
			expectedIp: z.string().optional(),
			timeoutMs: z.number().int().optional(),
		}),
		annotations: {
			title: "URL Health Check",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiGet("/operator.urlHealth", input)),
	},
];
