import {
  buildOfficialIdentifierSearchRequest,
  buildOfficialNearbySearchRequest,
  buildOfficialTextSearchRequest,
  extractLocationFromAddress,
  identifierParts,
  normalizeIdentifier, normalize,
} from "./search.js";
import {
  IDENTITY_STATES,
  decideIdentity,
  decisionCandidates,
  identitySearchName,
  usableCoordinates,
} from "./identity-resolution.js";
import { boundedSource } from "./bounded-source.js";
import { planIdentityExpansion } from "./identity-expansion.js";

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
    pagesExamined: (first?.pagesExamined ?? 1) + (second?.pagesExamined ?? 1),
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
  maxPaginationPages = IDENTITY_BUDGET.maxPaginationPages,
  deepening = false,
  guidance = null,
  onProgress,
  onEvent,
} = {}) {
  if (!row) throw new Error("Fiche Grist absente.");
  if (typeof fetchOfficial !== "function") throw new Error("Client Annuaire absent.");

  const deadline = createDeadline(signal, deadlineMs);
  const coverage = new Map();
  const requests = [];
  const seenUrls = new Set();
  const diagnostics = [];
  const identifiers = identifierParts(row.SirenSiret);
  let officialRequestCount = 0;
  let paginationPages = 0;
  let candidates = [];
  let identifierLegalNames = [];
  let links = [];
  let geocodeCandidates = [];
  let selectedGeocode = null;
  let discoveryAnchor = null;
  let activeDiscoveryAddress = null;

  const performOfficial = async (request, source, { required = true, paginate = false } = {}) => {
    if (!request || seenUrls.has(request.url)) return [];
    if (officialRequestCount >= maxOfficialRequests) {
      coverage.set(source, coverageEntry(source, "error", { complete: false }, required, "Budget Annuaire atteint"));
      diagnostics.push("Budget Annuaire atteint avant la fin de l’analyse.");
      return [];
    }
    seenUrls.add(request.url);
    requests.push({ source, kind: request.kind, url: request.url });
    officialRequestCount += 1;
    try {
      const first = await boundedSource(source, sourceSignal => fetchOfficial(request, { signal: sourceSignal, onEvent }),
        { signal: deadline.signal, timeoutMs: IDENTITY_BUDGET.requestMs, onEvent });
      let items = first?.items ?? [];
      let combined = first?.coverage ?? { complete: true };
      if (request.kind === "siren" || request.kind === "siret") {
        const siren = identifierParts(request.identifier).siren;
        const published = (combined.identifierLegalNames ?? [])
          .filter(item => normalizeIdentifier(item?.siren) === siren && normalize(item?.legalName).length >= 3);
        identifierLegalNames = [...new Map(
          [...identifierLegalNames, ...published].map(item => [item.siren + ":" + normalize(item.legalName), item]),
        ).values()].slice(0, 8);
      }
      let pageRequest = request;
      while (paginate && combined?.hasNextPage && paginationPages < maxPaginationPages &&
        officialRequestCount < maxOfficialRequests && !deadline.signal.aborted) {
        const next = nextPageRequest(pageRequest);
        if (!next || seenUrls.has(next.url)) break;
        pageRequest = next;
        seenUrls.add(next.url);
        paginationPages += 1;
        officialRequestCount += 1;
        const pageSource = `${source}:page${next.page}`;
        requests.push({ source: pageSource, kind: next.kind, url: next.url });
        try {
          const result = await boundedSource(pageSource, sourceSignal => fetchOfficial(next, { signal: sourceSignal, onEvent }),
            { signal: deadline.signal, timeoutMs: IDENTITY_BUDGET.requestMs, onEvent });
          items = mergeCandidates(items, result?.items ?? []);
          combined = combineCoverage(combined, result?.coverage ?? null);
        } catch (error) {
          if (signal?.aborted) throw makeAbortError();
          combined = { ...combined, complete: false, hasNextPage: true };
          diagnostics.push(`${pageSource} : ${error?.message || "indisponible"}`);
          break;
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

  const performGeocode = async address => {
    if (!String(address ?? "").trim() || typeof geocode !== "function") return [];
    try {
      const result = await boundedSource("ign:discovery", sourceSignal => geocode(address, { signal: sourceSignal, limit: 3 }),
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
    // A new teacher clue changes the FIRST lookup, not only the final
    // expansion phase. Original row data remains untouched for decideIdentity.
    const selectedHint = field => guidance?.selected?.find(item => item.field === field)?.value || "";
    const guidedAddress = selectedHint("address");
    const guidedCommune = normalize(selectedHint("commune"));
    const location = extractLocationFromAddress(guidedAddress || row.Adresse);
    const initialQuery = normalize(selectedHint("name") || selectedHint("operator") || identitySearchName(row));
    const focusedQuery = guidedCommune && initialQuery
      ? initialQuery + " " + guidedCommune : initialQuery;
    // A corrected/confirmed commune can contradict the old site's postcode.
    const focusedPostalCode = guidedCommune && !guidedAddress ? "" : location.codePostal;
    const initialIdentifier = selectedHint("siret") || identifiers.identifier;
    const initialRequest = focusedQuery
      ? buildOfficialTextSearchRequest(focusedQuery, { codePostal: focusedPostalCode })
      : initialIdentifier ? buildOfficialIdentifierSearchRequest(initialIdentifier) : null;
    const initialOfficial = initialRequest ? await performOfficial(initialRequest,
      focusedQuery ? "annuaire:text" : "annuaire:identifier-hint", { paginate: Boolean(focusedQuery), required: true }) : [];
    candidates = mergeCandidates(candidates, initialOfficial);

    let anchor = locationAnchor(row, null);
    let decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
    checkpoint(decision);

    if ((deepening ? decision.status === IDENTITY_STATES.MATCH_VERIFIED : isDecisive(decision)) || deadline.timedOut) {
      return { decision, candidates, displayCandidates: decisionCandidates(decision), geocodeCandidates, selectedGeocode, links, coverage: [...coverage.values()], requests, diagnostics };
    }

    const legalHint=normalize(row.RaisonSociale);
    if(legalHint.length>=3 && legalHint!==initialQuery && officialRequestCount<maxOfficialRequests){
      const legal=await performOfficial(buildOfficialTextSearchRequest(legalHint,{codePostal:focusedPostalCode}),"annuaire:legal-hint",{required:false});
      candidates=mergeCandidates(candidates,legal);
      decision=decideIdentity({row,candidates,links,coverage:[...coverage.values()],location:anchor});
      checkpoint(decision);
      if(deepening ? decision.status === IDENTITY_STATES.MATCH_VERIFIED : isDecisive(decision))return checkpoint(decision);
    }

    // With a public name, the entered identifier is corroboration only. It
    // does not trigger a second lookup or constrain discovery. Source-published
    // identifiers are still revalidated explicitly when they supply a bridge.
    // A known site address already supports the identity decision. Waiting for
    // an optional street geocode would consume the budget for stronger registry proof.
    // A corrected address is a search clue, not an official position or site
    // attestation. Keep discovery geography separate from certificate geography.
    const discoveryAddress = () => String(
      guidance?.selected?.find(item => item.field === "address")?.value || row.Adresse || "",
    ).trim();
    const refreshDiscoveryLocation = async () => {
      const address = discoveryAddress();
      if (address === activeDiscoveryAddress) return false;
      activeDiscoveryAddress = address;
      const guided = normalize(address) !== normalize(row.Adresse);
      const geocoded = await performGeocode(address);
      geocodeCandidates = Array.isArray(geocoded) ? geocoded : [];
      const found = geocodeCandidates[0] ?? null;
      // Never export a teacher-corrected geocode as the selected official
      // location: the coordinator also uses selectedGeocode for evidence.
      selectedGeocode = guided ? null : found;
      anchor = locationAnchor(row, selectedGeocode);
      discoveryAnchor = guided
        ? usableCoordinates(found?.latitude, found?.longitude) || anchor
        : anchor;
      return true;
    };
    await refreshDiscoveryLocation();
    decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
    checkpoint(decision);
    if (deepening ? decision.status === IDENTITY_STATES.MATCH_VERIFIED : isDecisive(decision)) {
      return { decision, candidates, displayCandidates: decisionCandidates(decision), geocodeCandidates, selectedGeocode, links, coverage: [...coverage.values()], requests, diagnostics };
    }

    if (discoveryAnchor && officialRequestCount < maxOfficialRequests) {
      const rowCoordinates = usableCoordinates(row.Latitude, row.Longitude);
      const radius = rowCoordinates && discoveryAnchor === anchor ? 0.3 : 0.5;
      const nearby = await performOfficial(
        buildOfficialNearbySearchRequest({ latitude: discoveryAnchor.latitude, longitude: discoveryAnchor.longitude, radius }),
        "annuaire:nearby",
        { paginate: true, required: true },
      );
      candidates = mergeCandidates(candidates, nearby);
      decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
      checkpoint(decision);
      if (deepening ? decision.status === IDENTITY_STATES.MATCH_VERIFIED : isDecisive(decision)) {
        return { decision, candidates, displayCandidates: decisionCandidates(decision), geocodeCandidates, selectedGeocode, links, coverage: [...coverage.values()], requests, diagnostics };
      }
    }

    if (discoveryAnchor && typeof findPoiLinks === "function" && (deepening ? decision.status !== IDENTITY_STATES.MATCH_VERIFIED : shouldContinue(decision))) {
      try {
        const poiResult = await boundedSource("osm:identity", sourceSignal => findPoiLinks({ row, latitude: discoveryAnchor.latitude, longitude: discoveryAnchor.longitude, radius: 500, signal: sourceSignal }),
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

    if (deepening && decision.status !== IDENTITY_STATES.MATCH_VERIFIED && !deadline.signal.aborted) {
      // Rebuild the remaining plan after each checkpoint: a field chosen by a
      // teacher during an in-flight request affects the next actual lookup.
      let expansionIndex = 0;
      while (!deadline.signal.aborted && officialRequestCount < maxOfficialRequests) {
        // An address corrected while HTTP requests were in flight must redirect
        // the very next geographic lookup without restarting the whole analysis.
        if (discoveryAddress() !== activeDiscoveryAddress) {
          await refreshDiscoveryLocation();
          if (discoveryAnchor && officialRequestCount < maxOfficialRequests) {
            const redirected = await performOfficial(
              buildOfficialNearbySearchRequest({
                latitude: discoveryAnchor.latitude, longitude: discoveryAnchor.longitude, radius: 0.5,
              }),
              "annuaire:guided-nearby", { required: false });
            candidates = mergeCandidates(candidates, redirected);
          }
          decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
          checkpoint(decision);
          if (decision.status === IDENTITY_STATES.MATCH_VERIFIED) break;
        }
        const entry = planIdentityExpansion(row, {
          alreadyRequested: [...seenUrls],
          maxQueries: 1,
          guidance,
          discoveredCandidates: candidates,
          identifierLegalNames,
        })[0];
        if (!entry) break;
        expansionIndex += 1;
        const expanded = await performOfficial(entry.request, `annuaire:expand:${expansionIndex}:${entry.reason}`,
          { required: false, paginate: true });
        // A name search can return other enterprises with the same name.
        // This bridge may discover sites ONLY of the exact looked-up SIREN.
        const newCandidates = entry.boundSiren
          ? expanded.filter(item => normalizeIdentifier(item?.siren) === entry.boundSiren)
          : expanded;
        candidates = mergeCandidates(candidates, newCandidates);
        decision = decideIdentity({ row, candidates, links, coverage: [...coverage.values()], location: anchor });
        checkpoint(decision);
        if (decision.status === IDENTITY_STATES.MATCH_VERIFIED) break;
      }
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
