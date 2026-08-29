export const GEOCODE_URL = "https://data.geopf.fr/geocodage/search";

export function buildGeocodeUrl(address, { limit = 5 } = {}) {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("q", String(address ?? "").trim());
  url.searchParams.set("autocomplete", "0");
  url.searchParams.set("index", "address");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("returntruegeometry", "true");
  return url.toString();
}

export function normalizeGeocodeFeature(feature) {
  const coordinates = feature?.geometry?.coordinates;
  const properties = feature?.properties ?? {};
  const longitude = Number(Array.isArray(coordinates) ? coordinates[0] : NaN);
  const latitude = Number(Array.isArray(coordinates) ? coordinates[1] : NaN);
  const score = Number(properties.score);

  if (!String(properties.label ?? "").trim()) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    adresse: String(properties.label).trim(),
    latitude,
    longitude,
    score: Number.isFinite(score) ? score : null,
    codePostal: String(properties.postcode ?? "").trim(),
    commune: String(properties.city ?? properties.name ?? "").trim(),
  };
}

export function geocodeResultsFromPayload(payload, limit = 5) {
  return (Array.isArray(payload?.features) ? payload.features : [])
    .map(normalizeGeocodeFeature)
    .filter(Boolean)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

export async function geocodeAddress(address, { signal, limit = 5 } = {}) {
  const response = await fetch(buildGeocodeUrl(address, { limit }), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`Géocodage indisponible (HTTP ${response.status}).`);
  return geocodeResultsFromPayload(await response.json(), limit);
}
