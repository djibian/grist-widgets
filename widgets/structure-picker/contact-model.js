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

export function createContactCandidate({
  source = {},
  identity = {},
  contacts = {},
  match = {},
} = {}) {
  const canonicalSource = Object.freeze({
    id: clean(source.id),
    label: clean(source.label),
    recordType: clean(source.recordType),
    recordId: source.recordId ?? null,
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
  const label = clean(candidate?.source?.label) || clean(candidate?.source?.id) || "Source publique";
  if (isExactSiretCandidate(candidate)) return `${label} · SIRET identique`;
  if (isNearbyNameCandidate(candidate)) {
    const distance = finiteOrNull(candidate?.match?.distanceMeters);
    return Number.isFinite(distance)
      ? `${label} · proximité + nom · ${Math.round(distance)} m`
      : `${label} · proximité + nom`;
  }
  return label;
}
