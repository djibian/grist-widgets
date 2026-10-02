import { addressEvidence, normalizeIdentity, targetNameVariants } from "./identity-resolution.js";
import { normalizeFiness, normalizeIdentifier } from "./search.js";

export const FINESS_INDEX_BASE = new URL("./identity-links/finess/", import.meta.url);
export const FINESS_SHARD_PREFIX_LENGTH = 6;
export const FINESS_BUDGET = Object.freeze({ maxCandidates: 2, maxIdsPerCandidate: 2, deadlineMs: 8000, maxShardBytes: 96 * 1024 });
const clean = value => String(value ?? "").trim();
const streetTypes = { R: "RUE", AV: "AVENUE", BD: "BOULEVARD", ALL: "ALLEE", CHE: "CHEMIN", IMP: "IMPASSE", PL: "PLACE", RTE: "ROUTE" };
// Official FINESS categories, not an inference from the operator's name:
// https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000045697069
const categoryCodes = Object.freeze({ ehpad: "500", ssiad: "354" });

export function buildFinessLookupUrl(finess, siret, baseUrl = FINESS_INDEX_BASE) {
  const id = normalizeFiness(finess);
  if (!id || normalizeIdentifier(siret).length !== 14) return null;
  return new URL(`${id.slice(0, FINESS_SHARD_PREFIX_LENGTH)}.json`, baseUrl);
}

function registryAddress(address) {
  const street = String(address.ligneQuatre ?? "").trim() || [address.numeroVoie, address.complementVoie,
    streetTypes[clean(address.typeVoie)] || address.typeVoie, address.libelleVoie].map(clean).filter(Boolean).join(" ");
  const city = clean(address.ligneAcheminement).replace(/^\d{5}\s+/, "");
  return [street, address.codePostal, city].map(clean).filter(Boolean).join(" ");
}

export function finessIdentityLink(record, candidate, row, source, indexUrl = "") {
  const info = record?.informationsGeneralesEGE;
  const finess = normalizeFiness(info?.numFinessEge);
  const siret = clean(info?.siret);
  if (!finess || record?.etatObjet !== "A" || info?.dateFermeture || !/^\d{14}$/.test(siret)
    || siret !== candidate.siret || !candidate.finessIds?.includes(finess)) return null;
  if (!/^\d+$/.test(clean(info.egeId))) return null;
  const requestedTypes = normalizeIdentity(row?.NomCommercial).split(" ").filter(type => Object.hasOwn(categoryCodes, type));
  if (requestedTypes.some(type => categoryCodes[type] !== clean(record.categorieentiteGeographiqueExercice))) return null;
  const publicNames = [...new Set([info.nomEgeCourt, info.nomEgeLong].map(clean).filter(Boolean))];
  // Retain the establishment type. Dropping “EHPAD” would hide an SSIAD mismatch.
  const targets = new Set(targetNameVariants(row, { includeCategoryFallback: false }));
  if (!publicNames.some(name => targets.has(normalizeIdentity(name)))) return null;
  const addresses = (record.adresse ?? []).filter(address => address.usageAdresse === "03");
  const selected = addresses.find(address => [row?.Adresse, candidate.adresse].every(value => {
    const evidence = addressEvidence(value, registryAddress(address));
    return evidence.compatible && evidence.postal === "same" && evidence.commune === "same";
  }));
  if (!selected) return null;
  const adresse = registryAddress(selected);
  const sourceUrl = `https://finess.esante.gouv.fr/ege/${encodeURIComponent(clean(info.egeId))}`;
  return {
    source: "finess", sourceLabel: "FINESS — Agence du Numérique en Santé", sourceRecordId: finess,
    sourceUrl, sourcePublishedAt: source.generatedAt, sourceUpdatedAt: clean(record.dateDerniereMaj),
    sourceKind: "official-sector-register", publicNames, siret, adresse, legalName: candidate.raisonSociale,
    verifiedOfficial: false,
    registryEvidence: {
      finess, siret, publicNames, adresse, type: "EGE", status: record.etatObjet,
      categoryCode: clean(record.categorieentiteGeographiqueExercice), recordId: clean(info.egeId),
      extractedAt: source.generatedAt, updatedAt: clean(record.dateDerniereMaj),
      url: sourceUrl, snapshotUrl: source.url, datasetUrl: source.datasetUrl, indexUrl: String(indexUrl),
      sourceSchemaVersion: source.schemaVersion, address: selected,
      // These are FINESS address geocodes, not observations of the real site.
      // Preserve the original BAN key/coordinates without promoting them.
      addressPosition: {
        latitude: selected.coordonneesGeographique?.coordonneeY ?? null,
        longitude: selected.coordonneesGeographique?.coordonneeX ?? null,
        source: "FINESS / BAN", precision: "Précision de site non documentée",
        banId: selected.coordonneesGeographique?.cleInInteropBAN ?? null,
      },
    },
  };
}

export async function findFinessIdentityLinks({ row, candidates = [], signal, fetchImpl = fetch, baseUrl = FINESS_INDEX_BASE } = {}) {
  if (candidates.length > FINESS_BUDGET.maxCandidates || candidates.some(item => item.finessIds?.length > FINESS_BUDGET.maxIdsPerCandidate)) {
    throw new Error("Budget FINESS dépassé.");
  }
  const requests = [];
  const lookups = candidates.flatMap(candidate => (candidate.finessIds ?? []).map(id => ({ candidate, id })));
  const prefixes = [...new Set(lookups.map(item => normalizeFiness(item.id).slice(0, FINESS_SHARD_PREFIX_LENGTH)).filter(Boolean))];
  const results = await Promise.all(prefixes.map(async prefix => {
    const url = new URL(`${prefix}.json`, baseUrl);
    requests.push({ source: `finess:${prefix}`, kind: "finess-index", url: String(url) });
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal });
    if (!response.ok) throw new Error(`Extrait FINESS indisponible (HTTP ${response.status}).`);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > FINESS_BUDGET.maxShardBytes) throw new Error("Extrait FINESS trop volumineux.");
    const payload = JSON.parse(text);
    if (payload?.schemaVersion !== 1 || payload.prefix !== prefix || !Array.isArray(payload.records)
      || payload.recordCount !== payload.records.length || payload.source?.id !== "finess-ans"
      || payload.source.schemaVersion !== "v1.0.0" || !payload.source.generatedAt || !payload.source.url) {
      throw new Error("Extrait FINESS invalide ou incomplet.");
    }
    return lookups.filter(item => item.id.slice(0, FINESS_SHARD_PREFIX_LENGTH) === prefix).flatMap(({ id, candidate }) => {
      const records = payload.records.filter(record => normalizeFiness(record?.informationsGeneralesEGE?.numFinessEge) === id);
      if (records.length !== 1) return []; // a geographic identifier must be unique
      const link = finessIdentityLink(records[0], candidate, row, payload.source, url);
      return link ? [link] : [];
    });
  }));
  return { links: results.flat(), requests };
}
