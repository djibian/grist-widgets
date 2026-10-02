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

export const IDENTITY_BUDGET = Object.freeze({
  maxOfficialRequests: 6,
  maxPaginationPages: 1,
  maxPoiSiretsToValidate: 2,
  deadlineMs: 12000,
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
      const first = await fetchOfficial(request, { signal: deadline.signal });
      let items = first?.items ?? [];
      let combined = first?.coverage ?? { complete: true };
      if (paginate && combined?.hasNextPage && paginationPages < IDENTITY_BUDGET.maxPaginationPages && officialRequestCount < maxOfficialRequests) {
        const secondRequest = nextPageRequest(request);
        if (secondRequest) {
          paginationPages += 1;
          officialRequestCount += 1;
          requests.push({ source: `${source}:page2`, kind: secondRequest.kind, url: secondRequest.url });
          const second = await fetchOfficial(secondRequest, { signal: deadline.signal });
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
      return await geocode(row.Adresse, { signal: deadline.signal, limit: 3 });
    } catch (error) {
      if (signal?.aborted) throw makeAbortError();
      if (deadline.timedOut || error?.name === "TimeoutError") {
        diagnostics.push("IGN : délai dépassé.");
        return [];
      }
      if (error?.name === "AbortError") throw error;
      diagnostics.push(`IGN : ${error?.message || "indisponible"}`);
      return [];
    }
  };

  try {
    const location = extractLocationFromAddress(row.Adresse);
    const initialQuery = identitySearchName(row);
    let initialOfficialPromise;
    let sirenValidationPromise = null;

    if (identifiers.siret) {
      initialOfficialPromise = performOfficial(
        buildOfficialIdentifierSearchRequest(identifiers.siret),
        "annuaire:siret",
        { paginate: false, required: true },
      );
    } else {
      initialOfficialPromise = initialQuery
        ? performOfficial(
            buildOfficialTextSearchRequest(initialQuery, { codePostal: location.codePostal }),
            "annuaire:text",
            { paginate: true, required: true },
          )
        : Promise.resolve([]);
      if (identifiers.siren) {
        sirenValidationPromise = performOfficial(
          buildOfficialIdentifierSearchRequest(identifiers.siren),
          "annuaire:siren",
          { paginate: false, required: true },
        );
      }
    }

    const [initialOfficial, sirenValidation] = await Promise.all([
      initialOfficialPromise,
      sirenValidationPromise ?? Promise.resolve([]),
    ]);

    candidates = mergeCandidates(candidates, initialOfficial);

    if (identifiers.siren && !identifiers.siret) {
      const sirenCoverage = coverage.get("annuaire:siren")?.coverage;
      const validated = (sirenCoverage?.unitSirens ?? []).some(value => normalizeIdentifier(value) === identifiers.siren)
        || (sirenValidation ?? []).some(item => normalizeIdentifier(item?.siren) === identifiers.siren);
      if (!validated) {
        coverage.set("annuaire:siren", coverageEntry("annuaire:siren", "error", { ...(sirenCoverage ?? {}), complete: false }, true, "SIREN non revalidé"));
      }
      candidates = candidates.filter(item => normalizeIdentifier(item?.siren) === identifiers.siren);
    }

    let anchor = locationAnchor(row, null);
    let decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });

    if (isDecisive(decision)) {
      return { decision, candidates, displayCandidates: decisionCandidates(decision), geocodeCandidates, selectedGeocode, links, coverage: [...coverage.values()], requests, diagnostics };
    }

    // A known site address already supports the identity decision. Waiting for
    // an optional street geocode would consume the budget for stronger registry proof.
    const geocoded = await performGeocode();
    geocodeCandidates = Array.isArray(geocoded) ? geocoded : [];
    selectedGeocode = geocodeCandidates[0] ?? null;
    anchor = locationAnchor(row, selectedGeocode);
    decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
    if (isDecisive(decision)) {
      return { decision, candidates, displayCandidates: decisionCandidates(decision), geocodeCandidates, selectedGeocode, links, coverage: [...coverage.values()], requests, diagnostics };
    }

    if (anchor && !identifiers.siret && officialRequestCount < maxOfficialRequests) {
      const rowCoordinates = usableCoordinates(row.Latitude, row.Longitude);
      const radius = rowCoordinates ? 0.3 : 0.5;
      const nearby = await performOfficial(
        buildOfficialNearbySearchRequest({ latitude: anchor.latitude, longitude: anchor.longitude, radius }),
        "annuaire:nearby",
        { paginate: true, required: true },
      );
      candidates = mergeCandidates(candidates, identifiers.siren
        ? nearby.filter(item => normalizeIdentifier(item?.siren) === identifiers.siren)
        : nearby);
      decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
      if (isDecisive(decision)) {
        return { decision, candidates, displayCandidates: decisionCandidates(decision), geocodeCandidates, selectedGeocode, links, coverage: [...coverage.values()], requests, diagnostics };
      }
    }

    if (anchor && typeof findPoiLinks === "function" && shouldContinue(decision)) {
      try {
        const poiResult = await findPoiLinks({ row, latitude: anchor.latitude, longitude: anchor.longitude, radius: 500, signal: deadline.signal });
        coverage.set("osm:identity", coverageEntry("osm:identity", "ok", { complete: poiResult?.complete !== false }, true));
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
          links.push({ ...poi, siret, verifiedOfficial: true });
        }
      } catch (error) {
        if (signal?.aborted) throw makeAbortError();
        if (error?.name === "AbortError" && !deadline.timedOut) throw error;
        coverage.set("osm:identity", coverageEntry("osm:identity", deadline.timedOut ? "timeout" : "error", { complete: false }, true, error?.message || "OSM indisponible"));
        diagnostics.push(`OSM identité : ${error?.message || "indisponible"}`);
      }
      decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
    }

    if (deadline.timedOut && decision.status !== IDENTITY_STATES.MATCH_VERIFIED) {
      decision = {
        ...decision,
        status: IDENTITY_STATES.INCOMPLETE,
        reason: "Le délai maximal de l’analyse a été atteint avant de réunir toutes les preuves nécessaires.",
      };
    }

    return {
      decision,
      candidates,
      displayCandidates: decisionCandidates(decision),
      geocodeCandidates,
      selectedGeocode,
      links,
      coverage: [...coverage.values()],
      requests,
      diagnostics,
    };
  } finally {
    deadline.cleanup();
  }
}
