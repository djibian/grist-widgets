import { addressEvidence, parseSiteAddress, usableCoordinates } from "./identity-resolution.js";

export const ADDRESS_BUILDING_INDEX_BASE = new URL("./site-position-indexes/address-buildings/", import.meta.url);
export const ADDRESS_BUILDING_BUDGET = Object.freeze({ maxShardBytes: 96 * 1024 });
const repetition = value => ({ b: "bis", t: "ter" })[value] || value;
const street = address => [...new Set(address.streetTokens)].sort().join(" ");

export function sameNumberedSiteAddress(left, right) {
  const a = parseSiteAddress(left);
  const b = parseSiteAddress(right);
  const relation = addressEvidence(left, right);
  return Boolean(/^\d{1,5}$/.test(a.number) && a.number === b.number
    && repetition(a.repetition) === repetition(b.repetition)
    && relation.postal === "same" && relation.commune === "same"
    && a.streetTokens.length && street(a) === street(b) && !relation.conflict);
}

export function buildingShardPath(address) {
  const parsed = parseSiteAddress(address);
  return /^\d{5}$/.test(parsed.codePostal) && /^\d{1,5}$/.test(parsed.number)
    ? `${parsed.codePostal}/${parsed.number}.json` : null;
}

function ringRelation(point, ring) {
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 10000
    || ring.some(vertex => !Array.isArray(vertex) || vertex.length !== 2 || !usableCoordinates(vertex[1], vertex[0]))
    || ring[0].some((value, index) => value !== ring.at(-1)[index])) return "invalid";
  const [x, y] = point;
  let inside = false;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [a, b] = ring[i];
    const [c, d] = ring[i + 1];
    area += a * d - c * b;
    // Boundary points do not establish that the published point is on a roof.
    if (Math.abs((x - a) * (d - b) - (y - b) * (c - a)) < 1e-15
      && x >= Math.min(a, c) && x <= Math.max(a, c) && y >= Math.min(b, d) && y <= Math.max(b, d)) return "boundary";
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return Math.abs(area) < 1e-14 ? "invalid" : inside ? "inside" : "outside";
}

export function pointInsideSingleBuilding(point, shape) {
  if (!Array.isArray(point) || point.length !== 2 || !usableCoordinates(point[1], point[0])) return false;
  const polygons = shape?.type === "Polygon" ? [shape.coordinates] : shape?.type === "MultiPolygon" ? shape.coordinates : [];
  if (!Array.isArray(polygons) || polygons.length !== 1 || !Array.isArray(polygons[0]) || !polygons[0].length) return false;
  return ringRelation(point, polygons[0][0]) === "inside" && polygons[0].slice(1).every(ring => ringRelation(point, ring) === "outside");
}

function banAddress(properties) {
  return [properties.numero, properties.rep, properties.nom_voie, properties.code_postal, properties.nom_commune].filter(Boolean).join(" ");
}

// A high BDNB score alone is not an identity or uniqueness decision. The
// complete address relation, principal address, single construction, explicit
// RNB reference, active status and both points inside its footprint are required.
export function validateAddressBuildingRecord(record) {
  const ban = record?.ban?.properties;
  const group = record?.group;
  const construction = record?.constructions?.[0];
  const relation = record?.relations?.[0];
  const rnb = record?.rnb;
  const refuse = reason => ({ accepted: false, reason });
  if (!ban || !/^\d{5}_[A-Za-z0-9]+_\d{5}(?:_[A-Za-z]+)?$/.test(ban.id || "")
    || !["entrée", "bâtiment"].includes(ban.type_position)
    || String(ban.certification_commune) !== "1" || ban.source_position !== "commune") return refuse("Adresse BAN non certifiée ou précision d’adresse insuffisante.");
  const adresse = banAddress(ban);
  if (!sameNumberedSiteAddress(adresse, adresse)) return refuse("Adresse complète de site requise.");
  if (record.relations?.length !== 1 || !relation || relation.cle_interop_adr !== ban.id
    || !Number.isInteger(relation.fiabilite) || relation.fiabilite < 17 || relation.fiabilite > 20) return refuse("Lien adresse–bâtiment absent, ambigu ou insuffisamment étayé.");
  if (!group?.batiment_groupe_id || relation.batiment_groupe_id !== group.batiment_groupe_id
    || group.cle_interop_adr_principale_ban !== ban.id
    || !sameNumberedSiteAddress(adresse, group.libelle_adr_principale_ban)
    || !sameNumberedSiteAddress(adresse, relation.libelle_adresse)
    || group.contient_fictive_geom_groupe !== false || group.fiabilite_emprise_sol !== "BONNE"
    || group.fiabilite_cr_adr_niv_1 !== "données croisées à l'adresse fiables") return refuse("Le bâtiment principal ou la fiabilité foncière contredit l’adresse BAN.");
  if (record.constructions?.length !== 1 || !construction?.batiment_construction_id
    || construction.batiment_groupe_id !== group.batiment_groupe_id || construction.fictive_geom_cstr !== false
    || !/^[A-Z0-9]{12}$/.test(construction.rnb_id || "") || construction.rnb_id !== rnb?.rnb_id) return refuse("Construction ou identifiant RNB non unique ou contradictoire.");
  if (rnb.is_active !== true || rnb.status !== "constructed"
    || (rnb.addresses?.length && !rnb.addresses.some(address => address.id === ban.id))) return refuse("Le RNB est inactif, non construit ou contredit l’adresse du site.");
  const point = rnb.point?.type === "Point" ? rnb.point.coordinates : null;
  const bdnbPoint = group.geom_groupe_pos_wgs84?.type === "Point" ? group.geom_groupe_pos_wgs84.coordinates : null;
  if (!pointInsideSingleBuilding(point, rnb.shape) || !pointInsideSingleBuilding(bdnbPoint, rnb.shape)) return refuse("Les points ne sont pas démontrés à l’intérieur d’une même emprise réelle de bâtiment.");
  return { accepted: true, adresse, coordinates: { latitude: point[1], longitude: point[0] } };
}

export function assessAddressBuildingPosition(candidate, observation, { identityStatus, requestedAddress = "" } = {}) {
  const assessment = { observation, accepted: false, proof: [], reason: "" };
  const checked = validateAddressBuildingRecord(observation.record);
  if (!checked.accepted) return { ...assessment, reason: checked.reason };
  if (identityStatus !== "MATCH_VERIFIED" || !/^\d{14}$/.test(candidate.siret)) return { ...assessment, reason: "Identité confirmée requise avant tout rattachement de bâtiment." };
  if (!sameNumberedSiteAddress(candidate.adresse, checked.adresse)
    || (requestedAddress && !sameNumberedSiteAddress(requestedAddress, checked.adresse))) {
    return { ...assessment, reason: "Le numéro, suffixe, voie ou commune ne correspond pas exactement au site confirmé." };
  }
  const source = observation.source;
  const record = observation.record;
  return { ...assessment, accepted: true, coordinates: checked.coordinates, level: "SITE_CORROBORATED", proof: [
    { kind: "OFFICIAL_SITE_ADDRESS", description: `Adresse complète du SIRET ${candidate.siret} confirmé, numéro et suffixe inclus`,
      source: { id: "annuaire", label: "Annuaire des Entreprises", recordId: candidate.siret, url: `https://annuaire-entreprises.data.gouv.fr/etablissement/${candidate.siret}` } },
    { kind: "CERTIFIED_BAN_ADDRESS", description: `Adresse BAN ${record.ban.properties.id} certifiée par la commune ; son point d’entrée sert de référence, pas de position finale`, source: source.ban },
    { kind: "UNIQUE_OFFICIAL_BUILDING", description: `Bâtiment principal BDNB ${record.group.batiment_groupe_id}, liaison foncière unique ${record.relations[0].fiabilite}/20 et construction unique ${record.constructions[0].batiment_construction_id}`,
      source: source.bdnb, addressId: record.ban.properties.id, relation: record.relations[0], group: record.group, construction: record.constructions[0] },
    { kind: "RNB_BUILDING_FOOTPRINT", description: `Point publié du bâtiment RNB actif ${record.rnb.rnb_id}, à l’intérieur de son emprise ; aucune sélection par distance`,
      source, building: record.rnb },
  ] };
}

export async function findIndexedAddressBuildings({ candidate, identityStatus, signal, fetchImpl = globalThis.fetch, baseUrl = ADDRESS_BUILDING_INDEX_BASE } = {}) {
  const path = buildingShardPath(candidate.adresse);
  if (identityStatus !== "MATCH_VERIFIED" || !path || signal?.aborted) return { observations: [], coverage: [] };
  const url = new URL(path, baseUrl);
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal });
    if (response.status === 404) return { observations: [], coverage: [{ source: "address-buildings", status: "not-indexed" }] };
    if (!response.ok) throw new Error(`Index adresse–bâtiment indisponible (HTTP ${response.status}).`);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > ADDRESS_BUILDING_BUDGET.maxShardBytes) throw new Error("Index adresse–bâtiment trop volumineux.");
    const payload = JSON.parse(text);
    if (payload.schemaVersion !== 1 || payload.path !== path || payload.source?.id !== "bdnb-rnb"
      || payload.complete !== true || !payload.source.version || !Number.isFinite(Date.parse(payload.source.generatedAt))
      || !Array.isArray(payload.records) || payload.recordCount !== payload.records.length
      || new Set(payload.records.map(record => record.ban?.properties?.id)).size !== payload.records.length) throw new Error("Index adresse–bâtiment incomplet ou invalide.");
    if (signal?.aborted) return { observations: [], coverage: [] };
    const observations = [];
    for (const record of payload.records) {
      const checked = validateAddressBuildingRecord(record);
      if (!checked.accepted || !sameNumberedSiteAddress(candidate.adresse, checked.adresse)) continue;
      const banUrl = new URL("https://data.geopf.fr/wfs/ows");
      banUrl.search = new URLSearchParams({ SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAME: "BAN.DATA.GOUV:ban",
        outputFormat: "application/json", CQL_FILTER: `id='${record.ban.properties.id}'` });
      const bdnbUrl = new URL("https://api.bdnb.io/v1/bdnb/donnees/rel_batiment_groupe_adresse");
      bdnbUrl.searchParams.set("cle_interop_adr", `eq.${record.ban.properties.id}`);
      const source = {
        id: "bdnb-rnb", label: "BDNB / Référentiel national des bâtiments", recordId: record.rnb.rnb_id,
        url: `https://rnb-api.beta.gouv.fr/api/alpha/buildings/${record.rnb.rnb_id}/`,
        version: payload.source.version, generatedAt: payload.source.generatedAt,
        geometry: "building-point", indexUrl: String(url), license: "Licence Ouverte 2.0",
        ban: { id: "ban", label: "BAN / IGN — adresse certifiée", recordId: record.ban.properties.id, url: String(banUrl), generatedAt: payload.source.generatedAt },
        bdnb: { id: "bdnb", label: "BDNB — relation foncière adresse/bâtiment", recordId: record.group.batiment_groupe_id, url: String(bdnbUrl),
          version: payload.source.version, generatedAt: payload.source.generatedAt },
      };
      observations.push({ kind: "building", adresse: checked.adresse, ...checked.coordinates, record, source });
    }
    return { observations, coverage: [{ source: "address-buildings", status: "ok", generatedAt: payload.source.generatedAt }] };
  } catch (error) {
    return { observations: [], coverage: signal?.aborted ? [] : [{ source: "address-buildings", status: "error", message: error.message }] };
  }
}
