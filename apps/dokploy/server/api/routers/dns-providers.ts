import {
	listDnsProviderCredentials,
	setDnsProviderCredential,
	deleteDnsProviderCredential,
	rotateDnsProviderCredential,
	resolveDnsProviderSecret,
	type DnsProviderId,
} from "@dokploy/server/services/dns";
import {
	ensureDnsAdaptersRegistered,
	getRegisteredAdapter,
	resolveAcmeForProvider,
} from "@dokploy/server/services/dns/orchestration";
import { DNS_PROVIDER_CAPABILITIES } from "@dokploy/server/services/dns/types";
import { ensureTraefikDnsProviderToken } from "@dokploy/server/services/dns/ensure-traefik-dns-token";
import { canSealSecrets } from "@dokploy/server/utils/crypto/seal";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const providerIdSchema = z.enum([
	"cloudflare",
	"digitalocean",
	"hetzner",
	"route53",
	"gcloud",
	"ns1",
	"akamai",
]);

export const dnsProvidersRouter = createTRPCRouter({
	listCapabilities: protectedProcedure.query(() => {
		ensureDnsAdaptersRegistered();
		return Object.entries(DNS_PROVIDER_CAPABILITIES).map(([id, caps]) => ({
			id: id as DnsProviderId,
			...caps,
			acme: resolveAcmeForProvider(id as DnsProviderId),
			adapterRegistered: !!getRegisteredAdapter(id as DnsProviderId),
		}));
	}),

	list: protectedProcedure.query(async ({ ctx }) => {
		return listDnsProviderCredentials(ctx.session.activeOrganizationId);
	}),

	setCredential: protectedProcedure
		.input(
			z.object({
				provider: providerIdSchema,
				label: z.string().min(1).max(120),
				secret: z.string().min(8),
				meta: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (!canSealSecrets()) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"DOKPLOY_ENCRYPTION_KEY is required to store DNS provider secrets securely",
				});
			}

			ensureDnsAdaptersRegistered();
			const adapter = getRegisteredAdapter(input.provider);
			if (adapter) {
				const test = await adapter.testCredentials({
					secret: input.secret,
					meta: input.meta,
				});
				if (!test.ok) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: test.detail ?? "Credential validation failed",
					});
				}
			}

			const row = await setDnsProviderCredential({
				organizationId: ctx.session.activeOrganizationId,
				provider: input.provider,
				label: input.label,
				secret: input.secret,
				meta: input.meta,
			});

			// Best-effort Traefik DNS-01 inject when provider requires it
			if (DNS_PROVIDER_CAPABILITIES[input.provider].requiresDns01WhenManaged) {
				void ensureTraefikDnsProviderToken({
					organizationId: ctx.session.activeOrganizationId,
					provider: input.provider,
					credentialId: row.id,
				}).catch(() => {});
			}

			return row;
		}),

	rotateCredential: protectedProcedure
		.input(
			z.object({
				credentialId: z.string().min(1),
				secret: z.string().min(8),
				label: z.string().min(1).max(120).optional(),
				meta: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (!canSealSecrets()) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"DOKPLOY_ENCRYPTION_KEY is required to store DNS provider secrets securely",
				});
			}
			return rotateDnsProviderCredential({
				organizationId: ctx.session.activeOrganizationId,
				credentialId: input.credentialId,
				secret: input.secret,
				label: input.label,
				meta: input.meta,
			});
		}),

	deleteCredential: protectedProcedure
		.input(z.object({ credentialId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			return deleteDnsProviderCredential(
				ctx.session.activeOrganizationId,
				input.credentialId,
			);
		}),

	testCredential: protectedProcedure
		.input(
			z.object({
				provider: providerIdSchema,
				secret: z.string().min(8),
				meta: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			ensureDnsAdaptersRegistered();
			const adapter = getRegisteredAdapter(input.provider);
			if (!adapter) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Adapter not registered for ${input.provider}`,
				});
			}
			return adapter.testCredentials({
				secret: input.secret,
				meta: input.meta,
			});
		}),

	/** Internal-style: list zones for a stored credential (last4 path only). */
	listZonesForCredential: protectedProcedure
		.input(
			z.object({
				credentialId: z.string().min(1),
			}),
		)
		.query(async ({ ctx, input }) => {
			ensureDnsAdaptersRegistered();
			const resolved = await resolveDnsProviderSecret({
				organizationId: ctx.session.activeOrganizationId,
				credentialId: input.credentialId,
			});
			if (!resolved) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Credential not found" });
			}
			const adapter = getRegisteredAdapter(resolved.provider);
			if (!adapter) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Adapter not registered for ${resolved.provider}`,
				});
			}
			return adapter.listZones({ secret: resolved.secret });
		}),
});
