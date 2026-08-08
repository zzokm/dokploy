export type ClientConfig = {
	dokployUrl: string;
	apiKey: string;
	timeoutMs: number;
};

export function loadConfig(): ClientConfig {
	const dokployUrl = process.env.DOKPLOY_URL?.trim();
	const apiKey = process.env.DOKPLOY_API_KEY?.trim();
	if (!dokployUrl) {
		throw new Error(
			"DOKPLOY_URL is required (e.g. https://dokploy.example.com). Do not include /api.",
		);
	}
	if (!apiKey) {
		throw new Error(
			"DOKPLOY_API_KEY is required. Create one in Dokploy → Settings → Profile → API Keys.",
		);
	}
	return {
		dokployUrl: dokployUrl.replace(/\/+$/, ""),
		apiKey,
		timeoutMs: Number(process.env.DOKPLOY_TIMEOUT || 120_000),
	};
}
