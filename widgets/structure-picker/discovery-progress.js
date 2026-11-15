import { extractLocationFromAddress, fuzzyTextScore, normalize, normalizeIdentifier } from "./search.js";

// UI-only accumulation of discovery hints and actual source lifecycle events.
// No candidate in this module is an official identity/position attestation.
export const MAX_DISCOVERY_HINTS = 250;
export const MAX_SOURCE_ACTIVITY = 30;

export function discoveryHintKey(candidate) {
  const siret = String(candidate?.siret ?? "").replace(/\D/g, "");
  if (siret.length === 14) return "siret:" + siret;
  const name = String(candidate?.nomCommercial || candidate?.raisonSociale || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const address = String(candidate?.adresse ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return name || address ? "place:" + name + "|" + address : "";
}

export function emptyDiscoveryProgress() {
  return { candidates: [], activity: [], totalHintsSeen: 0 };
}

export function mergeDiscoveryProgress(previous, checkpoint, { reference = null, guidance = null } = {}) {
  const before = previous ?? emptyDiscoveryProgress();
  const hints = new Map();
  for (const candidate of [...(before.candidates ?? []), ...(checkpoint?.candidates ?? [])]) {
    const key = discoveryHintKey(candidate);
    if (!key) continue;
    // A later observation may enrich the previous record; it does not change its legal status.
    if (hints.has(key)) hints.set(key, { ...hints.get(key), ...candidate });
    else hints.set(key, candidate);
  }
  const accumulated = [...hints.values()];
  // When the bounded UI reservoir fills up, a late useful discovery must be
  // able to displace an irrelevant early one. Relevance never grants proof.
  const retained = reference && accumulated.length > MAX_DISCOVERY_HINTS
    ? orderDiscoveryLeads(accumulated, reference, guidance).slice(0, MAX_DISCOVERY_HINTS)
    : accumulated.slice(0, MAX_DISCOVERY_HINTS);
  return {
    ...before,
    candidates: retained,
    totalHintsSeen: Math.max(before.totalHintsSeen ?? 0, hints.size),
  };
}

const TERMINAL_STATES = new Set(["ok", "timeout", "error", "aborted"]);
export function recordDiscoverySourceEvent(previous, event) {
  const before = previous ?? emptyDiscoveryProgress();
  if (!event?.source || !["start", ...TERMINAL_STATES].includes(event.state))
    return before;
  const activity = new Map((before.activity ?? []).map(item => [item.source, item]));
  const prior = activity.get(event.source);
  // Late duplicate "start" signals cannot make a completed request appear active again.
  if (prior && TERMINAL_STATES.has(prior.state) && event.state === "start")
    return before;
  activity.set(event.source, {
    source: event.source,
    state: event.state,
    elapsedMs: Number.isFinite(event.elapsedMs) ? event.elapsedMs : null,
    budgetMs: Number.isFinite(event.budgetMs) ? event.budgetMs : null,
  });
  return { ...before, activity: [...activity.values()].slice(-MAX_SOURCE_ACTIVITY) };
}

// Display-only ordering. It must never participate in decideIdentity,
// official evidence, geographic certification, or Grist writes.
// No hard-coded establishment names, sector weights or fitted thresholds.
export function discoveryRelevance(candidate, reference = {}, guidance = null) {
  const chosen = field => guidance?.selected?.find(item => item.field === field)?.value || "";
  const names = [candidate?.nomCommercial, candidate?.raisonSociale,
    ...(Array.isArray(candidate?.aliases) ? candidate.aliases : [])].filter(Boolean);
  const queryName = chosen("name") || reference?.NomCommercial || reference?.RaisonSociale || "";
  const queryOperator = chosen("operator") || reference?.RaisonSociale || "";
  const nameMatch = queryName ? Math.max(0, ...names.map(name => fuzzyTextScore(queryName, name))) : 0;
  const operatorMatch = queryOperator ? fuzzyTextScore(queryOperator, candidate?.raisonSociale) : 0;

  const queryAddress = chosen("address") || reference?.Adresse || "";
  const candidateAddress = candidate?.adresse || candidate?.Adresse || "";
  const street = address => normalize(String(address).split(/\\b\\d{5}\\b/)[0]);
  const queryStreet = street(queryAddress);
  const candidateStreet = street(candidateAddress);
  const streetMatch = queryStreet && candidateStreet ? fuzzyTextScore(queryStreet, candidateStreet) : 0;
  const requestedPostal = extractLocationFromAddress(queryAddress).codePostal || String(reference?.CodePostal || "");
  const candidatePostal = String(candidate?.codePostal || extractLocationFromAddress(candidateAddress).codePostal || "");
  const postalMatch = /^\\d{5}$/.test(requestedPostal) && /^\\d{5}$/.test(candidatePostal)
    ? (requestedPostal === candidatePostal ? 1 : -1) : 0;
  const requestedCommune = chosen("commune") || reference?.Commune || extractLocationFromAddress(queryAddress).commune;
  const actualCommune = candidate?.commune || extractLocationFromAddress(candidateAddress).commune;
  const communeMatch = requestedCommune && actualCommune ? fuzzyTextScore(requestedCommune, actualCommune) : 0;
  const requestedSiret = normalizeIdentifier(chosen("siret") || reference?.SirenSiret);
  const siteSiret = normalizeIdentifier(candidate?.siret);
  // An entered number is only a weak search clue. A shared SIREN cannot
  // distinguish the operator's headquarters from the internship site.
  const identifierHint = requestedSiret.length === 14 && requestedSiret === siteSiret ? 0.15 : 0;
  return nameMatch * 5 + operatorMatch + streetMatch * 2.5 + postalMatch * 1.25
    + communeMatch * 0.65 + identifierHint;
}

// Score each item once, keep ties deterministic, and never mutate the input.
function orderDiscoveryLeads(candidates, reference, guidance) {
  if (!reference) return candidates;
  return candidates.map((candidate, index) => ({
    candidate, index, score: discoveryRelevance(candidate, reference, guidance),
  })).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.candidate);
}

export function discoveryHints(progress, limit = 5, { excluded = [], reference = null, guidance = null } = {}) {
  const count = Math.max(0, Math.min(MAX_DISCOVERY_HINTS, Math.floor(Number(limit) || 0)));
  const candidates = (progress?.candidates ?? []).filter(candidate => !excluded.includes(discoveryHintKey(candidate)));
  return orderDiscoveryLeads(candidates, reference, guidance).slice(0, count).map(candidate => ({
    key: discoveryHintKey(candidate),
    name: candidate.nomCommercial || candidate.raisonSociale || "Lieu sans nom",
    legalName: candidate.raisonSociale || "",
    address: candidate.adresse || "",
    siret: /^\d{14}$/.test(String(candidate.siret ?? "").replace(/\D/g, "")) ? String(candidate.siret).replace(/\D/g, "") : "",
    candidate,
  }));
}

export function discoverySourceLabel(state) {
  return {
    start: "en cours",
    ok: "terminée",
    timeout: "délai dépassé",
    error: "indisponible",
    aborted: "interrompue",
  }[state] ?? "état inconnu";
}
