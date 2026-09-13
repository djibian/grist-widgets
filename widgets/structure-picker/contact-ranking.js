import { CONTACT_MATCH_KINDS, createContactCandidate } from "./contact-model.js";
import { extractLocationFromAddress, fuzzyTextScore, normalize, normalizeIdentifier } from "./search.js";

export const CONTACT_CONFIDENCE = Object.freeze({
  VERY_RELIABLE: "very-reliable",
  PROBABLE: "probable",
  VERIFY: "verify",
});

function clean(value) {
  return String(value ?? "").trim();
}

function finite(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function canonicalPhone(value) {
  const raw = clean(value);
  if (!raw) return "";
  let compact = raw.replace(/[^\d+]/g, "");
  if (compact.startsWith("0033")) compact = `+33${compact.slice(4)}`;
  const digits = compact.replace(/\D/g, "");
  if (compact.startsWith("+33") && digits.length === 11) return `+33${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("0")) return `+33${digits.slice(1)}`;
  if (compact.startsWith("+")) return `+${digits}`;
  return digits;
}

export function canonicalEmail(value) {
  return clean(value).toLowerCase();
}

export function canonicalWebsite(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    url.hostname = url.hostname.toLowerCase();
    const protocol = url.protocol.toLowerCase();
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${protocol}//${url.host}${pathname}${url.search}${url.hash}`;
  } catch {
    return raw.toLowerCase().replace(/\/$/, "");
  }
}

export function exactContactSignature(candidate) {
  const contacts = candidate?.contacts ?? {};
  const values = [
    ["telephone", canonicalPhone(contacts.telephone)],
    ["courriel", canonicalEmail(contacts.courriel)],
    ["siteWeb", canonicalWebsite(contacts.siteWeb)],
  ].filter(([, value]) => value);
  if (!values.length) return "";
  return values.map(([key, value]) => `${key}:${value}`).join("\u0001");
}

export function sameExactContactSet(left, right) {
  const leftSignature = exactContactSignature(left);
  return Boolean(leftSignature && leftSignature === exactContactSignature(right));
}

function websiteDomain(value) {
  const canonical = canonicalWebsite(value);
  if (!canonical) return "";
  try {
    return new URL(canonical).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function radians(value) {
  return value * Math.PI / 180;
}

function geographicDistanceMeters(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(finite);
  if (values.some(value => value === null)) return null;
  const [aLat, aLon, bLat, bLon] = values.map(radians);
  const dLat = bLat - aLat;
  const dLon = bLon - aLon;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function exactSiretEvidence(candidate, context) {
  const expected = normalizeIdentifier(context?.siret);
  const actual = normalizeIdentifier(candidate?.identity?.siret);
  return candidate?.match?.kind === CONTACT_MATCH_KINDS.EXACT_SIRET || Boolean(expected.length === 14 && expected === actual);
}

function exactAddressEvidence(candidate, context) {
  const expected = normalize(context?.address);
  const actual = normalize(candidate?.identity?.address);
  return Boolean(expected && actual && expected === actual);
}

function candidateDistance(candidate, context) {
  const recorded = finite(candidate?.match?.distanceMeters);
  if (recorded !== null) return recorded;
  return geographicDistanceMeters(
    context?.latitude,
    context?.longitude,
    candidate?.identity?.latitude,
    candidate?.identity?.longitude,
  );
}

function candidateNameScore(candidate, context) {
  const recorded = finite(candidate?.match?.nameScore);
  if (recorded !== null) return Math.max(0, Math.min(1, recorded));
  return fuzzyTextScore(context?.name, candidate?.identity?.name);
}

function postalCommuneEvidence(candidate, context) {
  const expected = extractLocationFromAddress(context?.address);
  const actual = extractLocationFromAddress(candidate?.identity?.address);
  if (!expected.codePostal || !actual.codePostal || expected.codePostal !== actual.codePostal) return false;
  const expectedCommune = normalize(expected.commune);
  const actualCommune = normalize(actual.commune);
  return Boolean(expectedCommune && expectedCommune === actualCommune);
}

function domainEvidence(candidate, context) {
  const expected = websiteDomain(context?.siteWeb);
  const actual = websiteDomain(candidate?.contacts?.siteWeb);
  return Boolean(expected && actual && expected === actual);
}

export function contactMatchEvidence(candidate, context = {}) {
  const distanceMeters = candidateDistance(candidate, context);
  const nameScore = candidateNameScore(candidate, context);
  return Object.freeze({
    exactSiret: exactSiretEvidence(candidate, context),
    exactAddress: exactAddressEvidence(candidate, context),
    distanceMeters,
    hasCoordinateEvidence: distanceMeters !== null,
    nameScore,
    postalCommune: postalCommuneEvidence(candidate, context),
    domain: domainEvidence(candidate, context),
  });
}

function contactRichness(candidate) {
  return [
    candidate?.contacts?.telephone,
    candidate?.contacts?.courriel,
    candidate?.contacts?.siteWeb,
  ].filter(value => clean(value)).length;
}

function rankingTuple(candidate, context) {
  const evidence = contactMatchEvidence(candidate, context);
  const distanceRank = evidence.hasCoordinateEvidence ? -Math.max(0, evidence.distanceMeters) : Number.NEGATIVE_INFINITY;
  const sourceScore = finite(candidate?.match?.score) ?? 0;
  return [
    evidence.exactSiret ? 1 : 0,
    evidence.exactAddress ? 1 : 0,
    evidence.hasCoordinateEvidence ? 1 : 0,
    distanceRank,
    evidence.nameScore,
    evidence.postalCommune ? 1 : 0,
    evidence.domain ? 1 : 0,
    sourceScore,
    contactRichness(candidate),
  ];
}

function compareTuple(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (right[index] ?? 0) - (left[index] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

export function compareContactCandidates(left, right, context = {}) {
  const ranked = compareTuple(rankingTuple(left, context), rankingTuple(right, context));
  if (ranked) return ranked;
  const leftSource = `${left?.source?.label ?? ""}\u0000${left?.source?.id ?? ""}\u0000${left?.source?.recordId ?? ""}`;
  const rightSource = `${right?.source?.label ?? ""}\u0000${right?.source?.id ?? ""}\u0000${right?.source?.recordId ?? ""}`;
  return leftSource.localeCompare(rightSource, "fr");
}

export function contactConfidence(candidate, context = {}) {
  const evidence = contactMatchEvidence(candidate, context);
  if (evidence.exactSiret) {
    return Object.freeze({ level: CONTACT_CONFIDENCE.VERY_RELIABLE, label: "Très fiable" });
  }
  if (
    evidence.exactAddress
    || (evidence.hasCoordinateEvidence && evidence.distanceMeters <= 300 && evidence.nameScore >= 0.55)
    || (evidence.nameScore >= 0.9 && (evidence.postalCommune || evidence.domain))
  ) {
    return Object.freeze({ level: CONTACT_CONFIDENCE.PROBABLE, label: "Probable" });
  }
  return Object.freeze({ level: CONTACT_CONFIDENCE.VERIFY, label: "À vérifier" });
}

function provenanceOf(candidate) {
  if (Array.isArray(candidate?.source?.provenance) && candidate.source.provenance.length) {
    return candidate.source.provenance;
  }
  return candidate?.source ? [candidate.source] : [];
}

function withProvenance(candidate, provenance) {
  return createContactCandidate({
    source: { ...candidate.source, provenance },
    identity: candidate.identity,
    contacts: candidate.contacts,
    match: candidate.match,
  });
}

export function resolveContactCandidates(candidates, context = {}) {
  const ordered = [...(Array.isArray(candidates) ? candidates : [])]
    .filter(candidate => candidate && exactContactSignature(candidate))
    .sort((left, right) => compareContactCandidates(left, right, context));

  const groups = new Map();
  for (const candidate of ordered) {
    const signature = exactContactSignature(candidate);
    const existing = groups.get(signature);
    if (!existing) {
      groups.set(signature, { winner: candidate, provenance: [...provenanceOf(candidate)] });
      continue;
    }
    existing.provenance.push(...provenanceOf(candidate));
  }

  return Object.freeze([...groups.values()].map(group => withProvenance(group.winner, group.provenance)));
}
