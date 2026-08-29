import { fuzzyTextScore, normalizeIdentifier } from "./search.js";

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export const DEFAULT_NEARBY_RADIUS_METERS = 300;

const CONTACT_KEYS = Object.freeze([
  "phone",
  "contact:phone",
  "mobile",
  "contact:mobile",
  "email",
  "contact:email",
  "website",
  "contact:website",
  "url",
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasCoordinateValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function normalizeSiret(value) {
  const identifier = normalizeIdentifier(value);
  return identifier.length === 14 ? identifier : "";
}

function escapeOverpassString(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildSiretOverpassQuery(value) {
  const siret = normalizeSiret(value);
  if (!siret) return "";
  const escaped = escapeOverpassString(siret);
  return `[out:json][timeout:15];\n(\n  nwr["ref:FR:SIRET"="${escaped}"];\n);\nout center tags;`;
}

export function buildNearbyOverpassQuery(latitude, longitude, radius = DEFAULT_NEARBY_RADIUS_METERS) {
  if (!hasCoordinateValue(latitude) || !hasCoordinateValue(longitude)) return "";
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return "";
  const safeRadius = Math.min(1000, Math.max(50, Math.round(Number(radius) || DEFAULT_NEARBY_RADIUS_METERS)));
  const lines = CONTACT_KEYS.map(key => `  nwr(around:${safeRadius},${lat},${lon})["name"]["${key}"];`).join("\n");
  return `[out:json][timeout:15];\n(\n${lines}\n);\nout center tags;`;
}

function firstTag(tags, keys) {
  for (const key of keys) {
    const value = clean(tags?.[key]);
    if (value) return value;
  }
  return "";
}

export function extractOsmContact(element) {
  const tags = element?.tags ?? {};
  const telephone = firstTag(tags, ["contact:phone", "phone", "contact:mobile", "mobile"]);
  const courriel = firstTag(tags, ["contact:email", "email"]);
  const siteWeb = firstTag(tags, ["contact:website", "website", "url"]);
  const rawLatitude = element?.lat ?? element?.center?.lat;
  const rawLongitude = element?.lon ?? element?.center?.lon;
  const latitude = hasCoordinateValue(rawLatitude) ? Number(rawLatitude) : NaN;
  const longitude = hasCoordinateValue(rawLongitude) ? Number(rawLongitude) : NaN;
  const address = [
    clean(tags["addr:housenumber"]),
    clean(tags["addr:street"]),
    clean(tags["addr:postcode"]),
    clean(tags["addr:city"]),
  ].filter(Boolean).join(" ");

  return {
    osmType: clean(element?.type),
    osmId: element?.id ?? null,
    nom: firstTag(tags, ["name", "brand", "operator"]),
    siret: normalizeSiret(tags["ref:FR:SIRET"]),
    telephone,
    courriel,
    siteWeb,
    adresse: address,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

function hasContact(candidate) {
  return Boolean(candidate?.telephone || candidate?.courriel || candidate?.siteWeb);
}

function radians(value) {
  return value * Math.PI / 180;
}

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const rawValues = [lat1, lon1, lat2, lon2];
  if (!rawValues.every(hasCoordinateValue)) return Infinity;
  const values = rawValues.map(Number);
  if (!values.every(Number.isFinite)) return Infinity;
  const [aLat, aLon, bLat, bLon] = values.map(radians);
  const dLat = bLat - aLat;
  const dLon = bLon - aLon;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function uniqueElements(elements) {
  const seen = new Set();
  const result = [];
  for (const element of Array.isArray(elements) ? elements : []) {
    const key = `${element?.type ?? ""}:${element?.id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(element);
  }
  return result;
}

function sourceLabel(candidate) {
  if (candidate.confidence === "siret") return "OpenStreetMap · SIRET identique";
  if (Number.isFinite(candidate.distanceMeters)) return `OpenStreetMap · proximité + nom · ${Math.round(candidate.distanceMeters)} m`;
  return "OpenStreetMap · proximité + nom";
}

function finalizeCandidate(candidate, confidence, extra = {}) {
  return {
    ...candidate,
    ...extra,
    confidence,
    source: sourceLabel({ ...candidate, ...extra, confidence }),
  };
}

export function exactSiretContacts(elements, siret) {
  const target = normalizeSiret(siret);
  if (!target) return [];
  return uniqueElements(elements)
    .map(extractOsmContact)
    .filter(candidate => candidate.siret === target && hasContact(candidate))
    .map(candidate => finalizeCandidate(candidate, "siret"))
    .sort((a, b) => contactRichness(b) - contactRichness(a));
}

function contactRichness(candidate) {
  return [candidate?.telephone, candidate?.courriel, candidate?.siteWeb].filter(Boolean).length;
}

export function rankNearbyContacts(elements, target, radius = DEFAULT_NEARBY_RADIUS_METERS) {
  const targetName = clean(target?.name);
  if (!hasCoordinateValue(target?.latitude) || !hasCoordinateValue(target?.longitude)) return [];
  const latitude = Number(target.latitude);
  const longitude = Number(target.longitude);
  if (!targetName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  const safeRadius = Math.min(1000, Math.max(50, Math.round(Number(radius) || DEFAULT_NEARBY_RADIUS_METERS)));

  return uniqueElements(elements)
    .map(extractOsmContact)
    .filter(hasContact)
    .map(candidate => {
      const nameScore = fuzzyTextScore(targetName, candidate.nom);
      const distance = distanceMeters(latitude, longitude, candidate.latitude, candidate.longitude);
      const distanceScore = Number.isFinite(distance) ? Math.max(0, 1 - distance / safeRadius) : 0;
      const score = nameScore * 0.82 + distanceScore * 0.18;
      return finalizeCandidate(candidate, "nearby", { nameScore, distanceMeters: distance, score });
    })
    .filter(candidate => candidate.nameScore >= 0.45 && candidate.distanceMeters <= safeRadius)
    .sort((a, b) => b.score - a.score || contactRichness(b) - contactRichness(a) || a.distanceMeters - b.distanceMeters)
    .slice(0, 3);
}

async function requestOverpass(query, { signal, fetchImpl = fetch } = {}) {
  if (!query) return [];
  const response = await fetchImpl(OVERPASS_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal,
  });
  if (response.status === 429) throw new Error("OpenStreetMap limite temporairement les recherches de contacts.");
  if (!response.ok) throw new Error(`Recherche de contacts OpenStreetMap indisponible (HTTP ${response.status}).`);
  const payload = await response.json();
  return Array.isArray(payload?.elements) ? payload.elements : [];
}

export async function findOsmContacts({ siret = "", name = "", latitude = null, longitude = null, signal, fetchImpl = fetch, radius = DEFAULT_NEARBY_RADIUS_METERS } = {}) {
  const exactSiret = normalizeSiret(siret);
  if (exactSiret) {
    const elements = await requestOverpass(buildSiretOverpassQuery(exactSiret), { signal, fetchImpl });
    const candidates = exactSiretContacts(elements, exactSiret);
    if (candidates.length) return { mode: "siret", candidates: candidates.slice(0, 3) };
  }

  const nearbyQuery = buildNearbyOverpassQuery(latitude, longitude, radius);
  if (!nearbyQuery || !clean(name)) return { mode: "none", candidates: [] };
  const elements = await requestOverpass(nearbyQuery, { signal, fetchImpl });
  const candidates = rankNearbyContacts(elements, { name, latitude, longitude }, radius);
  return { mode: candidates.length ? "nearby" : "none", candidates };
}
