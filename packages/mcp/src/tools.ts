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
		name: "dns.status",
		description:
			"Show whether DNS provider credentials (Cloudflare, Route53, Porkbun, Infomaniak, OVH) are configured for the active organization. Returns safe summary with last4 only. Example: {}",
		schema: empty,
		annotations: {
			title: "DNS Provider Status",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async () =>
			formatToolResult(await apiGet("/operator.dnsStatus")),
	},
	{
		name: "dns.listZones",
		description:
			"List all DNS zones accessible across configured DNS providers (Cloudflare, Route53, Porkbun, Infomaniak, OVH). Example: {}",
		schema: empty,
		annotations: {
			title: "List DNS Zones",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async () => formatToolResult(await apiGet("/operator.listDnsZones")),
	},
	{
		name: "dns.listRecords",
		description:
			"List DNS records in a zone across configured DNS providers. Params: dnsZoneId, optional dnsProviderId. Example: {\"dnsZoneId\":\"abc123\"}",
		schema: z.object({
			dnsZoneId: z.string().min(1).describe("DNS Zone id"),
			dnsProviderId: z
				.string()
				.min(1)
				.optional()
				.describe("Optional upstream DNS provider ID"),
			credentialId: z.string().min(1).optional(),
		}),
		annotations: {
			title: "List Zone DNS Records",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(
				await apiGet("/operator.listDnsRecords", {
					dnsZoneId: input.dnsZoneId,
					dnsProviderId: input.dnsProviderId,
					credentialId: input.credentialId,
				}),
			),
	},
	{
		name: "dns.upsertRecord",
		description:
			"Idempotent create/update of A/AAAA/CNAME/TXT/MX across any configured DNS provider. Proxied supported on Cloudflare. Example: {\"name\":\"app.example.com\",\"type\":\"A\",\"content\":\"23.94.107.153\"}",
		schema: z.object({
			dnsZoneId: z.string().optional().describe("DNS Zone ID"),
			dnsProviderId: z
				.string()
				.optional()
				.describe("Optional upstream DNS provider ID"),
			name: z.string().min(1).describe("FQDN e.g. app.example.com"),
			type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX"]),
			content: z.string().min(1).describe("IP address or host target"),
			proxied: z
				.boolean()
				.optional()
				.describe(
					"Proxy traffic through CDN (supported on Cloudflare; ignored on DNS-only providers)",
				),
			ttl: z.union([z.literal(1), z.number().int()]).optional(),
			priority: z.number().int().optional(),
		}),
		annotations: {
			title: "Upsert DNS Record",
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(
				await apiPost("/operator.upsertDnsRecord", input),
			),
	},
	{
		name: "dns.deleteRecord",
		description:
			"Delete a DNS record by zone and record ids across any configured provider. Example: {\"dnsZoneId\":\"z\",\"dnsRecordId\":\"r\"}",
		schema: z.object({
			dnsZoneId: z.string().min(1).describe("DNS Zone ID"),
			dnsRecordId: z.string().min(1).describe("DNS Record ID"),
			dnsProviderId: z.string().min(1).optional(),
		}),
		annotations: {
			title: "Delete DNS Record",
			destructiveHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(
				await apiPost("/operator.deleteDnsRecord", input),
			),
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
		name: "dns.provision",
		description:
			"Provision a DNS record across configured DNS providers (Cloudflare, Route53, Porkbun, Infomaniak, OVH) and wait for DNS resolution. Auto-detects zone from FQDN or accepts explicit zone/provider. Example: {\"name\":\"api.example.com\",\"content\":\"23.94.107.153\",\"type\":\"A\"}",
		schema: z.object({
			name: z.string().min(1).describe("FQDN e.g. api.example.com"),
			type: z
				.enum(["A", "AAAA", "CNAME", "TXT", "MX"])
				.optional()
				.default("A"),
			content: z.string().min(1).describe("Target IP or CNAME target"),
			proxied: z.boolean().optional().default(true),
			ttl: z.union([z.literal(1), z.number().int()]).optional().default(1),
			priority: z.number().int().optional(),
			waitForResolution: z.boolean().optional().default(true),
			waitDnsTimeoutMs: z.number().int().optional(),
			provider: z.string().optional().describe("DNS provider name e.g. cloudflare, route53, porkbun, infomaniak, ovh"),
			dnsProviderId: z.string().optional().describe("DNS provider id from Settings -> DNS Providers"),
			dnsZoneId: z.string().optional().describe("DNS Zone id"),
		}),
		annotations: {
			title: "Provision DNS Record",
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.provisionDns", input)),
	},
	{
		name: "domain.list",
		description:
			"List Dokploy domain bindings for an application, compose, or the main Dokploy server. Example: {\"applicationId\":\"...\"} or {\"includeServerDomain\":true}",
		schema: z.object({
			applicationId: z.string().optional(),
			composeId: z.string().optional(),
			includeServerDomain: z.boolean().optional(),
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
		name: "domain.get",
		description:
			"Get a specific domain by domainId (use 'server' for main Dokploy instance) or by hostname. Example: {\"domainId\":\"server\"} or {\"host\":\"app.example.com\"}",
		schema: z.object({
			domainId: z.string().optional(),
			host: z.string().optional(),
		}),
		annotations: {
			title: "Get Domain",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiGet("/operator.getDomain", input)),
	},
	{
		name: "domain.create",
		description:
			"Full domain create primitive for application, compose, or the main Dokploy server. Supports all routing, path stripping, custom cert resolvers, and middlewares. Example: {\"host\":\"app.example.com\",\"domainType\":\"application\",\"applicationId\":\"...\",\"https\":true,\"autoPort\":true}",
		schema: z.object({
			host: z.string().min(1),
			domainType: z.enum(["application", "compose", "server"]),
			applicationId: z.string().optional(),
			composeId: z.string().optional(),
			serviceName: z.string().optional(),
			port: z.number().int().optional(),
			autoPort: z.boolean().optional(),
			path: z.string().optional(),
			internalPath: z.string().optional(),
			stripPath: z.boolean().optional(),
			https: z.boolean().optional(),
			certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
			customCertResolver: z.string().optional().nullable(),
			useCustomEntrypoint: z.boolean().optional(),
			customEntrypoint: z.string().optional().nullable(),
			middlewares: z.array(z.string()).optional(),
			dnsProvider: z
				.enum([
					"none",
					"cloudflare",
					"digitalocean",
					"hetzner",
					"route53",
					"porkbun",
					"infomaniak",
					"ovh",
					"gcloud",
				])
				.optional(),
			cfProxied: z.boolean().optional(),
			letsEncryptEmail: z
				.string()
				.optional()
				.describe("Used when domainType is server"),
		}),
		annotations: {
			title: "Create Domain (full)",
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.createDomain", input)),
	},
	{
		name: "domain.update",
		description:
			"Update an existing domain binding (or 'server' for main Dokploy domain) with all advanced routing, port, and security settings. Example: {\"domainId\":\"...\",\"port\":8080,\"https\":true,\"stripPath\":true}",
		schema: z.object({
			domainId: z
				.string()
				.min(1)
				.describe("Domain id or 'server' for Dokploy instance domain"),
			host: z.string().optional(),
			port: z.number().int().optional(),
			autoPort: z.boolean().optional(),
			path: z.string().optional(),
			internalPath: z.string().optional(),
			stripPath: z.boolean().optional(),
			https: z.boolean().optional(),
			certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
			customCertResolver: z.string().optional().nullable(),
			useCustomEntrypoint: z.boolean().optional(),
			customEntrypoint: z.string().optional().nullable(),
			middlewares: z.array(z.string()).optional(),
			serviceName: z.string().optional(),
			cfProxied: z.boolean().optional(),
			enabled: z.boolean().optional(),
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
			"Remove a domain binding (or reset server domain when domainId is 'server'). Example: {\"domainId\":\"...\"}",
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
			"SAFE Auto DNS workflow for applications, compose stacks, or the main Dokploy server: (1) upsert DNS A record (2) wait until public DNS resolves (3) attach Dokploy domain/server settings + HTTPS (4) observe ACME cert (5) HTTPS health check. Prevents NXDOMAIN / rate-limit races across any configured DNS provider.",
		schema: z.object({
			host: z.string().min(1),
			domainType: z.enum(["application", "compose", "server"]),
			applicationId: z.string().optional(),
			composeId: z.string().optional(),
			serviceName: z.string().optional(),
			port: z.number().int().optional(),
			autoPort: z.boolean().optional(),
			path: z.string().optional(),
			internalPath: z.string().optional(),
			stripPath: z.boolean().optional(),
			https: z.boolean().optional(),
			certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
			customCertResolver: z.string().optional().nullable(),
			useCustomEntrypoint: z.boolean().optional(),
			customEntrypoint: z.string().optional().nullable(),
			middlewares: z.array(z.string()).optional(),
			letsEncryptEmail: z.string().optional(),
			targetIp: z.string().optional(),
			proxied: z
				.boolean()
				.optional()
				.describe("Proxy through Cloudflare CDN when using Cloudflare"),
			waitDnsTimeoutMs: z.number().int().optional(),
			skipHealthCheck: z.boolean().optional(),
			dryRun: z.boolean().optional(),
			provider: z
				.enum([
					"cloudflare",
					"digitalocean",
					"hetzner",
					"route53",
					"porkbun",
					"infomaniak",
					"ovh",
					"gcloud",
				])
				.optional(),
			dnsProviderId: z
				.string()
				.optional()
				.describe("DNS provider id from Settings -> DNS Providers"),
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
		name: "serverDomain.get",
		description:
			"Get current main Dokploy web server domain configuration (host, serverIp, https, certificateType, letsEncryptEmail) and DNS preview across configured DNS providers. Example: {}",
		schema: z.object({}),
		annotations: {
			title: "Get Server Domain",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async () =>
			formatToolResult(await apiGet("/operator.serverDomainStatus")),
	},
	{
		name: "serverDomain.set",
		description:
			"Set or update the main Dokploy web server domain, configure HTTPS and certificate resolver, and update server Traefik router. Example: {\"host\":\"dokploy.example.com\",\"https\":true,\"certificateType\":\"letsencrypt\"}",
		schema: z.object({
			host: z.string().min(1),
			https: z.boolean().optional().default(true),
			certificateType: z
				.enum(["letsencrypt", "none", "custom"])
				.optional()
				.default("letsencrypt"),
			letsEncryptEmail: z.string().optional(),
		}),
		annotations: {
			title: "Set Server Domain",
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.assignServerDomain", input)),
	},
	{
		name: "serverDomain.previewDns",
		description:
			"Preview DNS drift, target IP, zone match, and current record for the main Dokploy server domain across configured DNS providers. Example: {\"proxied\":true}",
		schema: z.object({
			proxied: z.boolean().optional().default(true),
		}),
		annotations: {
			title: "Preview Server Domain DNS",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(
				await apiGet("/operator.previewServerDomainDns", input),
			),
	},
	{
		name: "serverDomain.applyDns",
		description:
			"Sync/apply DNS A-record for the main Dokploy server domain with configured DNS provider and configure Traefik certificate resolver. Example: {\"proxied\":true}",
		schema: z.object({
			proxied: z.boolean().optional().default(true),
		}),
		annotations: {
			title: "Apply Server Domain DNS",
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(await apiPost("/operator.applyServerDomainDns", input)),
	},
	{
		name: "serverDomain.provision",
		description:
			"End-to-end automated zero-downtime provisioning of the main Dokploy server domain: upsert DNS -> wait resolution -> update server settings & Traefik -> observe ACME certificate -> verify HTTPS health across configured DNS providers. Example: {\"host\":\"dokploy.example.com\",\"https\":true}",
		schema: z.object({
			host: z.string().min(1),
			https: z.boolean().optional().default(true),
			certificateType: z
				.enum(["letsencrypt", "none", "custom"])
				.optional()
				.default("letsencrypt"),
			letsEncryptEmail: z.string().optional(),
			targetIp: z.string().optional(),
			proxied: z.boolean().optional(),
			waitDnsTimeoutMs: z.number().int().optional(),
			skipHealthCheck: z.boolean().optional(),
			dryRun: z.boolean().optional(),
			provider: z.string().optional(),
			dnsProviderId: z.string().optional(),
		}),
		annotations: {
			title: "Provision Server Domain (ordered)",
			idempotentHint: true,
			openWorldHint: true,
		},
		handler: async (input) =>
			formatToolResult(
				await apiPost("/operator.provisionServerDomain", input),
			),
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
