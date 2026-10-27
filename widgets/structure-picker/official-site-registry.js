import { addressEvidence, comparisonTokens, normalizeIdentity, registrySiteMatches } from "./identity-resolution.js";
import { boundedSource } from "./bounded-source.js";
import { extractLocationFromAddress } from "./search.js";

export const SITE_REGISTRY_BASE = new URL("./identity-links/site-registry/", import.meta.url);
export const SITE_REGISTRY_BUDGET = Object.freeze({ lookupMs: 1800, maxShardBytes: 96 * 1024, maxFiles: 8, maxMatches: 2 });
const cache = new Map();
const clean = value => String(value ?? "").trim();
const communeKey = value => comparisonTokens(value).filter(token => !["de", "du", "des", "la", "le", "les", "l", "d", "en", "sur"].includes(token)).join(" ");

export function normalizeRegistryRecords(entry, source = {}) {
  const native = entry?.native;
  if (!native) return [];
  if (entry.kind === "education") {
    const id = clean(native.identifiant_de_l_etablissement).toUpperCase();
    if (!/^\d{7}[A-Z]$/.test(id) || native.etat !== "OUVERT") return [];
    const siret = clean(native.siren_siret);
    const query = new URLSearchParams({ where: `identifiant_de_l_etablissement='${id}'`, limit: "1" });
    return [{ kind: "education", recordId: id, siret: /^\d{14}$/.test(siret) ? siret : "", name: clean(native.nom_etablissement),
      publicNames: [clean(native.nom_etablissement)], siteType: clean(native.type_etablissement), status: native.etat,
      adresse: [native.adresse_1, native.adresse_2, native.code_postal, native.nom_commune].filter(Boolean).join(" "),
      postcode: clean(native.code_postal), commune: clean(native.nom_commune), codeCommune: clean(native.code_commune),
      sourceUrl: `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records?${query}`,
      updatedAt: native.date_maj_ligne, source: source.education, native,
      discoveryPosition: { latitude: native.latitude, longitude: native.longitude, precision: native.precision_localisation },
    }];
  }
  if (entry.kind !== "finess") return [];
  const info = native.informationsGeneralesEGE;
  if (native.etatObjet !== "A" || info?.dateFermeture || !/^\d{9}$/.test(clean(info?.numFinessEge))) return [];
  return (native.adresse ?? []).filter(address => address.usageAdresse === "03").map(address => ({
    kind: "finess", recordId: info.numFinessEge, siret: /^\d{14}$/.test(clean(info.siret)) ? info.siret : "",
    name: clean(info.nomEgeCourt || info.nomEgeLong), publicNames: [...new Set([info.nomEgeCourt, info.nomEgeLong].map(clean).filter(Boolean))],
    categoryCode: clean(native.categorieentiteGeographiqueExercice), siteType: "", status: "A",
    adresse: [address.ligneQuatre || [address.numeroVoie, address.typeVoie, address.libelleVoie].filter(Boolean).join(" "), address.codePostal, address.ligneAcheminement].filter(Boolean).join(" "),
    postcode: clean(address.codePostal), commune: clean(address.ligneAcheminement), codeCommune: clean(address.cogCommune),
    sourceUrl: `https://finess.esante.gouv.fr/ege/${encodeURIComponent(info.egeId)}`, updatedAt: native.dateDerniereMaj,
    source: source.finess, native, registryAddress: address,
    discoveryPosition: { latitude: address.coordonneesGeographique?.coordonneeY, longitude: address.coordonneesGeographique?.coordonneeX, precision: "Précision de site non documentée" },
  }));
}

async function readRegistryJson(url, { signal, fetchImpl, maxBytes, maxAgeMs = 5 * 60 * 1000 }) {
  const key = String(url);
  const previous = cache.get(key);
  if (previous && Date.now() - previous.at < maxAgeMs) return previous.value;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`Référentiel de sites indisponible (HTTP ${response.status}).`);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("Référentiel de sites hors budget de taille.");
  const value = JSON.parse(text);
  if (signal?.aborted) throw signal.reason;
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  return value;
}

export async function findOfficialRegistrySites({ row, signal, fetchImpl = globalThis.fetch, baseUrl = SITE_REGISTRY_BASE, onEvent, allowLive = true } = {}) {
  return boundedSource("registry:discovery", async sourceSignal => {
    const manifest = await readRegistryJson(new URL("manifest.json", baseUrl), { signal: sourceSignal, fetchImpl, maxBytes: 256 * 1024 });
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.communes)) throw new Error("Manifest de référentiels invalide.");
    const input = communeKey(row.Adresse);
    const location = extractLocationFromAddress(row.Adresse);
    const towns = manifest.communes.filter(town => town.names.some(name => input.endsWith(` ${communeKey(name)}`))
      && (!location.codePostal || town.postcodes.includes(location.codePostal)));
    const scoped = towns.length ? towns : manifest.communes.filter(town => location.codePostal && town.postcodes.includes(location.codePostal));
    const files = [...new Set(scoped.flatMap(town => town.files))];
    if (files.length > SITE_REGISTRY_BUDGET.maxFiles) return { records: [], complete: false, message: "Plusieurs communes ou trop de sources : préciser la commune." };
    const entries = (await Promise.all(files.map(async file => {
      if (!/^\d{5}\.\d+\.json$/.test(file)) throw new Error("Identifiant de fichier de référentiel invalide.");
      const url = new URL(file, baseUrl); url.searchParams.set("v", manifest.generatedAt);
      const payload = await readRegistryJson(url, { signal: sourceSignal, fetchImpl, maxBytes: SITE_REGISTRY_BUDGET.maxShardBytes, maxAgeMs: 24 * 60 * 60 * 1000 });
      if (payload.schemaVersion !== 1 || !Array.isArray(payload.records) || payload.recordCount !== payload.records.length) throw new Error("Extrait de référentiel tronqué.");
      return payload.records;
    }))).flat();
    const records = entries.flatMap(entry => normalizeRegistryRecords(entry, manifest.source)).filter(record => registrySiteMatches(row, record));
    if (!records.length && allowLive && location.codePostal && /\b(ecole|college|lycee)\b/.test(normalizeIdentity(row.NomCommercial))) {
      const url = new URL("https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records");
      url.search = new URLSearchParams({ where: `code_postal='${location.codePostal}' AND etat='OUVERT'`, limit: "100" });
      const payload = await boundedSource("education:live-discovery", async liveSignal => {
        const response = await fetchImpl(url, { signal: liveSignal, headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Éducation nationale HTTP ${response.status}`);
        return response.json();
      }, { signal: sourceSignal, timeoutMs: 1000, onEvent });
      if (!Array.isArray(payload.results) || payload.total_count > payload.results.length) return { records: [], complete: false, message: "Référentiel scolaire trop large pour conclure sans ambiguïté." };
      records.push(...payload.results.flatMap(native => normalizeRegistryRecords({ kind: "education", native }, { education: { url: String(url), generatedAt: new Date().toISOString() } })).filter(record => registrySiteMatches(row, record)));
    }
    const unique = [...new Map(records.map(record => [`${record.kind}:${record.recordId}:${record.adresse}`, record])).values()];
    return { records: unique, complete: true, generatedAt: manifest.generatedAt, coverage: scoped.map(town => town.code) };
  }, { signal, timeoutMs: SITE_REGISTRY_BUDGET.lookupMs, onEvent });
}

export function verifiedRegistryLink(record, candidate, { checkedAt, url } = {}) {
  const bindingAddress = addressEvidence(candidate.adresse, record.adresse);
  const ids = record.kind === "education" ? candidate.uaiIds : candidate.finessIds;
  if (record.siret !== candidate.siret || candidate.etatAdministratif !== "A" || !ids?.includes(record.recordId)
    || !bindingAddress.compatible || bindingAddress.postal !== "same" || bindingAddress.commune !== "same") return null;
  const registryEvidence = record.kind === "finess" ? {
    finess: record.recordId, siret: record.siret, publicNames: record.publicNames, adresse: record.adresse,
    type: "EGE", status: "A", categoryCode: record.categoryCode,
    recordId: record.native.informationsGeneralesEGE.egeId, address: record.registryAddress,
    snapshotUrl: record.source?.url, extractedAt: record.source?.generatedAt,
    addressPosition: { ...record.discoveryPosition, source: "FINESS / BAN" },
  } : { type: "EDUCATION", uai: record.recordId, siret: record.siret, sourceUpdatedAt: record.updatedAt,
    snapshotUrl: record.source?.url, addressPosition: record.discoveryPosition };
  return {
    source: record.kind, sourceLabel: record.kind === "education" ? "Annuaire de l’Éducation nationale" : "FINESS — Agence du Numérique en Santé",
    sourceRecordId: record.recordId, siret: record.siret, publicNames: record.publicNames, adresse: record.adresse,
    sourceUrl: record.sourceUrl, sourcePublishedAt: record.source?.generatedAt, sourceUpdatedAt: record.updatedAt,
    verifiedOfficial: true, registryRecord: record, registryEvidence,
    officialBinding: { siret: candidate.siret, adresse: candidate.adresse, uaiIds: candidate.uaiIds ?? [], finessIds: candidate.finessIds ?? [], checkedAt, url },
  };
}

export function resetRegistryCacheForTests() { cache.clear(); }
