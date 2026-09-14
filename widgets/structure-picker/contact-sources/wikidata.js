import {
  CONTACT_MATCH_KINDS,
  createContactCandidate,
} from "../contact-model.js";
import { fuzzyTextScore, normalizeIdentifier } from "../search.js";

const WIKIDATA_REST_BASE = "https://www.wikidata.org/w/rest.php/wikibase/v1";
const WIKIDATA_QUERY_URL = "https://query.wikidata.org/sparql";
const SERVICE_PUBLIC_DIRECTORY_QID = "Q97451652";

function clean(value) {
  return String(value ?? "").trim();
}

function contextSiren(context = {}) {
  const explicit = normalizeIdentifier(context.siren);
  if (explicit.length === 9) return explicit;
  const siret = normalizeIdentifier(context.siret);
  return siret.length === 14 ? siret.slice(0, 9) : "";
}

function statementList(item, propertyId) {
  const statements = Array.isArray(item?.statements?.[propertyId]) ? item.statements[propertyId] : [];
  return statements
    .filter(statement => statement?.rank !== "deprecated" && statement?.value?.type === "value")
    .sort((left, right) => Number(right?.rank === "preferred") - Number(left?.rank === "preferred"));
}

function statementContent(statement) {
  return statement?.value?.type === "value" ? statement.value.content : null;
}

function statementReferencesDirectory(statement) {
  for (const reference of statement?.references ?? []) {
    for (const part of reference?.parts ?? []) {
      if (part?.property?.id === "P248" && clean(part?.value?.content) === SERVICE_PUBLIC_DIRECTORY_QID) return true;
    }
  }
  return false;
}

function firstStatement(item, propertyId, transform = value => value) {
  for (const statement of statementList(item, propertyId)) {
    const value = transform(statementContent(statement));
    if (value) return { value, statement };
  }
  return null;
}

function textContent(value) {
  if (typeof value === "string") return clean(value);
  if (value && typeof value === "object") return clean(value.text ?? value.value);
  return "";
}

function mailContent(value) {
  const result = clean(value);
  return result.toLowerCase().startsWith("mailto:") ? result.slice(7).trim() : result;
}

function coordinateContent(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  return {
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

function itemLabel(item, fallback = "") {
  const french = item?.labels?.fr;
  const english = item?.labels?.en;
  return clean(typeof french === "string" ? french : french?.value)
    || clean(typeof english === "string" ? english : english?.value)
    || clean(fallback);
}

function qidFromUri(value) {
  const match = clean(value).match(/\/entity\/(Q\d+)$/i);
  return match ? match[1].toUpperCase() : "";
}

export function buildWikidataSirenQueryUrl(siren) {
  const normalized = normalizeIdentifier(siren);
  if (normalized.length !== 9) return "";
  const query = `SELECT ?item WHERE { ?item wdt:P1616 "${normalized}". } LIMIT 5`;
  const params = new URLSearchParams({ query, format: "json" });
  return `${WIKIDATA_QUERY_URL}?${params.toString()}`;
}

export function buildWikidataSearchUrl(name, limit = 5) {
  const query = clean(name);
  if (!query) return "";
  const params = new URLSearchParams({
    q: query,
    language: "fr",
    limit: String(Math.max(1, Math.min(10, Number(limit) || 5))),
  });
  return `${WIKIDATA_REST_BASE}/search/items?${params.toString()}`;
}

export function wikidataItemToCandidate(item, context = {}, fallbackLabel = "") {
  if (!item || typeof item !== "object") return null;
  const telephone = firstStatement(item, "P1329", textContent);
  const courriel = firstStatement(item, "P968", mailContent);
  const siteWeb = firstStatement(item, "P856", textContent);
  if (!telephone && !courriel && !siteWeb) return null;

  const sirenStatement = firstStatement(item, "P1616", textContent);
  const street = firstStatement(item, "P6375", textContent)?.value || "";
  const postcode = firstStatement(item, "P281", textContent)?.value || "";
  const coordinates = coordinateContent(firstStatement(item, "P625")?.value);
  const name = itemLabel(item, fallbackLabel);
  const expectedSiren = contextSiren(context);
  const candidateSiren = normalizeIdentifier(sirenStatement?.value);
  const exactSiren = expectedSiren.length === 9 && candidateSiren === expectedSiren;
  const nameScore = fuzzyTextScore(context.name, name);
  const sourceProvenance = [];

  if ([telephone, courriel, siteWeb].some(entry => entry && statementReferencesDirectory(entry.statement))) {
    sourceProvenance.push({
      id: "dila",
      label: "Service-Public.fr (via Wikidata)",
      recordType: "wikidata-reference",
      recordId: SERVICE_PUBLIC_DIRECTORY_QID,
    });
  }

  return createContactCandidate({
    source: {
      id: "wikidata",
      label: "Wikidata",
      recordType: "item",
      recordId: clean(item.id) || null,
      provenance: sourceProvenance,
    },
    identity: {
      name,
      siret: "",
      address: [street, postcode].filter(Boolean).join(", "),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    },
    contacts: {
      telephone: telephone?.value || "",
      courriel: courriel?.value || "",
      siteWeb: siteWeb?.value || "",
    },
    match: {
      kind: nameScore > 0 ? CONTACT_MATCH_KINDS.NEARBY_NAME : CONTACT_MATCH_KINDS.UNKNOWN,
      nameScore,
      score: exactSiren ? 1 : 0,
    },
  });
}

async function fetchJson(fetchImpl, url, signal, label) {
  const response = await fetchImpl(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${label} indisponible (${response.status}).`);
  return response.json();
}

async function exactSirenQids(fetchImpl, siren, signal) {
  const url = buildWikidataSirenQueryUrl(siren);
  if (!url) return [];
  const payload = await fetchJson(fetchImpl, url, signal, "Wikidata Query Service");
  return [...new Set((payload?.results?.bindings ?? [])
    .map(binding => qidFromUri(binding?.item?.value))
    .filter(Boolean))];
}

async function textSearchQids(fetchImpl, name, limit, signal) {
  const url = buildWikidataSearchUrl(name, limit);
  if (!url) return { qids: [], labels: new Map() };
  const payload = await fetchJson(fetchImpl, url, signal, "Wikidata");
  const labels = new Map();
  const qids = [];
  for (const result of payload?.results ?? []) {
    const qid = clean(result?.id).toUpperCase();
    if (!/^Q\d+$/.test(qid) || qids.includes(qid)) continue;
    qids.push(qid);
    labels.set(qid, clean(result?.["display-label"]?.value));
  }
  return { qids, labels };
}

export const wikidataContactSource = Object.freeze({
  id: "wikidata",
  label: "Wikidata",

  canSearch(context = {}) {
    return Boolean(contextSiren(context) || clean(context.name));
  },

  async search(context = {}, options = {}) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const signal = options.signal;
    const siren = contextSiren(context);
    let qids = siren ? await exactSirenQids(fetchImpl, siren, signal) : [];
    let labels = new Map();

    if (!qids.length && clean(context.name)) {
      const search = await textSearchQids(fetchImpl, context.name, options.limit ?? 5, signal);
      qids = search.qids;
      labels = search.labels;
    }

    const settled = await Promise.allSettled(qids.map(qid =>
      fetchJson(fetchImpl, `${WIKIDATA_REST_BASE}/entities/items/${qid}`, signal, "Wikidata")));
    const candidates = [];
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result.status === "rejected") {
        if (result.reason?.name === "AbortError") throw result.reason;
        continue;
      }
      const candidate = wikidataItemToCandidate(result.value, context, labels.get(qids[index]) || "");
      if (candidate) candidates.push(candidate);
    }

    return Object.freeze({
      source: Object.freeze({ id: this.id, label: this.label }),
      candidates: Object.freeze(candidates),
    });
  },
});
