// Voluntary, session-scoped search hints. Never a legal, address or position proof.
import { discoveryHintKey } from "./discovery-progress.js";
import { extractLocationFromAddress } from "./search.js";

export const GUIDANCE_FIELDS = Object.freeze(["name", "address", "commune", "operator", "siret"]);

export function emptyDiscoveryGuidance() {
  return { selected: [], rejected: [], version: 0 };
}

export function isRejectedGuidance(guidance, candidate) {
  const key = discoveryHintKey(candidate);
  return Boolean(key && guidance?.rejected?.includes(key));
}

export function guidanceFieldValue(candidate, field) {
  if (!GUIDANCE_FIELDS.includes(field)) return "";
  const value = ({
    name: candidate?.nomCommercial || candidate?.raisonSociale,
    address: candidate?.adresse,
    commune: candidate?.commune || extractLocationFromAddress(candidate?.adresse).commune,
    operator: candidate?.operator?.raisonSociale || candidate?.raisonSociale,
    siret: candidate?.siret,
  })[field];
  const text = String(value ?? "").trim().slice(0, 250);
  if (field === "siret") {
    const digits = text.replace(/\D/g, "");
    return [9, 14].includes(digits.length) ? digits : "";
  }
  return text;
}

// Mutates the shared object deliberately: a running search may inspect the
// new guidance at its next planning checkpoint, without restarting its requests.
export function chooseDiscoveryGuidance(guidance, candidate, field, action = "select") {
  const key = discoveryHintKey(candidate);
  if (!guidance || !key) return false;
  if (action === "reject") {
    const rejected = new Set(guidance.rejected ?? []);
    if (rejected.has(key)) rejected.delete(key);
    else rejected.add(key);
    guidance.rejected = [...rejected].slice(-250);
    guidance.selected = (guidance.selected ?? []).filter(entry => entry.key !== key);
  } else if (action === "select" && GUIDANCE_FIELDS.includes(field)) {
    const value = guidanceFieldValue(candidate, field);
    if (!value) return false;
    const current = guidance.selected ?? [];
    const existing = current.find(entry => entry.field === field);
    guidance.selected = existing?.key === key && existing?.value === value
      ? current.filter(entry => entry.field !== field)
      : [...current.filter(entry => entry.field !== field), { key, field, value }];
    guidance.rejected = (guidance.rejected ?? []).filter(item => item !== key);
  } else return false;
  guidance.version = (guidance.version ?? 0) + 1;
  return true;
}


// Corrections are search hypotheses only. They neither rewrite a candidate nor
// certify an entered SIRET. Idempotence avoids unnecessary in-flight replans.
export function correctDiscoveryGuidance(guidance, candidate, field, rawValue) {
  const key = discoveryHintKey(candidate);
  if (!guidance || !key || !GUIDANCE_FIELDS.includes(field)) return false;
  const text = String(rawValue ?? "").trim();
  if (!text || text.length > 250) return false;
  let value = text;
  if (field === "siret") {
    // Accept visual separators, never arbitrary letters or partial identifiers.
    if (!/^[0-9 .-]+$/.test(text)) return false;
    value = text.replace(/[^0-9]/g, "");
    if (![9, 14].includes(value.length)) return false;
  }
  const selected = guidance.selected ?? [];
  const previous = selected.find(entry => entry.field === field);
  if (previous?.key === key && previous.value === value) return false;
  guidance.selected = [...selected.filter(entry => entry.field !== field),
    { key, field, value, corrected: true }];
  guidance.rejected = (guidance.rejected ?? []).filter(item => item !== key);
  guidance.version = (guidance.version ?? 0) + 1;
  return true;
}
