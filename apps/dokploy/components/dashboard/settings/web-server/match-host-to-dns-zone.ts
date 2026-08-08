/**
 * Match a hostname to the longest synced Cloudflare zone and derive the label
 * used by the Cloudflare managed domain builder (@ or subdomain).
 */
export const matchHostToCloudflareZone = (
	host: string,
	zones: Array<{ cfZoneId: string; name: string }>,
): { cfZoneId: string; zoneName: string; label: string } | null => {
	const normalizedHost = host.trim().toLowerCase().replace(/\.$/, "");
	if (!normalizedHost || !zones.length) {
		return null;
	}

	const matches = zones
		.map((zone) => ({
			cfZoneId: zone.cfZoneId,
			zoneName: zone.name.trim().toLowerCase(),
		}))
		.filter(
			(zone) =>
				!!zone.zoneName &&
				(normalizedHost === zone.zoneName ||
					normalizedHost.endsWith(`.${zone.zoneName}`)),
		)
		.sort((a, b) => b.zoneName.length - a.zoneName.length);

	const best = matches[0];
	if (!best) {
		return null;
	}

	const label =
		normalizedHost === best.zoneName
			? "@"
			: normalizedHost.slice(0, -(best.zoneName.length + 1));

	return {
		cfZoneId: best.cfZoneId,
		zoneName: best.zoneName,
		label: label || "@",
	};
};
