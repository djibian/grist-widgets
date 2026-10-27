import {
  buildOfficialIdentifierSearchRequest,
  buildOfficialNearbySearchRequest,
  buildOfficialTextSearchRequest,
  extractLocationFromAddress,
  identifierParts,
  normalizeIdentifier,
} from "./search.js";
import {
  IDENTITY_STATES,
  decideIdentity,
  decisionCandidates,
  identitySearchName,
  usableCoordinates,
} from "./identity-resolution.js";
import { boundedSource } from "./bounded-source.js";

export const IDENTITY_BUDGET = Object.freeze({
  maxOfficialRequests: 6,
  maxPaginationPages: 1,
  maxPoiSiretsToValidate: 2,
  deadlineMs: 12000,
  requestMs: 6500,
  geocodeMs: 1200,
  poiMs: 1500,
});

function makeAbortError() {
  return new DOMException("Aborted", "AbortError");
}

function createDeadline(parentSignal, deadlineMs) {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(parentSignal?.reason ?? makeAbortError());
  if (parentSignal?.aborted) forwardAbort();
  else parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Identity resolution deadline exceeded", "TimeoutError"));
  }, Math.max(1, Number(deadlineMs) || IDENTITY_BUDGET.deadlineMs));
  return {
    signal: controller.signal,
    get timedOut() { return timedOut; },
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.("abort", forwardAbort);
    },
  };
}

function coverageEntry(source, status, coverage = null, required = true, message = "") {
  return { source, status, coverage, required, message };
}

function combineCoverage(first, second) {
  if (!second) return first;
  const complete = !first?.candidateLimitHit
    && !second?.candidateLimitHit
    && !first?.matchingLimitReached
    && !second?.matchingLimitReached
    && !second?.hasNextPage;
  return {
    ...second,
    complete,
    candidateLimitHit: Boolean(first?.candidateLimitHit || second?.candidateLimitHit),
    matchingLimitReached: Boolean(first?.matchingLimitReached || second?.matchingLimitReached),
    pagesExamined: 2,
  };
}

function nextPageRequest(request) {
  const page = (request?.page ?? 1) + 1;
  if (request?.kind === "text") {
    return buildOfficialTextSearchRequest(request.query, {
      codePostal: request.codePostal,
      page,
      perPage: request.perPage,
      matchingLimit: request.matchingLimit,
    });
  }
  if (request?.kind === "nearby") {
    return buildOfficialNearbySearchRequest({
      latitude: request.latitude,
      longitude: request.longitude,
      radius: request.radius,
      page,
      perPage: request.perPage,
      matchingLimit: request.matchingLimit,
    });
  }
  return null;
}

function mergeCandidates(target, additions) {
  const bySiret = new Map((target ?? []).map(item => [normalizeIdentifier(item?.siret), item]));
  for (const item of additions ?? []) {
    const siret = normalizeIdentifier(item?.siret);
    if (!siret) continue;
    if (!bySiret.has(siret)) {
      bySiret.set(siret, item);
      continue;
    }
    const existing = bySiret.get(siret);
    const aliases = [...new Set([...(existing.aliases ?? []), ...(item.aliases ?? [])])];
    bySiret.set(siret, { ...existing, aliases, observations: [...(existing.observations ?? [existing]), ...(item.observations ?? [item])] });
  }
  return [...bySiret.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
}

function locationAnchor(row, geocodeCandidate) {
  return usableCoordinates(row?.Latitude, row?.Longitude)
    || usableCoordinates(geocodeCandidate?.latitude, geocodeCandidate?.longitude);
}

function isDecisive(decision) {
  return decision?.status === IDENTITY_STATES.MATCH_VERIFIED || decision?.status === IDENTITY_STATES.MATCH_PROBABLE;
}

function shouldContinue(decision) {
  return !isDecisive(decision);
}

export async function resolveStructureIdentity({
  row,
  signal,
  geocode,
  fetchOfficial,
  findPoiLinks = null,
  deadlineMs = IDENTITY_BUDGET.deadlineMs,
  maxOfficialRequests = IDENTITY_BUDGET.maxOfficialRequests,
  onProgress,
  onEvent,
} = {}) {
  if (!row) throw new Error("Fiche Grist absente.");
  if (typeof fetchOfficial !== "function") throw new Error("Client Annuaire absent.");

  const deadline = createDeadline(signal, deadlineMs);
  const coverage = new Map();
  const requests = [];
  const diagnostics = [];
  const identifiers = identifierParts(row.SirenSiret);
  let officialRequestCount = 0;
  let paginationPages = 0;
  let candidates = [];
  let links = [];
  let geocodeCandidates = [];
  let selectedGeocode = null;

  const performOfficial = async (request, source, { required = true, paginate = false } = {}) => {
    if (!request) return [];
    if (officialRequestCount >= maxOfficialRequests) {
      coverage.set(source, coverageEntry(source, "error", { complete: false }, required, "Budget Annuaire atteint"));
      diagnostics.push("Budget Annuaire atteint avant la fin de l’analyse.");
      return [];
    }
    requests.push({ source, kind: request.kind, url: request.url });
    officialRequestCount += 1;
    try {
      const first = await boundedSource(source, sourceSignal => fetchOfficial(request, { signal: sourceSignal, onEvent }),
        { signal: deadline.signal, timeoutMs: IDENTITY_BUDGET.requestMs, onEvent });
      let items = first?.items ?? [];
      let combined = first?.coverage ?? { complete: true };
      if (paginate && combined?.hasNextPage && paginationPages < IDENTITY_BUDGET.maxPaginationPages && officialRequestCount < maxOfficialRequests) {
        const secondRequest = nextPageRequest(request);
        if (secondRequest) {
          paginationPages += 1;
          officialRequestCount += 1;
          requests.push({ source: `${source}:page2`, kind: secondRequest.kind, url: secondRequest.url });
          const second = await boundedSource(`${source}:page2`, sourceSignal => fetchOfficial(secondRequest, { signal: sourceSignal, onEvent }),
            { signal: deadline.signal, timeoutMs: IDENTITY_BUDGET.requestMs, onEvent });
          items = mergeCandidates(items, second?.items ?? []);
          combined = combineCoverage(combined, second?.coverage ?? null);
        }
      }
      coverage.set(source, coverageEntry(source, "ok", combined, required));
      return items;
    } catch (error) {
      if (signal?.aborted) throw makeAbortError();
      if (deadline.timedOut || error?.name === "TimeoutError") {
        coverage.set(source, coverageEntry(source, "timeout", { complete: false }, required, "Délai dépassé"));
        diagnostics.push(`${source} : délai dépassé.`);
        return [];
      }
      if (error?.name === "AbortError") throw error;
      coverage.set(source, coverageEntry(source, "error", { complete: false }, required, error?.message || "Erreur"));
      diagnostics.push(`${source} : ${error?.message || "indisponible"}`);
      return [];
    }
  };

  const performGeocode = async () => {
    if (!String(row.Adresse ?? "").trim() || typeof geocode !== "function") return [];
    try {
      const result = await boundedSource("ign:discovery", sourceSignal => geocode(row.Adresse, { signal: sourceSignal, limit: 3 }),
        { signal: deadline.signal, timeoutMs: IDENTITY_BUDGET.geocodeMs, onEvent });
      coverage.set("ign:discovery", coverageEntry("ign:discovery", "ok", { complete: true }, false));
      return result;
    } catch (error) {
      if (signal?.aborted) throw makeAbortError();
      if (deadline.timedOut || error?.name === "TimeoutError") {
        coverage.set("ign:discovery", coverageEntry("ign:discovery", "timeout", { complete: false }, true, "Découverte d’adresse indisponible"));
        diagnostics.push("IGN : délai dépassé.");
        return [];
      }
      if (error?.name === "AbortError") throw error;
      coverage.set("ign:discovery", coverageEntry("ign:discovery", "error", { complete: false }, true, error.message));
      diagnostics.push(`IGN : ${error?.message || "indisponible"}`);
      return [];
    }
  };

  const checkpoint = decision => {
    const result = { decision, candidates, displayCandidates: decisionCandidates(decision), geocodeCandidates, selectedGeocode,
      links, coverage: [...coverage.values()], requests, diagnostics };
    if (!signal?.aborted) onProgress?.(result);
    return result;
  };

  try {
    const location = extractLocationFromAddress(row.Adresse);
    const initialQuery = identitySearchName(row);
    const initialRequest = initialQuery
      ? buildOfficialTextSearchRequest(initialQuery, { codePostal: location.codePostal })
      : identifiers.identifier ? buildOfficialIdentifierSearchRequest(identifiers.identifier) : null;
    const initialOfficial = initialRequest ? await performOfficial(initialRequest,
      initialQuery ? "annuaire:text" : "annuaire:identifier-hint", { paginate: Boolean(initialQuery), required: true }) : [];
    candidates = mergeCandidates(candidates, initialOfficial);

    let anchor = locationAnchor(row, null);
    let decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
    checkpoint(decision);

    if (isDecisive(decision) || deadline.timedOut) {
      return { decision, candidates, displayCandidates: decisionCandidates(decision), geocodeCandidates, selectedGeocode, links, coverage: [...coverage.values()], requests, diagnostics };
    }

    // With a public name, the entered identifier is corroboration only. It
    // does not trigger a second lookup or constrain discovery. Source-published
    // identifiers are still revalidated explicitly when they supply a bridge.
    // A known site address already supports the identity decision. Waiting for
    // an optional street geocode would consume the budget for stronger registry proof.
    const geocoded = await performGeocode();
    geocodeCandidates = Array.isArray(geocoded) ? geocoded : [];
    selectedGeocode = geocodeCandidates[0] ?? null;
    anchor = locationAnchor(row, selectedGeocode);
    decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
    checkpoint(decision);
    if (isDecisive(decision)) {
      return { decision, candidates, displayCandidates: decisionCandidates(decision), geocodeCandidates, selectedGeocode, links, coverage: [...coverage.values()], requests, diagnostics };
    }

    if (anchor && officialRequestCount < maxOfficialRequests) {
      const rowCoordinates = usableCoordinates(row.Latitude, row.Longitude);
      const radius = rowCoordinates ? 0.3 : 0.5;
      const nearby = await performOfficial(
        buildOfficialNearbySearchRequest({ latitude: anchor.latitude, longitude: anchor.longitude, radius }),
        "annuaire:nearby",
        { paginate: true, required: true },
      );
      candidates = mergeCandidates(candidates, nearby);
      decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
      checkpoint(decision);
      if (isDecisive(decision)) {
        return { decision, candidates, displayCandidates: decisionCandidates(decision), geocodeCandidates, selectedGeocode, links, coverage: [...coverage.values()], requests, diagnostics };
      }
    }

    if (anchor && typeof findPoiLinks === "function" && shouldContinue(decision)) {
      try {
        const poiResult = await boundedSource("osm:identity", sourceSignal => findPoiLinks({ row, latitude: anchor.latitude, longitude: anchor.longitude, radius: 500, signal: sourceSignal }),
          { signal: deadline.signal, timeoutMs: IDENTITY_BUDGET.poiMs, onEvent });
        coverage.set("osm:identity", coverageEntry("osm:identity", "ok", { complete: poiResult?.complete !== false }, false));
        const pois = Array.isArray(poiResult?.candidates) ? poiResult.candidates : [];
        const seen = new Set();
        for (const poi of pois) {
          const siret = normalizeIdentifier(poi?.siret);
          if (siret.length !== 14 || seen.has(siret) || seen.size >= IDENTITY_BUDGET.maxPoiSiretsToValidate) continue;
          seen.add(siret);
          if (officialRequestCount >= maxOfficialRequests) break;
          const verified = await performOfficial(
            buildOfficialIdentifierSearchRequest(siret),
            `annuaire:verify:${siret}`,
            { paginate: false, required: true },
          );
          const exact = verified.find(item => normalizeIdentifier(item?.siret) === siret);
          if (!exact) continue;
          candidates = mergeCandidates(candidates, [exact]);
          links = [...links, { ...poi, siret, verifiedOfficial: true }];
        }
      } catch (error) {
        if (signal?.aborted) throw makeAbortError();
        if (error?.name === "AbortError" && !deadline.timedOut) throw error;
        coverage.set("osm:identity", coverageEntry("osm:identity", error?.name === "TimeoutError" ? "timeout" : "error", { complete: false }, false, error?.message || "OSM indisponible"));
        diagnostics.push(`OSM identité : ${error?.message || "indisponible"}`);
      }
      decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
    }

    if (deadline.timedOut && decision.status !== IDENTITY_STATES.MATCH_VERIFIED) {
      decision = {
        ...decision,
        status: IDENTITY_STATES.INCOMPLETE,
        reason: "Les sources nécessaires n’ont pas répondu dans leur budget ; les informations déjà reçues sont conservées.",
      };
    }

    return checkpoint(decision);
  } finally {
    deadline.cleanup();
  }
}
