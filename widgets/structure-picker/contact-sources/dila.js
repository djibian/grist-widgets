import {
  CONTACT_MATCH_KINDS,
  createContactCandidate,
} from "../contact-model.js";
import { fuzzyTextScore, normalizeIdentifier } from "../search.js";

const DILA_RECORDS_URL = "https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records";

function clean(value) {
  return String(value ?? "").trim();
}

function finiteOrNull(value) {
  if (value === undefined || value === null || clean(value) === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function firstValue(value) {
  for (const entry of jsonArray(value)) {
    const candidate = clean(entry?.valeur ?? entry?.value);
    if (candidate) return candidate;
  }
  return "";
}

function firstEmail(value) {
  return clean(value)
    .split(/[;,]/)
    .map(part => part.trim())
    .find(Boolean) || "";
}

function addressText(address) {
  if (!address || typeof address !== "object") return "";
  const street = [
    clean(address.complement1),
    clean(address.complement2),
    clean(address.numero_voie),
    clean(address.service_distribution),
  ].filter(Boolean);
  const locality = [clean(address.code_postal), clean(address.nom_commune)].filter(Boolean).join(" ");
  return [...street, locality].filter(Boolean).join(", ");
}

function primaryAddress(value) {
  const addresses = jsonArray(value).filter(entry => entry && typeof entry === "object");
  if (!addresses.length) return null;
  return addresses.find(entry => clean(entry.type_adresse).toLowerCase() === "adresse") || addresses[0];
}

function escapeOdsLiteral(value) {
  return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildDilaSearchUrl(context = {}, limit = 10) {
  const siret = normalizeIdentifier(context.siret);
  const name = clean(context.name);
  const where = siret.length === 14
    ? `siret="${siret}"`
    : (name ? `search(nom,"${escapeOdsLiteral(name)}")` : "");
  if (!where) return "";
  const params = new URLSearchParams({ where, limit: String(Math.max(1, Math.min(100, Number(limit) || 10))) });
  return `${DILA_RECORDS_URL}?${params.toString()}`;
}

export function dilaRecordToCandidate(record, context = {}) {
  if (!record || typeof record !== "object") return null;
  const telephone = firstValue(record.telephone);
  const courriel = firstEmail(record.adresse_courriel);
  const siteWeb = firstValue(record.site_internet);
  if (!telephone && !courriel && !siteWeb) return null;

  const address = primaryAddress(record.adresse);
  const candidateSiret = normalizeIdentifier(record.siret);
  const expectedSiret = normalizeIdentifier(context.siret);
  const exactSiret = expectedSiret.length === 14 && candidateSiret === expectedSiret;
  const name = clean(record.nom);
  const nameScore = fuzzyTextScore(context.name, name);

  return createContactCandidate({
    source: {
      id: "dila",
      label: "Service-Public.fr (DILA)",
      recordType: "annuaire-administration",
      recordId: clean(record.id) || null,
    },
    identity: {
      name,
      siret: candidateSiret,
      address: addressText(address),
      latitude: finiteOrNull(address?.latitude),
      longitude: finiteOrNull(address?.longitude),
    },
    contacts: { telephone, courriel, siteWeb },
    match: {
      kind: exactSiret ? CONTACT_MATCH_KINDS.EXACT_SIRET : CONTACT_MATCH_KINDS.NEARBY_NAME,
      nameScore,
    },
  });
}

export const dilaContactSource = Object.freeze({
  id: "dila",
  label: "Service-Public.fr (DILA)",

  canSearch(context = {}) {
    return normalizeIdentifier(context.siret).length === 14 || Boolean(clean(context.name));
  },

  async search(context = {}, options = {}) {
    const url = buildDilaSearchUrl(context, options.limit ?? 10);
    if (!url) return Object.freeze({ source: Object.freeze({ id: this.id, label: this.label }), candidates: Object.freeze([]) });
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const response = await fetchImpl(url, { signal: options.signal });
    if (!response.ok) throw new Error(`Service-Public.fr indisponible (${response.status}).`);
    const payload = await response.json();
    const candidates = (Array.isArray(payload?.results) ? payload.results : [])
      .map(record => dilaRecordToCandidate(record, context))
      .filter(Boolean);
    return Object.freeze({
      source: Object.freeze({ id: this.id, label: this.label }),
      candidates: Object.freeze(candidates),
    });
  },
});
