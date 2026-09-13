export const CONTACT_MATCH_KINDS = Object.freeze({
  EXACT_SIRET: "exact-siret",
  NEARBY_NAME: "nearby-name",
  UNKNOWN: "unknown",
});

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMatchKind(value) {
  return Object.values(CONTACT_MATCH_KINDS).includes(value) ? value : CONTACT_MATCH_KINDS.UNKNOWN;
}

function sourceReference(source = {}) {
  return Object.freeze({
    id: clean(source.id),
    label: clean(source.label),
    recordType: clean(source.recordType),
    recordId: source.recordId ?? null,
  });
}

function sourceReferenceKey(source) {
  return [source.id, source.label, source.recordType, String(source.recordId ?? "")].join("\u0000");
}

function canonicalProvenance(source, primary) {
  const references = [primary, ...(Array.isArray(source?.provenance) ? source.provenance.map(sourceReference) : [])];
  const seen = new Set();
  const result = [];
  for (const reference of references) {
    if (!reference.id && !reference.label && !reference.recordType && reference.recordId === null) continue;
    const key = sourceReferenceKey(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return Object.freeze(result);
}

export function createContactCandidate({
  source = {},
  identity = {},
  contacts = {},
  match = {},
} = {}) {
  const primarySource = sourceReference(source);
  const canonicalSource = Object.freeze({
    ...primarySource,
    provenance: canonicalProvenance(source, primarySource),
  });

  const canonicalIdentity = Object.freeze({
    name: clean(identity.name),
    siret: clean(identity.siret),
    address: clean(identity.address),
    latitude: finiteOrNull(identity.latitude),
    longitude: finiteOrNull(identity.longitude),
  });

  const canonicalContacts = Object.freeze({
    telephone: clean(contacts.telephone),
    courriel: clean(contacts.courriel),
    siteWeb: clean(contacts.siteWeb),
  });

  const canonicalMatch = Object.freeze({
    kind: normalizeMatchKind(match.kind),
    score: finiteOrNull(match.score),
    nameScore: finiteOrNull(match.nameScore),
    distanceMeters: finiteOrNull(match.distanceMeters),
  });

  return Object.freeze({
    source: canonicalSource,
    identity: canonicalIdentity,
    contacts: canonicalContacts,
    match: canonicalMatch,
  });
}

export function isExactSiretCandidate(candidate) {
  return candidate?.match?.kind === CONTACT_MATCH_KINDS.EXACT_SIRET;
}

export function isNearbyNameCandidate(candidate) {
  return candidate?.match?.kind === CONTACT_MATCH_KINDS.NEARBY_NAME;
}

export function contactSourceSummary(candidate) {
  const provenance = Array.isArray(candidate?.source?.provenance) ? candidate.source.provenance : [];
  const labels = [...new Set(provenance
    .map(source => clean(source?.label) || clean(source?.id))
    .filter(Boolean))];
  const primaryLabel = clean(candidate?.source?.label) || clean(candidate?.source?.id) || "Source publique";
  const label = labels.length > 1 ? labels.join(" + ") : (labels[0] || primaryLabel);
  const referenceSuffix = provenance.length > 1 && labels.length <= 1 ? ` · ${provenance.length} références` : "";
  if (isExactSiretCandidate(candidate)) return `${label}${referenceSuffix} · SIRET identique`;
  if (isNearbyNameCandidate(candidate)) {
    const distance = finiteOrNull(candidate?.match?.distanceMeters);
    return Number.isFinite(distance)
      ? `${label}${referenceSuffix} · proximité + nom · ${Math.round(distance)} m`
      : `${label}${referenceSuffix} · proximité + nom`;
  }
  return `${label}${referenceSuffix}`;
}
