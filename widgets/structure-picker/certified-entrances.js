import { usableCoordinates } from "./identity-resolution.js";
import {
  sameNumberedSiteAddress,
  buildingShardPath,
} from "./address-building-positions.js";
import { validateNamedSite } from "./named-site-directory.js";
export function validateCertifiedEntrance(feature) {
  const p = feature?.properties;
  if (
    !p ||
    !/^\d{5}_[\w]+_\d{5}(?:_[\w]+)?$/.test(p.id ?? "") ||
    p.type_position !== "entrée" ||
    p.source_position !== "commune" ||
    String(p.certification_commune) !== "1"
  )
    return null;
  const parts = p.id.split("_"),
    rep = (value) =>
      ({ b: "bis", t: "ter" })[String(value ?? "").toLowerCase()] ||
      String(value ?? "").toLowerCase();
  if (
    Number(parts[2]) !== Number(p.numero) ||
    rep(parts[3]) !== rep(p.rep) ||
    parts[0] !== p.code_insee
  )
    return null;
  const coordinates = usableCoordinates(p.lat, p.lon),
    adresse = [p.numero, p.rep, p.nom_voie, p.code_postal, p.nom_commune]
      .filter(Boolean)
      .join(" ");
  if (!coordinates || !sameNumberedSiteAddress(adresse, adresse)) return null;
  return { adresse, ...coordinates };
}
export function certifiedEntrancePosition(
  candidate,
  features,
  { identityStatus, source } = {},
) {
  if (identityStatus !== "MATCH_VERIFIED") return null;
  const publicSite = candidate?.identityScope === "PUBLIC_SITE";
  if (
    publicSite
      ? !validateNamedSite(candidate.siteEvidence)
      : !/^\d{14}$/.test(candidate?.siret ?? "") ||
        candidate.etatAdministratif !== "A"
  )
    return null;
  const matches = features
    .map((record) => ({ record, point: validateCertifiedEntrance(record) }))
    .filter(
      (o) =>
        o.point && sameNumberedSiteAddress(candidate.adresse, o.point.adresse),
    );
  if (matches.length !== 1) return null;
  const { record, point } = matches[0];
  return {
    identityScope: publicSite ? "PUBLIC_SITE" : "ESTABLISHMENT",
    siteId: candidate.siteId ?? null,
    siret: candidate.siret ?? null,
    status: "SITE_CORROBORATED",
    latitude: point.latitude,
    longitude: point.longitude,
    source: {
      id: "ban-certified-entrance",
      label: "Entrée certifiée par la commune",
      recordId: record.properties.id,
      url: source.url,
      generatedAt: source.generatedAt,
      geometry: "certified-entrance",
      precision: "Entrée publiée ; exactitude métrique non documentée",
    },
    proof: [
      {
        kind: "CERTIFIED_SITE_ENTRANCE",
        source: {
          id: "ban-certified-entrance",
          label: "Entrée certifiée par la commune",
          recordId: record.properties.id,
          url: source.url,
          generatedAt: source.generatedAt,
        },
        record,
        siteRecord: publicSite ? candidate.siteEvidence : null,
        description:
          "Adresse physique confirmée et point d’entrée publié et certifié par la commune. Le point représente une entrée, sans annoncer une précision de toit.",
      },
    ],
    evidence: [],
    coverage: [],
    reason: "Entrée certifiée à l’adresse physique du lieu.",
  };
}
export function publicEntrancePositionValid(position) {
  const p = position?.proof?.find((p) => p.kind === "CERTIFIED_SITE_ENTRANCE");
  if (!p || !validateNamedSite(p.siteRecord)) return false;
  const point = validateCertifiedEntrance(p.record);
  return Boolean(
    point &&
      sameNumberedSiteAddress(p.siteRecord.adresse, point.adresse) &&
      position.identityScope === "PUBLIC_SITE" &&
      !position.siret &&
      position.status === "SITE_CORROBORATED" &&
      position.siteId ===
        p.siteRecord.url + "#" + encodeURIComponent(p.siteRecord.id) &&
      position.latitude === point.latitude &&
      position.longitude === point.longitude &&
      position.source?.id === "ban-certified-entrance" &&
      position.source.recordId === p.record.properties.id,
  );
}
export async function findCertifiedEntrance({
  candidate,
  identityStatus,
  signal,
  fetchImpl = fetch,
} = {}) {
  const path = buildingShardPath(candidate?.adresse);
  if (!path || identityStatus !== "MATCH_VERIFIED") return null;
  const response = await fetchImpl(
    new URL(
      "./site-position-indexes/certified-entrances/" + path,
      import.meta.url,
    ),
    { signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw Error("Entrées temporairement indisponibles");
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 96 * 1024)
    throw Error("Entrées hors budget");
  const p = JSON.parse(text);
  if (
    p.schemaVersion !== 1 ||
    p.path !== path ||
    p.complete !== true ||
    p.recordCount !== p.records?.length ||
    new Set(p.records.map((r) => r.properties?.id)).size !== p.records.length ||
    !Number.isFinite(Date.parse(p.source?.generatedAt)) ||
    !/^https:\/\/data.geopf.fr\/wfs\/ows\?/.test(p.source?.url ?? "")
  )
    return null;
  if (signal?.aborted) return null;
  return certifiedEntrancePosition(candidate, p.records, {
    identityStatus,
    source: p.source,
  });
}
