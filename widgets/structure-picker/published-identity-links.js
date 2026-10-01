import { addressEvidence, normalizeIdentity, targetNameVariants } from "./identity-resolution.js";
import { normalizeIdentifier } from "./search.js";

export const PUBLISHED_IDENTITY_LINKS_URL = new URL("./identity-links/published.json", import.meta.url);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeRecord(record) {
  const siret = normalizeIdentifier(record?.siret);
  const publicNames = Array.isArray(record?.publicNames)
    ? [...new Set(record.publicNames.map(clean).filter(Boolean))]
    : [];
  if (siret.length !== 14 || !publicNames.length || !clean(record?.address)) return null;
  return Object.freeze({
    source: "published-identity",
    sourceLabel: clean(record.sourceLabel) || "Source publiée",
    sourceRecordId: clean(record.recordId) || siret,
    publicNames: Object.freeze(publicNames),
    legalName: clean(record.legalName),
    siret,
    adresse: clean(record.address),
    postcode: clean(record.postcode),
    city: clean(record.city),
    latitude: Number.isFinite(Number(record.latitude)) ? Number(record.latitude) : null,
    longitude: Number.isFinite(Number(record.longitude)) ? Number(record.longitude) : null,
    sourceUrl: clean(record.sourceUrl),
    sourcePublishedAt: clean(record.sourcePublishedAt),
    sourceKind: clean(record.sourceKind),
    sourceReference: clean(record.sourceReference),
    historical: Boolean(record.historical),
  });
}

function nameMatches(row, link) {
  const targets = new Set(targetNameVariants(row).map(normalizeIdentity));
  if (!targets.size) return false;
  return link.publicNames.some(name => targets.has(normalizeIdentity(name)));
}

export function matchPublishedIdentityLinks(records, row) {
  const matches = [];
  for (const raw of Array.isArray(records) ? records : []) {
    const link = normalizeRecord(raw);
    if (!link || !nameMatches(row, link)) continue;
    const address = addressEvidence(row?.Adresse, link.adresse);
    if (!address.compatible || address.conflict) continue;
    matches.push(link);
  }
  return matches.sort((a, b) => a.siret.localeCompare(b.siret) || a.sourceRecordId.localeCompare(b.sourceRecordId));
}

export async function findPublishedIdentityLinks({
  row,
  signal,
  fetchImpl = fetch,
  url = PUBLISHED_IDENTITY_LINKS_URL,
} = {}) {
  if (!row) return { source: "published-identity", candidates: [], complete: true };
  const response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`Références d’identité publiées indisponibles (HTTP ${response.status}).`);
  const payload = await response.json();
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload?.records)) {
    throw new Error("Format des références d’identité publiées invalide.");
  }
  return {
    source: "published-identity",
    candidates: matchPublishedIdentityLinks(payload.records, row),
    complete: true,
    generatedAt: clean(payload.generatedAt),
  };
}
