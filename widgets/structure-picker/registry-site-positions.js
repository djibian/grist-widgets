import { addressEvidence, registryLinkValid, registryPublicNameMatch, usableCoordinates } from "./identity-resolution.js";
import { pointInsideSingleBuilding } from "./address-building-positions.js";

export const REGISTRY_POSITION_BASE = new URL("./site-position-indexes/osm-education/", import.meta.url);
const clean = value => String(value ?? "").trim();

export function educationSiteLinks(candidate, links = []) {
  return links.filter(link => link.source === "education" && registryLinkValid(link, candidate,
    { NomCommercial: link.registryRecord?.name ?? "", Adresse: candidate.adresse }));
}

// A bounding-box centre can lie outside a concave campus. Select a point from
// its longest interior scanline and verify strict containment. No distance join.
export function interiorSitePoint(shape) {
  const ring = shape?.type === "Polygon" && shape.coordinates?.length === 1 ? shape.coordinates[0] : null;
  if (!ring || ring.length < 4 || ring.length > 2000) return null;
  const ys = [...new Set(ring.map(point => point[1]))].sort((a, b) => a - b);
  let best;
  for (let i = 1; i < ys.length; i += 1) {
    const y = (ys[i - 1] + ys[i]) / 2;
    const xs = [];
    for (let j = 1; j < ring.length; j += 1) {
      const [a, b] = ring[j - 1]; const [c, d] = ring[j];
      if ((b > y) !== (d > y)) xs.push(a + (y - b) * (c - a) / (d - b));
    }
    xs.sort((a, b) => a - b);
    for (let j = 1; j < xs.length; j += 2) {
      const width = xs[j] - xs[j - 1]; const point = [(xs[j] + xs[j - 1]) / 2, y];
      if ((!best || width > best.width) && pointInsideSingleBuilding(point, shape)) best = { width, point };
    }
  }
  return best ? { latitude: best.point[1], longitude: best.point[0] } : null;
}

export function educationPositionFromElement(element, snapshot = {}) {
  const tags = element?.tags ?? {};
  if (!Number.isSafeInteger(element?.id) || element.id <= 0 || !Number.isSafeInteger(element.version) || element.version < 1
    || !Number.isFinite(Date.parse(element.timestamp)) || !Number.isFinite(Date.parse(snapshot.generatedAt))
    || Date.parse(element.timestamp) > Date.parse(snapshot.generatedAt)) return null;
  const ids = clean(tags["ref:UAI"] || tags["ref:FR:UAI"]).split(/[;,]/).map(id => id.trim().toUpperCase());
  if (!ids.length || ids.some(id => !/^\d{7}[A-Z]$/.test(id))) return null;
  let shape;
  if (element.type === "way" && element.geometry?.length >= 4 && element.nodes?.[0] === element.nodes?.at(-1)) {
    const ring = element.geometry.map(point => [point.lon, point.lat]);
    if (ring.every(point => usableCoordinates(point[1], point[0])) && String(ring[0]) === String(ring.at(-1))) shape = { type: "Polygon", coordinates: [ring] };
  }
  const coordinates = element.type === "node" ? usableCoordinates(element.lat, element.lon) : interiorSitePoint(shape);
  if (!coordinates) return null;
  return { kind: "education-site", name: clean(tags.name || tags["name:fr"]), uaiIds: [...new Set(ids)], shape,
    adresse: [tags["addr:housenumber"], tags["addr:street"], tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" "),
    qualityError: Boolean(tags.fixme || tags["fixme:position"] || tags.note?.match(/position.*(?:approxim|definir)/i)
      || tags.highway || tags.place || tags.amenity !== "school" || Object.keys(tags).some(key => /^(disused|abandoned|demolished):/.test(key))),
    ...coordinates, source: { id: "osm", label: "OpenStreetMap", recordId: `${element.type}:${element.id}`,
      url: `https://www.openstreetmap.org/${element.type}/${element.id}`, geometry: shape ? "site-interior-point" : "point",
      version: element.version, updatedAt: element.timestamp, generatedAt: snapshot.generatedAt, indexUrl: snapshot.indexUrl,
      snapshotUrl: snapshot.url, license: "ODbL 1.0", tags } };
}

export function assessEducationPosition(candidate, poi, { links = [], identityStatus } = {}) {
  const refuse = reason => ({ observation: poi, accepted: false, reason });
  if (identityStatus !== "MATCH_VERIFIED" || poi.qualityError) return refuse("La source signale une position imprécise ou un type de lieu incompatible.");
  const link = educationSiteLinks(candidate, links).find(item => poi.uaiIds?.includes(item.sourceRecordId));
  if (!link) return refuse("Aucun UAI du site n’est revalidé dans l’Annuaire.");
  if (poi.uaiIds.some(id => id !== link.sourceRecordId)) return { ...refuse("Le POI mélange plusieurs établissements UAI."), conflict: true };
  if (!registryPublicNameMatch(link.registryRecord.name, poi.name, "education", "", link.registryRecord.siteType)) {
    return { ...refuse("Le nom du POI contredit l’établissement scolaire revalidé."), conflict: true };
  }
  const address = addressEvidence(candidate.adresse, poi.adresse);
  // A different implantation of the same UAI is not the requested site.
  if (poi.adresse && address.conflict) return refuse("Autre implantation de cet établissement : adresse distincte.");
  const reference = link.registryRecord.discoveryPosition;
  const inside = reference?.precision === "Numéro de rue" && poi.shape
    && pointInsideSingleBuilding([reference.longitude, reference.latitude], poi.shape);
  const exactAddress = poi.adresse && address.complete && address.compatible;
  if (!inside && !exactAddress) return refuse("L’UAI seul ne distingue pas les implantations ; l’adresse officielle ne démontre pas cette emprise.");
  const coordinates = usableCoordinates(poi.latitude, poi.longitude);
  if (!coordinates || (poi.shape && !pointInsideSingleBuilding([poi.longitude, poi.latitude], poi.shape))) return refuse("Point extérieur à l’emprise du site.");
  return { observation: poi, accepted: true, coordinates, level: "SITE_CONFIRMED", proof: [
    { kind: "EXPLICIT_SITE_UAI", description: `UAI ${link.sourceRecordId} et SIRET ${candidate.siret} du site scolaire revalidés dans l’Annuaire`, source: poi.source, registryEvidence: link.registryRecord, officialBinding: link.officialBinding },
    { kind: inside ? "OFFICIAL_ADDRESS_INSIDE_SITE" : "EXACT_SITE_ADDRESS", description: inside
      ? "La référence officielle au numéro de rue se trouve strictement dans cette emprise UAI ; le point final est calculé à l’intérieur du site, sans utiliser le point d’adresse comme GPS final."
      : "Nom, type, UAI et adresse complète du POI concordants avec le site officiel", source: poi.source },
  ] };
}

export async function findIndexedEducationPositions({ candidate, links = [], identityStatus, signal, fetchImpl = globalThis.fetch, baseUrl = REGISTRY_POSITION_BASE } = {}) {
  const observations = []; const coverage = [];
  if (identityStatus !== "MATCH_VERIFIED") return { observations, coverage };
  const ids = [...new Set(educationSiteLinks(candidate, links).map(link => link.sourceRecordId))];
  if (!ids.length || ids.length > 2) return { observations, coverage };
  await Promise.all([...new Set(ids.map(id => id.slice(0, 6)))].map(async prefix => {
    const url = new URL(`${prefix}.json`, baseUrl);
    try {
      const response = await fetchImpl(url, { signal });
      if (response.status === 404) { coverage.push({ source: "osm-education", status: "not-indexed" }); return; }
      if (!response.ok) throw new Error(`OSM UAI HTTP ${response.status}`);
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > 96 * 1024) throw new Error("Index UAI hors budget.");
      const payload = JSON.parse(text);
      if (payload.schemaVersion !== 1 || payload.prefix !== prefix || payload.source?.id !== "osm-education-positions"
        || !Array.isArray(payload.records) || payload.recordCount !== payload.records.length
        || new Set(payload.records.map(record => `${record.type}:${record.id}`)).size !== payload.records.length) throw new Error("Index UAI invalide ou tronqué.");
      if (signal?.aborted) return;
      for (const element of payload.records) {
        const poi = educationPositionFromElement(element, { ...payload.source, indexUrl: String(url) });
        if (poi?.uaiIds.some(id => ids.includes(id))) observations.push(poi);
      }
      coverage.push({ source: "osm-education", status: "ok", generatedAt: payload.source.generatedAt });
    } catch (error) { if (!signal?.aborted) coverage.push({ source: "osm-education", status: "error", message: error.message }); }
  }));
  return { observations, coverage };
}
