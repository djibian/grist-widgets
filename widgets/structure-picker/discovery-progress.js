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

export function mergeDiscoveryProgress(previous, checkpoint) {
  const before = previous ?? emptyDiscoveryProgress();
  const hints = new Map();
  for (const candidate of [...(before.candidates ?? []), ...(checkpoint?.candidates ?? [])]) {
    const key = discoveryHintKey(candidate);
    if (!key) continue;
    // A later observation may enrich the previous record; it does not change its legal status.
    if (hints.has(key)) hints.set(key, { ...hints.get(key), ...candidate });
    else hints.set(key, candidate);
  }
  return {
    ...before,
    candidates: [...hints.values()].slice(0, MAX_DISCOVERY_HINTS),
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

export function discoveryHints(progress, limit = 5, { excluded = [] } = {}) {
  const count = Math.max(0, Math.min(20, Math.floor(Number(limit) || 0)));
  return (progress?.candidates ?? []).filter(candidate => !excluded.includes(discoveryHintKey(candidate))).slice(0, count).map(candidate => ({
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
