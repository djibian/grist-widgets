import { fuzzyTextScore, normalizeIdentifier } from "./search.js";
import { targetNameVariants, usableCoordinates } from "./identity-resolution.js";

export const OVERPASS_IDENTITY_URL = "https://overpass-api.de/api/interpreter";
export const DEFAULT_IDENTITY_RADIUS_METERS = 500;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildNearbyIdentityOverpassQuery(latitude, longitude, radius = DEFAULT_IDENTITY_RADIUS_METERS) {
  const coordinates = usableCoordinates(latitude, longitude);
  if (!coordinates) return "";
  const safeRadius = Math.min(1000, Math.max(100, Math.round(Number(radius) || DEFAULT_IDENTITY_RADIUS_METERS)));
  const { latitude: lat, longitude: lon } = coordinates;
  return `[out:json][timeout:15];\n(\n`
    + `  nwr(around:${safeRadius},${lat},${lon})["name"];\n`
    + `  nwr(around:${safeRadius},${lat},${lon})["brand"];\n`
    + `  nwr(around:${safeRadius},${lat},${lon})["operator"];\n`
    + `  nwr(around:${safeRadius},${lat},${lon})["ref:FR:SIRET"];\n`
    + `);\nout center tags;`;
}

function elementCoordinates(element) {
  return usableCoordinates(element?.lat ?? element?.center?.lat, element?.lon ?? element?.center?.lon);
}

function publicNames(tags = {}) {
  const seen = new Set();
  const result = [];
  for (const value of [tags.name, tags.brand, tags.operator, tags["name:fr"]]) {
    const name = clean(value);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function osmAddress(tags = {}) {
  return [
    clean(tags["addr:housenumber"]),
    clean(tags["addr:street"]),
    clean(tags["addr:place"]),
    clean(tags["addr:postcode"]),
    clean(tags["addr:city"]),
  ].filter(Boolean).join(" ");
}

function normalizedSiret(value) {
  const id = normalizeIdentifier(value);
  return id.length === 14 ? id : "";
}

export function identityPoiFromElement(element) {
  const tags = element?.tags ?? {};
  const names = publicNames(tags);
  const coordinates = elementCoordinates(element);
  if (!names.length && !normalizedSiret(tags["ref:FR:SIRET"])) return null;
  return {
    source: "osm",
    sourceLabel: "OpenStreetMap",
    sourceRecordId: `${element?.type ?? ""}:${element?.id ?? ""}`,
    publicNames: names,
    siret: normalizedSiret(tags["ref:FR:SIRET"]),
    adresse: osmAddress(tags),
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
  };
}

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const lat1 = a.latitude * Math.PI / 180;
  const lon1 = a.longitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const lon2 = b.longitude * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function rankIdentityPois(elements, row, { latitude, longitude, radius = DEFAULT_IDENTITY_RADIUS_METERS } = {}) {
  const targetCoordinates = usableCoordinates(latitude, longitude);
  if (!targetCoordinates) return [];
  const variants = targetNameVariants(row);
  if (!variants.length) return [];
  const safeRadius = Math.min(1000, Math.max(100, Math.round(Number(radius) || DEFAULT_IDENTITY_RADIUS_METERS)));
  const seen = new Set();
  const candidates = [];

  for (const element of Array.isArray(elements) ? elements : []) {
    const poi = identityPoiFromElement(element);
    if (!poi || seen.has(poi.sourceRecordId)) continue;
    seen.add(poi.sourceRecordId);
    const poiCoordinates = usableCoordinates(poi.latitude, poi.longitude);
    const distance = distanceMeters(targetCoordinates, poiCoordinates);
    if (!Number.isFinite(distance) || distance > safeRadius) continue;
    const nameScore = Math.max(0, ...poi.publicNames.flatMap(name => variants.map(target => fuzzyTextScore(target, name))));
    if (nameScore < 0.65) continue;
    candidates.push({ ...poi, nameScore, distanceMeters: distance });
  }

  return candidates
    .sort((a, b) => b.nameScore - a.nameScore || a.distanceMeters - b.distanceMeters || a.sourceRecordId.localeCompare(b.sourceRecordId))
    .slice(0, 3);
}

async function requestOverpass(query, { signal, fetchImpl = fetch } = {}) {
  if (!query) return [];
  // GET évite certains 406 observés sur l'interpréteur Overpass avec les POST
  // urlencoded, tout en restant compatible avec ces requêtes locales courtes.
  const url = new URL(OVERPASS_IDENTITY_URL);
  url.searchParams.set("data", query);
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    signal,
  });
  if (response.status === 429) throw new Error("OpenStreetMap limite temporairement la recherche d’identité.");
  if (!response.ok) throw new Error(`Recherche d’identité OpenStreetMap indisponible (HTTP ${response.status}).`);
  const payload = await response.json();
  return Array.isArray(payload?.elements) ? payload.elements : [];
}

export async function findOsmIdentityPois({ row, latitude, longitude, radius = DEFAULT_IDENTITY_RADIUS_METERS, signal, fetchImpl = fetch } = {}) {
  const query = buildNearbyIdentityOverpassQuery(latitude, longitude, radius);
  if (!query) return { source: "osm", candidates: [], complete: true };
  const elements = await requestOverpass(query, { signal, fetchImpl });
  return {
    source: "osm",
    candidates: rankIdentityPois(elements, row, { latitude, longitude, radius }),
    complete: true,
  };
}
