import {
  canonicalEmail,
  canonicalPhone,
  canonicalWebsite,
  CONTACT_CONFIDENCE,
  contactConfidence,
  resolveContactCandidates,
} from "./contact-ranking.js";

const CONTACT_FIELDS = Object.freeze([
  { key: "telephone", canonicalize: canonicalPhone },
  { key: "courriel", canonicalize: canonicalEmail },
  { key: "siteWeb", canonicalize: canonicalWebsite },
]);

function provenanceOf(candidate) {
  if (Array.isArray(candidate?.source?.provenance) && candidate.source.provenance.length) {
    return candidate.source.provenance;
  }
  return candidate?.source ? [candidate.source] : [];
}

function provenanceKey(source) {
  return [source?.id, source?.recordId, source?.label].map(value => String(value ?? "")).join("\u0000");
}

function mergeProvenance(existing = [], incoming = []) {
  const byKey = new Map();
  for (const source of [...existing, ...incoming]) {
    if (!source) continue;
    const key = provenanceKey(source);
    if (!byKey.has(key)) byKey.set(key, source);
  }
  return [...byKey.values()];
}

export function selectContactSuggestions(candidates, context = {}) {
  const resolved = resolveContactCandidates(candidates, context);
  const suggestions = new Map();

  for (const candidate of resolved) {
    const confidence = contactConfidence(candidate, context);
    if (confidence.level === CONTACT_CONFIDENCE.VERIFY) continue;

    for (const field of CONTACT_FIELDS) {
      const value = String(candidate?.contacts?.[field.key] ?? "").trim();
      if (!value) continue;
      const canonical = field.canonicalize(value);
      if (!canonical) continue;

      const current = suggestions.get(field.key);
      if (!current) {
        suggestions.set(field.key, {
          key: field.key,
          value,
          canonical,
          candidate,
          confidence,
          provenance: mergeProvenance([], provenanceOf(candidate)),
        });
        continue;
      }

      if (current.canonical === canonical) {
        current.provenance = mergeProvenance(current.provenance, provenanceOf(candidate));
      }
    }
  }

  return CONTACT_FIELDS
    .map(field => suggestions.get(field.key))
    .filter(Boolean)
    .map(suggestion => Object.freeze({ ...suggestion, provenance: Object.freeze([...suggestion.provenance]) }));
}
