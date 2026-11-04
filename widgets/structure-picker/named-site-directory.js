import {
  addressEvidence,
  normalizeIdentity,
  usableCoordinates,
  publishedAccessBinding,
} from "./identity-resolution.js";
import { siteContextEvidence } from "./site-context.js";
export const NAMED_SITE_DIRECTORY_URL = new URL(
  "./identity-links/site-directory/records.json",
  import.meta.url,
);
const evidenceText = (value) =>
  normalizeIdentity(
    String(value)
      .replace(/<[^>]*>/g, " ")
      .replace(/&(?:rsquo|lsquo|apos|#039);/g, "'")
      .replace(/&gt;/g, ">"),
  ).replace(/\bbd\b/g, "boulevard");
export function validateNamedSite(record) {
  if (
    !record ||
    !record.name ||
    !record.adresse ||
    !/^https:\/\//.test(record.url ?? "") ||
    !Number.isFinite(Date.parse(record.checkedAt)) ||
    !/^[a-f0-9]{64}$/.test(record.sourceSha256 ?? "") ||
    !["public-authority", "operator"].includes(record.publisherKind) ||
    !record.native?.fields
  )
    return false;
  for (const key of ["name", "adresse"]) {
    const evidence = record.native.fields[key];
    if (
      !evidence ||
      normalizeIdentity(evidence.value) !== normalizeIdentity(record[key]) ||
      !evidence.excerpts?.length
    )
      return false;
    const tokens = new Set(
      evidenceText(evidence.excerpts.join(" ")).split(" "),
    );
    if (
      normalizeIdentity(record[key])
        .split(" ")
        .some((t) => !tokens.has(t))
    )
      return false;
  }
  // The checked-in directory is reviewed source data, not an identity inferred
  // from a typed URL. A timestamp and page digest identify the captured version.
  return true;
}
export function namedSitePoint(record) {
  const point = record?.point;
  if (
    point?.kind !== "operator-site-point" ||
    record.publisherKind !== "operator"
  )
    return null;
  const html = point.nativeHtml ?? "";
  const lat = html.match(/data-lat="([\d.-]+)"/),
    lng = html.match(/data-lng="([\d.-]+)"/);
  if (
    !/<section\b/.test(html) ||
    !/section_quartier-block/.test(html) ||
    !/data-res="\d+"/.test(html) ||
    !lat ||
    !lng ||
    Number(lat[1]) !== point.latitude ||
    Number(lng[1]) !== point.longitude
  )
    return null;
  return usableCoordinates(point.latitude, point.longitude);
}
export function namedSiteCandidate(record, row, { suggestion = false } = {}) {
  if (!validateNamedSite(record)) return null;
  const context = siteContextEvidence(row, record);
  if (!context.matched && !suggestion) return null;
  const point = record.point;
  const route = String(point?.nativeUrl ?? "").match(
    /^https:\/\/www\.openstreetmap\.org\/directions\?[^#]*route=([\d.-]+)%2C([\d.-]+)/,
  );
  const coords =
    !suggestion &&
    (namedSitePoint(record) ||
      (point?.kind === "publisher-site-point" &&
        route &&
        Number(route[1]) === point.latitude &&
        Number(route[2]) === point.longitude &&
        usableCoordinates(point.latitude, point.longitude)));
  const proof = {
    kind: "REVIEWED_NAMED_SITE",
    record,
    description: suggestion
      ? "Nom approchant et commune suggérée par le contact ; adresse différente à confirmer."
      : "Nom public et adresse du lieu concordants avec une fiche publiée et conservée.",
    source: {
      id: "named-site-directory",
      label: record.publisherLabel,
      recordId: record.id,
      url: record.url,
      generatedAt: record.checkedAt,
      version: record.sourceSha256,
      geometry: coords ? "publisher-site-point" : null,
    },
  };
  return {
    identityScope: "PUBLIC_SITE",
    siteId: record.url + "#" + encodeURIComponent(record.id),
    siret: null,
    siren: null,
    raisonSociale: "",
    nomCommercial: record.name,
    nomUsuelDistinct: true,
    adresse: record.adresse,
    codePostal: record.postcode,
    commune: record.commune,
    identityStatus: suggestion ? "MATCH_PROBABLE" : "MATCH_VERIFIED",
    addressCorrectionSuggestion: suggestion,
    identityProof: [proof.description],
    identityLinks: [],
    siteEvidence: record,
    telephone: record.contacts?.phones?.[0] ?? "",
    courriel: record.contacts?.emails?.[0] ?? "",
    siteWeb: record.contacts?.websites?.[0] ?? "",
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    position: {
      status: coords ? "SITE_CONFIRMED" : "UNRESOLVED",
      identityScope: "PUBLIC_SITE",
      siteId: record.url + "#" + encodeURIComponent(record.id),
      siret: null,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      source: proof.source,
      proof: [proof],
      evidence: [],
      coverage: [],
      reason: coords
        ? "Point du lieu publié ; précision métrique non documentée."
        : "Adresse confirmée ; position précise du lieu non démontrée.",
    },
  };
}
export function namedSitePositionValid(position) {
  const p = position?.proof?.find((p) => p.kind === "REVIEWED_NAMED_SITE");
  if (!p || !validateNamedSite(p.record)) return false;
  const c = namedSiteCandidate(p.record, {
    NomCommercial: p.record.name,
    Adresse: p.record.adresse,
  });
  return Boolean(
    c?.latitude != null &&
      position.identityScope === "PUBLIC_SITE" &&
      !position.siret &&
      position.siteId === c.siteId &&
      position.status === c.position.status &&
      position.latitude === c.latitude &&
      position.longitude === c.longitude &&
      position.source?.url === p.record.url &&
      position.source?.version === p.record.sourceSha256,
  );
}
export async function readNamedSites({
  signal,
  fetchImpl = globalThis.fetch,
  url = NAMED_SITE_DIRECTORY_URL,
} = {}) {
  const r = await fetchImpl(url, { signal, cache: "no-cache" });
  if (r.status === 404) return [];
  if (!r.ok) throw Error(`Annuaire de lieux HTTP ${r.status}`);
  const text = await r.text();
  if (new TextEncoder().encode(text).length > 256 * 1024)
    throw Error("Annuaire de lieux hors budget.");
  const p = JSON.parse(text);
  if (
    p.schemaVersion !== 1 ||
    !Array.isArray(p.records) ||
    p.records.length !== p.recordCount
  )
    throw Error("Annuaire de lieux incomplet.");
  return p.records.filter(validateNamedSite);
}
export function namedSiteIdentityLinks(
  records,
  candidates,
  row,
  knownLinks = [],
) {
  const links = [];
  for (const record of records) {
    if (!validateNamedSite(record)) continue;
    for (const c of candidates) {
      const accessBinding = publishedAccessBinding(record, c);
      if (
        !siteContextEvidence(row, record).matched &&
        !(
          accessBinding &&
          siteContextEvidence(row, {
            ...record,
            adresse: record.registeredAddress,
          }).matched
        )
      )
        continue;
      const a = addressEvidence(
        c.adresse,
        accessBinding ? record.registeredAddress : record.adresse,
      );
      const name =
        siteContextEvidence(
          {
            NomCommercial: c.nomUsuelDistinct
              ? c.nomCommercial
              : c.raisonSociale,
            Adresse: c.adresse,
          },
          record,
        ).name ||
        knownLinks.some(
          (link) =>
            link.siret === c.siret &&
            link.verifiedOfficial &&
            link.registryRecord &&
            (
              link.registryRecord.publicNames ?? [link.registryRecord.name]
            ).some(
              (name) =>
                siteContextEvidence(
                  { NomCommercial: name, Adresse: c.adresse },
                  record,
                ).matched,
            ),
        );
      if (
        c.etatAdministratif !== "A" ||
        !a.compatible ||
        a.postal !== "same" ||
        a.commune !== "same" ||
        !(
          name ||
          (record.siret === c.siret &&
            record.native.fields.siret &&
            record.registration?.legalName === c.raisonSociale)
        )
      )
        continue;
      // Exact public name + the full official site address, or an explicit SIRET
      // in the captured publisher page. The manager's SIRET is never inherited.
      if (
        !(
          a.complete ||
          (record.siret === c.siret && record.native.fields.siret)
        )
      )
        continue;
      links.push({
        source: "named-site-directory",
        sourceLabel: record.publisherLabel,
        sourceRecordId: record.id,
        sourceUrl: record.url,
        sourcePublishedAt: record.checkedAt,
        publicNames: [record.name],
        adresse: accessBinding ? record.registeredAddress : record.adresse,
        accessBinding,
        siret: c.siret,
        verifiedOfficial: true,
        siteRecord: record,
      });
    }
  }
  return links;
}

// A municipal email is only a discovery hint. It can produce an unchecked
// address-correction suggestion, never a verified school or a GPS write.
export function namedSiteAddressSuggestions(records, row) {
  const domain = String(row.Courriel ?? "")
    .split("@")[1]
    ?.toLowerCase();
  if (!domain) return [];
  const stem = domain.split(".")[0].replace(/-/g, "");
  return records
    .filter(
      (record) =>
        validateNamedSite(record) &&
        record.publisherKind === "public-authority" &&
        normalizeIdentity(record.commune)
          .replace(/[^a-z]/g, "")
          .includes(stem) &&
        stem.length >= 5 &&
        siteContextEvidence(row, record).name &&
        siteContextEvidence(row, record).address.conflict,
    )
    .map((record) => namedSiteCandidate(record, row, { suggestion: true }));
}

export async function findNamedSitePositions({
  candidate,
  links = [],
  identityStatus,
  signal,
  fetchImpl,
} = {}) {
  if (identityStatus !== "MATCH_VERIFIED")
    return { observations: [], coverage: [] };
  const records = await readNamedSites({ signal, fetchImpl });
  const acceptedLinks = namedSiteIdentityLinks(
    records,
    [candidate],
    {
      NomCommercial: candidate.nomCommercial || candidate.raisonSociale,
      Adresse: candidate.adresse,
    },
    links,
  );
  const observations = [];
  for (const link of acceptedLinks) {
    const c = namedSiteCandidate(link.siteRecord, {
      NomCommercial: link.siteRecord.name,
      Adresse: candidate.adresse,
    });
    if (c?.latitude == null) continue;
    observations.push({
      kind: "site",
      name: link.siteRecord.name,
      adresse: link.adresse,
      latitude: c.latitude,
      longitude: c.longitude,
      source: c.position.source,
    });
  }
  return {
    observations,
    coverage: [{ source: "named-site-directory", status: "ok" }],
  };
}
