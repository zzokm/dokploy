/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */

/** @type {any} */
const nextConfig = {
	reactStrictMode: true,
	// Reduce parallelism during `next build` to avoid OOM/SIGKILL on small builders.
	serverWorkers: 4,
	typescript: {
		ignoreBuildErrors: true,
	},
	experimental: {
		webpackMemoryOptimizations: true,
	},
	transpilePackages: ["@dokploy/server"],
	async redirects() {
		return [
			{
				source: "/dashboard/settings/infra-domains",
				destination: "/dashboard/domains",
				permanent: false,
			},
			{
				source: "/dashboard/settings/infra-emails",
				destination: "/dashboard/domains",
				permanent: false,
			},
			{
				source: "/dashboard/emails",
				destination: "/dashboard/domains",
				permanent: false,
			},
			{
				source: "/dashboard/emails/:path*",
				destination: "/dashboard/domains",
				permanent: false,
			},
			{
				source: "/dashboard/settings/infra-panel",
				destination: "/dashboard/domains",
				permanent: false,
			},
		];
	},
	async headers() {
		return [
			{
				// Apply security headers to all routes
				source: "/:path*",
				headers: [
					{
						key: "X-Frame-Options",
						value: "DENY",
					},
					{
						key: "Content-Security-Policy",
						value: "frame-ancestors 'none'",
					},
					{
						key: "X-Content-Type-Options",
						value: "nosniff",
					},
					{
						key: "Referrer-Policy",
						value: "strict-origin-when-cross-origin",
					},
				],
			},
		];
	},
};

export default nextConfig;
