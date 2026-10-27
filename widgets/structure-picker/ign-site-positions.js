import {
  addressEvidence,
  registryPublicNameMatch,
  usableCoordinates,
} from "./identity-resolution.js";
import {
  educationSiteLinks,
  interiorSitePoint,
} from "./registry-site-positions.js";
import { pointInsideSingleBuilding } from "./address-building-positions.js";
export const IGN_SITE_BASE = new URL(
  "./site-position-indexes/ign-education/",
  import.meta.url,
);
export function representativeSitePoint(geometry) {
  const rings =
    geometry?.type === "MultiPolygon" && geometry.coordinates.length === 1
      ? geometry.coordinates[0]
      : geometry?.type === "Polygon"
        ? geometry.coordinates
        : null;
  if (!rings || rings.length !== 1) return null;
  const shape = { type: "Polygon", coordinates: rings },
    ring = rings[0],
    origin = ring[0];
  let area = 0,
    x = 0,
    y = 0;
  if (!origin || ring.length > 2000) return null;
  for (let i = 1; i < ring.length; i++) {
    const a = [ring[i - 1][0] - origin[0], ring[i - 1][1] - origin[1]],
      b = [ring[i][0] - origin[0], ring[i][1] - origin[1]],
      cross = a[0] * b[1] - b[0] * a[1];
    area += cross;
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
  }
  const point = [origin[0] + x / (3 * area), origin[1] + y / (3 * area)];
  return pointInsideSingleBuilding(point, shape)
    ? { latitude: point[1], longitude: point[0] }
    : interiorSitePoint(shape);
}
export function ignSiteObservation(feature, source = {}) {
  const p = feature?.properties ?? {},
    ids = [
      ...String(p.identifiants_sources ?? "").matchAll(/\bMEN:(\d{7}[A-Z])\b/g),
    ].map((x) => x[1]);
  const coordinates = representativeSitePoint(feature?.geometry);
  if (!coordinates || !ids.length) return null;
  return {
    kind: "ign-site",
    name: p.toponyme,
    uaiIds: [...new Set(ids)],
    native: feature,
    ...coordinates,
    source: {
      id: "ign-bdtopo",
      label: "IGN — BD TOPO, emprise de site",
      recordId: p.cleabs,
      url: source.url,
      indexUrl: source.indexUrl,
      generatedAt: source.generatedAt,
      updatedAt: p.date_modification,
      version: p.date_de_confirmation,
      geometry: "site-interior-point",
      boundaryPrecisionMeters: p.precision_planimetrique,
      license: "Licence Ouverte 2.0",
    },
  };
}
export function assessIgnSite(
  candidate,
  poi,
  { links = [], identityStatus } = {},
) {
  const reject = (reason, conflict = false) => ({
    observation: poi,
    accepted: false,
    proof: [],
    reason,
    conflict,
  });
  const p = poi.native?.properties;
  if (
    identityStatus !== "MATCH_VERIFIED" ||
    !p ||
    p.fictif !== false ||
    p.etat_de_l_objet !== "En service" ||
    p.methode_d_acquisition_planimetrique !== "Orthophotographie"
  )
    return reject(
      "Emprise réelle en service et acquisition physique non démontrées.",
    );
  const link = educationSiteLinks(candidate, links).find((x) =>
    poi.uaiIds.includes(x.sourceRecordId),
  );
  if (!link)
    return reject("L’emprise IGN ne porte pas l’UAI revalidé de ce site.");
  if (poi.uaiIds.length !== 1)
    return reject(
      "Plusieurs établissements sont associés à la même emprise.",
      true,
    );
  const expected = link.registryRecord;
  const kind = /primaire|maternelle|élémentaire/i.test(p.nature)
    ? "Ecole"
    : /collège/i.test(p.nature)
      ? "Collège"
      : /lycée/i.test(p.nature)
        ? "Lycée"
        : "";
  if (!kind || kind !== expected.siteType)
    return reject("Le type IGN contredit le type du site scolaire.", true);
  if (
    !registryPublicNameMatch(expected.name, p.toponyme, "education", "", kind)
  )
    return reject("Le toponyme IGN contredit le nom public du site.", true);
  if (p.insee_commune !== candidate.codeCommune)
    return reject("Autre commune dans la preuve IGN.", true);
  const relation = addressEvidence(
    candidate.adresse,
    `${p.adresse_postale ?? ""} ${candidate.codePostal} ${p.commune ?? ""}`,
  );
  if (
    !relation.compatible ||
    relation.commune !== "same" ||
    relation.number === "conflict"
  )
    return reject("Adresse IGN incompatible avec le site revalidé.", true);
  const coords = representativeSitePoint(poi.native.geometry);
  if (
    !coords ||
    coords.latitude !== poi.latitude ||
    coords.longitude !== poi.longitude ||
    !usableCoordinates(poi.latitude, poi.longitude)
  )
    return reject("Point non démontré à l’intérieur de l’emprise.", true);
  return {
    observation: poi,
    accepted: true,
    coordinates: coords,
    level: "SITE_CONFIRMED",
    proof: [
      {
        kind: "EXPLICIT_IGN_UAI_FOOTPRINT",
        description: `Emprise réelle IGN ${p.cleabs} : UAI ${link.sourceRecordId}, type scolaire, nom, commune et adresse concordants ; point strictement intérieur au site, sans utiliser un géocodage de rue.`,
        source: poi.source,
        feature: poi.native,
        officialBinding: link.officialBinding,
        registryEvidence: expected,
      },
    ],
  };
}
export async function findIndexedIgnSites({
  candidate,
  links = [],
  identityStatus,
  signal,
  fetchImpl = globalThis.fetch,
  baseUrl = IGN_SITE_BASE,
} = {}) {
  const observations = [],
    coverage = [];
  if (identityStatus !== "MATCH_VERIFIED") return { observations, coverage };
  const ids = educationSiteLinks(candidate, links).map((x) => x.sourceRecordId);
  if (
    !ids.length ||
    ids.length > 2 ||
    !/^\d{5}$/.test(candidate.codeCommune ?? "")
  )
    return { observations, coverage };
  await Promise.all(
    [...new Set(ids.map((id) => id.slice(0, 6)))].map(async (prefix) => {
      const url = new URL(`${candidate.codeCommune}/${prefix}.json`, baseUrl);
      try {
        const r = await fetchImpl(url, { signal });
        if (r.status === 404) {
          coverage.push({ source: "ign-sites", status: "not-indexed" });
          return;
        }
        if (!r.ok) throw Error(`IGN index HTTP ${r.status}`);
        const text = await r.text();
        if (new TextEncoder().encode(text).length > 96 * 1024)
          throw Error("Index IGN hors budget");
        const p = JSON.parse(text);
        if (
          p.schemaVersion !== 1 ||
          p.prefix !== prefix ||
          p.source?.cohort?.commune !== candidate.codeCommune ||
          p.recordCount !== p.records?.length
        )
          throw Error("Index IGN invalide ou incomplet");
        if (signal?.aborted) return;
        for (const feature of p.records) {
          const poi = ignSiteObservation(feature, {
            ...p.source,
            indexUrl: String(url),
          });
          if (poi?.uaiIds.some((id) => ids.includes(id)))
            observations.push(poi);
        }
        coverage.push({
          source: "ign-sites",
          status: "ok",
          generatedAt: p.source.generatedAt,
        });
      } catch (e) {
        if (!signal?.aborted)
          coverage.push({
            source: "ign-sites",
            status: "error",
            message: e.message,
          });
      }
    }),
  );
  return { observations, coverage };
}
