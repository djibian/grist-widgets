import { normalizeFiness, normalizeIdentifier } from "./search.js";
import { addressEvidence, usableCoordinates } from "./identity-resolution.js";

export const OSM_POSITION_INDEX_BASE = new URL("./site-position-indexes/osm-finess/", import.meta.url);
export const OSM_POSITION_INDEX_BUDGET = Object.freeze({ maxFinessIds: 2, maxShardBytes: 96 * 1024 });
const clean = value => String(value ?? "").trim();

export function osmSitePositionFromElement(element, snapshot = {}) {
  const tags = element?.tags ?? {};
  const coordinates = usableCoordinates(element?.lat ?? element?.center?.lat, element?.lon ?? element?.center?.lon);
  if (!coordinates || !["node", "way", "relation"].includes(element?.type)) return null;
  const rawSiret = clean(tags["ref:FR:SIRET"]);
  const siret = normalizeIdentifier(rawSiret);
  const rawFiness = clean(tags["ref:FR:FINESS"]);
  const finessParts = rawFiness ? rawFiness.split(/[;,]/).map(clean) : [];
  const finessIds = [...new Set(finessParts.map(normalizeFiness).filter(Boolean))];
  const isPlace = !tags.highway && !tags.place && !Object.keys(tags).some(key => /^(disused|abandoned|demolished):/.test(key))
    && Boolean(tags.amenity || tags.healthcare || tags.social_facility || tags.shop || tags.building);
  return {
    kind: isPlace ? "site" : "address", name: clean(tags.name || tags["name:fr"]),
    siret: siret.length === 14 ? siret : "", finessIds,
    identifierError: Boolean(rawSiret && !/^\d{14}$/.test(rawSiret)) || finessParts.some(id => !normalizeFiness(id)),
    finessCategory: clean(tags["type:FR:FINESS"]),
    siteType: { amenity: clean(tags.amenity), healthcare: clean(tags.healthcare), socialFacility: clean(tags.social_facility) },
    adresse: [tags["addr:housenumber"], tags["addr:street"], tags["addr:place"], tags["addr:postcode"], tags["addr:city"]].map(clean).filter(Boolean).join(" "),
    ...coordinates,
    source: {
      id: "osm", label: "OpenStreetMap", recordId: `${element.type}:${element.id}`,
      url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      geometry: element.type === "node" ? "point" : "center", version: element.version ?? null,
      updatedAt: element.timestamp ?? null, changeset: element.changeset ?? null,
      generatedAt: snapshot.generatedAt ?? null, indexUrl: snapshot.indexUrl ?? null,
      snapshotUrl: snapshot.url ?? null, license: snapshot.license ?? "ODbL 1.0", tags,
    },
  };
}

export function verifiedGeographicFiness(candidate, links = []) {
  return links.filter(link => {
    const relation = addressEvidence(candidate.adresse, link.adresse);
    return link.source === "finess" && link.verifiedOfficial && /^\d{14}$/.test(candidate.siret)
    && normalizeFiness(link.sourceRecordId) === link.sourceRecordId
    && link.siret === candidate.siret && link.registryEvidence?.siret === candidate.siret
    && link.registryEvidence?.type === "EGE" && link.registryEvidence?.status === "A"
    && link.registryEvidence?.finess === link.sourceRecordId
    && /^\d{3}$/.test(link.registryEvidence.categoryCode || "") && link.publicNames?.length
    && candidate.finessIds?.includes(link.sourceRecordId)
    && link.officialBinding?.siret === candidate.siret
    && link.officialBinding?.finessIds?.includes(link.sourceRecordId)
    && relation.compatible && relation.postal === "same" && relation.commune === "same";
  });
}

export async function findIndexedFinessPositions({ candidate, links = [], identityStatus, signal,
  fetchImpl = globalThis.fetch, baseUrl = OSM_POSITION_INDEX_BASE } = {}) {
  if (identityStatus !== "MATCH_VERIFIED") return { observations: [], coverage: [] };
  if (signal?.aborted) return { observations: [], coverage: [] };
  const ids = [...new Set(verifiedGeographicFiness(candidate, links).map(link => link.sourceRecordId))];
  if (!ids.length) return { observations: [], coverage: [] };
  if (ids.length > OSM_POSITION_INDEX_BUDGET.maxFinessIds) return { observations: [], coverage: [{ source: "osm-finess", status: "not-indexed" }] };
  const observations = [];
  const coverage = [];
  await Promise.all([...new Set(ids.map(id => id.slice(0, 6)))].map(async prefix => {
    const url = new URL(`${prefix}.json`, baseUrl);
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal });
      if (response.status === 404) { coverage.push({ source: "osm-finess", status: "not-indexed" }); return; }
      if (!response.ok) throw new Error(`Index OSM FINESS indisponible (HTTP ${response.status}).`);
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > OSM_POSITION_INDEX_BUDGET.maxShardBytes) throw new Error("Index OSM FINESS trop volumineux.");
      const payload = JSON.parse(text);
      if (payload.schemaVersion !== 1 || payload.prefix !== prefix || payload.source?.id !== "osm-finess-positions"
        || !Number.isFinite(Date.parse(payload.source.generatedAt)) || !/^https:\/\//.test(payload.source.url || "") || !Array.isArray(payload.records)
        || payload.recordCount !== payload.records.length || new Set(payload.records.map(item => item.id)).size !== payload.records.length) {
        throw new Error("Index OSM FINESS invalide ou incomplet.");
      }
      if (signal?.aborted) return;
      for (const record of payload.records) {
        const poi = osmSitePositionFromElement(record, { ...payload.source, indexUrl: String(url) });
        // Only point POIs from the published identifier cohort; neither a
        // street geocode nor a way's bounding-box centre is promoted here.
        if (record.type === "node" && Number.isSafeInteger(record.id) && record.id > 0
          && Number.isSafeInteger(record.version) && record.version > 0 && Number.isFinite(Date.parse(record.timestamp))
          && Date.parse(record.timestamp) <= Date.parse(payload.source.generatedAt)
          && poi?.kind === "site" && poi.finessIds.some(id => id.startsWith(prefix))
          && (poi.siret === candidate.siret || poi.finessIds.some(id => ids.includes(id)))) observations.push(poi);
      }
      coverage.push({ source: "osm-finess", status: "ok", generatedAt: payload.source.generatedAt });
    } catch (error) {
      if (!signal?.aborted) coverage.push({ source: "osm-finess", status: "error", message: error.message });
    }
  }));
  return { observations, coverage };
}
