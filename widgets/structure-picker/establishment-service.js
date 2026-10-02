import { resolveIdentityForEnrichment } from "./identity-service.js";
import { IDENTITY_STATES, normalizeIdentity } from "./identity-resolution.js";
import { resolveSitePosition, POSITION_STATES } from "./establishment-position.js";
import { findIndexedSitePositions, findOsmSiretPositions } from "./site-position-sources.js";
import { IDENTITY_BUDGET } from "./identity-orchestrator.js";

export const ESTABLISHMENT_BUDGET = Object.freeze({ deadlineMs: 24000, indexedDeadlineMs: 10000, osmDeadlineMs: 1500 });

async function boundedOperation(source, options, timeoutMs, optional = false) {
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  const partial = { observations: [], coverage: [] };
  let timer;
  let onAbort;
  const stopped = new Promise((resolve, reject) => {
    onAbort = () => { controller.abort(options.signal.reason); reject(options.signal.reason ?? new DOMException("Aborted", "AbortError")); };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new DOMException(optional ? "Source de position hors délai" : "Le délai maximal de l’analyse d’identité a été atteint.", "TimeoutError");
      controller.abort(error);
      if (optional) resolve({ observations: [...partial.observations], coverage: [...partial.coverage, { source: source.name, status: "timeout" }] });
      else reject(error);
    }, timeoutMs);
  });
  try {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    return await Promise.race([source({ ...options, signal: controller.signal, partial }), stopped]);
  } catch (error) {
    if (options.signal?.aborted || !optional) throw error;
    return { observations: [], coverage: [{ source: source.name, status: "error", message: error.message }] };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function publicName(candidate, row, links) {
  const linked = (links ?? []).find(link => link.verifiedOfficial && link.siret === candidate.siret);
  return (candidate.aliases ?? []).find(name => normalizeIdentity(name) === normalizeIdentity(row.NomCommercial))
    || linked?.publicNames?.find(name => normalizeIdentity(name) === normalizeIdentity(row.NomCommercial))
    || (candidate.nomUsuelDistinct ? candidate.nomCommercial : row.NomCommercial)
    || candidate.raisonSociale;
}

export async function resolveEstablishmentForEnrichment({
  row, signal, resolveIdentity = resolveIdentityForEnrichment,
  findIndexedPositions = findIndexedSitePositions, findOsmPositions = findOsmSiretPositions,
  ...identityOptions
} = {}) {
  const identity = await boundedOperation(
    options => resolveIdentity({ ...identityOptions, row, signal: options.signal }),
    { signal }, IDENTITY_BUDGET.deadlineMs,
  );
  const decision = identity.decision;
  const eligible = [IDENTITY_STATES.MATCH_VERIFIED, IDENTITY_STATES.MATCH_PROBABLE].includes(decision?.status);
  const official = eligible ? decision.candidate : null;
  if (!official) {
    const alternatives = (decision?.alternatives ?? []).map(candidate => ({
      ...candidate, latitude: null, longitude: null, identityStatus: decision.status,
      position: { siret: candidate.siret, status: POSITION_STATES.UNRESOLVED, latitude: null, longitude: null, source: null, proof: [], evidence: [], coverage: [], reason: "Identité non résolue : aucune position de site rattachée." },
    }));
    return { decision: { ...decision, alternatives }, candidate: null, alternatives, diagnostics: identity.diagnostics ?? [] };
  }

  const indexed = await boundedOperation(findIndexedPositions, { candidate: official, signal }, ESTABLISHMENT_BUDGET.indexedDeadlineMs, true);
  const options = { ...indexed, links: identity.links ?? [], discovery: identity.geocodeCandidates ?? [] };
  let position = resolveSitePosition(official, options);
  if (position.status === POSITION_STATES.UNRESOLVED) {
    const osm = await boundedOperation(findOsmPositions, { candidate: official, signal }, ESTABLISHMENT_BUDGET.osmDeadlineMs, true);
    position = resolveSitePosition(official, {
      ...options, observations: [...(indexed.observations ?? []), ...(osm.observations ?? [])],
      coverage: [...(indexed.coverage ?? []), ...(osm.coverage ?? [])],
    });
  }
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const candidate = {
    ...official, nomCommercial: publicName(official, row, identity.links),
    latitude: position.latitude, longitude: position.longitude,
    identityStatus: decision.status, position,
    identityProof: decision.certificates?.find(item => item.siret === official.siret)?.explanations ?? [],
    identityLinks: (identity.links ?? []).filter(link => link.siret === official.siret),
  };
  return { decision: { ...decision, candidate }, candidate, alternatives: [], diagnostics: identity.diagnostics ?? [] };
}
