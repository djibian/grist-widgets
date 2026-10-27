import {
  addressEvidence,
  normalizeIdentity,
  usableCoordinates,
} from "./identity-resolution.js";
import { boundedSource } from "./bounded-source.js";
export const PUBLIC_SITE_BASE = new URL(
  "./identity-links/public-sites/",
  import.meta.url,
);
export function plainHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(rsquo|lsquo|apos|#039|#8217);/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function attributes(tag) {
  return Object.fromEntries(
    [...String(tag).matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map((x) => [
      x[1],
      plainHtml(x[3]),
    ]),
  );
}
export function parsePublisherPoint({ titleHtml, markerHtml, addressHtml }) {
  const marker = attributes(markerHtml),
    link = attributes(addressHtml);
  if (
    !marker.class?.split(/\s+/).includes("marker") ||
    normalizeIdentity(marker["data-title"]) !==
      normalizeIdentity(plainHtml(titleHtml))
  )
    return null;
  const point = usableCoordinates(marker["data-lat"], marker["data-lng"]);
  if (
    !point ||
    !/^https:\/\/www\.google\.(?:fr|com)\/maps\/search\//.test(link.href ?? "")
  )
    return null;
  return {
    ...point,
    name: plainHtml(titleHtml),
    address: plainHtml(addressHtml),
  };
}
export function validatePublicSite(record, publisher) {
  if (
    !record ||
    publisher?.kind !== "OFFICIAL_MUNICIPAL_DIRECTORY" ||
    !/^https:\/\/lannuaire\.service-public\.gouv\.fr\//.test(
      publisher.authorityUrl ?? "",
    ) ||
    !Number.isFinite(Date.parse(publisher.checkedAt)) ||
    !Number.isFinite(Date.parse(record.modifiedAt))
  )
    return null;
  try {
    if (new URL(record.url).origin !== new URL(publisher.url).origin)
      return null;
  } catch {
    return null;
  }
  const authority = publisher.authorityRecord;
  try {
    if (
      !authority ||
      !Number.isFinite(Date.parse(authority.date_modification_datetime)) ||
      !publisher.authorityUrl.endsWith("/" + authority.id) ||
      !JSON.parse(authority.site_internet).some(
        (site) => new URL(site.valeur).origin === new URL(publisher.url).origin,
      ) ||
      !JSON.parse(authority.pivot).some(
        (pivot) =>
          pivot.type_service_local === "mairie" &&
          (Array.isArray(pivot.code_insee_commune)
            ? pivot.code_insee_commune.includes(publisher.code)
            : pivot.code_insee_commune === publisher.code),
      )
    )
      return null;
  } catch {
    return null;
  }
  const native = parsePublisherPoint(record.native ?? {});
  if (
    !native ||
    normalizeIdentity(native.name) !== normalizeIdentity(record.name) ||
    native.latitude !== record.latitude ||
    native.longitude !== record.longitude ||
    !record.id
  )
    return null;
  if (
    normalizeIdentity(native.address) !==
    normalizeIdentity(record.publishedAddress)
  )
    return null;
  const ownAddress = addressEvidence(
    record.adresse,
    record.publishedAddress +
      ", " +
      publisher.postcode +
      " " +
      publisher.commune,
  );
  if (!ownAddress.compatible) return null;
  return native;
}
export function publicSiteCandidate(record, publisher, row) {
  if (
    !validatePublicSite(record, publisher) ||
    normalizeIdentity(record.name) !== normalizeIdentity(row.NomCommercial)
  )
    return null;
  const relation = addressEvidence(row.Adresse, record.adresse);
  if (
    !relation.compatible ||
    relation.commune !== "same" ||
    relation.postal === "conflict"
  )
    return null;
  const siteId = record.url;
  const source = {
    id: "official-public-site",
    label: publisher.label,
    recordId: String(record.id),
    url: record.url,
    updatedAt: record.modifiedAt,
    generatedAt: publisher.checkedAt,
    geometry: "publisher-site-point",
    precision: "Point de site publié ; exactitude métrique non documentée",
  };
  const publicSiteProof = {
    kind: "EXPLICIT_PUBLISHER_SITE_POINT",
    description:
      "Le nom propre et l’adresse du lieu concordent avec la fiche cartographique publiée par une collectivité dont le domaine est attesté par Service-Public. Aucun SIRET de siège n’est attribué au site.",
    source,
    record,
    publisher,
  };
  return {
    siteId,
    identityScope: "PUBLIC_SITE",
    siret: null,
    siren: null,
    raisonSociale: "",
    nomCommercial: record.name,
    nomUsuelDistinct: false,
    adresse: row.Adresse,
    sourceAddress: record.adresse,
    codePostal: publisher.postcode,
    commune: publisher.commune,
    codeCommune: publisher.code,
    identityStatus: "MATCH_VERIFIED",
    identityProof: [publicSiteProof.description],
    identityLinks: [],
    position: {
      status: "SITE_CONFIRMED",
      identityScope: "PUBLIC_SITE",
      siteId,
      siret: null,
      latitude: record.latitude,
      longitude: record.longitude,
      source,
      proof: [publicSiteProof],
      evidence: [],
      coverage: [],
      reason:
        "Point du site publié explicitement par la collectivité ; SIRET propre au site non établi.",
    },
    latitude: record.latitude,
    longitude: record.longitude,
  };
}
export function publicSiteWriteProofValid(position) {
  const proof = position?.proof?.find(
    (item) => item.kind === "EXPLICIT_PUBLISHER_SITE_POINT",
  );
  if (!proof) return false;
  const native = validatePublicSite(proof.record, proof.publisher);
  return Boolean(
    native &&
      position.status === "SITE_CONFIRMED" &&
      position.source?.id === "official-public-site" &&
      position.source.url === proof.record.url &&
      position.source.recordId === String(proof.record.id) &&
      position.source.updatedAt === proof.record.modifiedAt &&
      position.source.generatedAt === proof.publisher.checkedAt &&
      position.identityScope === "PUBLIC_SITE" &&
      position.siteId === proof.record.url &&
      !position.siret &&
      position.latitude === native.latitude &&
      position.longitude === native.longitude,
  );
}
export async function findOfficialPublicSites({
  row,
  signal,
  fetchImpl = globalThis.fetch,
  baseUrl = PUBLIC_SITE_BASE,
  onEvent,
} = {}) {
  return boundedSource(
    "public-sites:discovery",
    async (child) => {
      const read = async (url) => {
        const r = await fetchImpl(url, { signal: child });
        if (r.status === 404) return null;
        if (!r.ok) throw Error(`Annuaire public HTTP ${r.status}`);
        const t = await r.text();
        if (new TextEncoder().encode(t).length > 96 * 1024)
          throw Error("Index public hors budget");
        return JSON.parse(t);
      };
      const manifest = await read(new URL("manifest.json", baseUrl));
      if (!manifest) return { candidates: [] };
      if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.communes))
        throw Error("Manifest public invalide");
      const candidates = [];
      for (const town of manifest.communes) {
        if (!/^\d{5}$/.test(town.code))
          throw Error("Code commune public invalide");
        const r = addressEvidence(
          row.Adresse,
          `1 rue fictive ${town.postcode} ${town.name}`,
        );
        if (r.commune !== "same" || r.postal === "conflict") continue;
        const p = await read(new URL(`${town.code}.json`, baseUrl));
        if (!p) continue;
        if (
          p.schemaVersion !== 1 ||
          p.recordCount !== p.records?.length ||
          p.publisher?.code !== town.code
        )
          throw Error("Annuaire public incomplet");
        for (const record of p.records) {
          const c = publicSiteCandidate(record, p.publisher, row);
          if (c) candidates.push(c);
        }
      }
      return { candidates };
    },
    { signal, timeoutMs: 1500, onEvent },
  );
}
