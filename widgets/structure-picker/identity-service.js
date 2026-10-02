import { fetchOfficialRequest } from "./enterprise-client.js";
import { IDENTITY_BUDGET, resolveStructureIdentity } from "./identity-orchestrator.js";
import { IDENTITY_STATES, decideIdentity, decisionCandidates } from "./identity-resolution.js";
import { findPublishedIdentityLinks } from "./published-identity-links.js";
import { findFinessIdentityLinks, FINESS_BUDGET } from "./finess-identity.js";
import {
  buildOfficialIdentifierSearchRequest,
  buildOfficialTextSearchRequest,
  normalizeIdentifier,
} from "./search.js";

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function publishedCoverage(status = "ok", message = "") {
  return {
    source: "published-identity",
    status,
    required: true,
    coverage: { complete: status === "ok" },
    message,
  };
}

function officialCoverage(source, result) {
  return {
    source,
    status: "ok",
    required: true,
    coverage: result?.coverage ?? { complete: true },
    message: "",
  };
}

function exactCandidate(result, siret) {
  return (result?.items ?? []).find(item => normalizeIdentifier(item?.siret) === siret) ?? null;
}

function publishedVerificationRequests(link, siret) {
  const requests = [];
  const identifier = buildOfficialIdentifierSearchRequest(siret);
  if (identifier) requests.push(identifier);
  const legalName = String(link?.legalName ?? "").trim();
  if (legalName) {
    const text = buildOfficialTextSearchRequest(legalName, {
      codePostal: String(link?.postcode ?? "").trim(),
      perPage: 25,
      matchingLimit: 100,
    });
    if (text) requests.push(text);
  }
  return requests;
}

async function completeSectorProof({ row, signal, fallback, fetchOfficial, freshOfficial, findSectorLinks, deadlineMs }) {
  const eligible = (fallback.decision?.certificates ?? [])
    .filter(item => item.level === "probable" && item.admissible && !item.conflict)
    .map(item => item.candidate).filter(item => item.finessIds?.length);
  if (!eligible.length || typeof findSectorLinks !== "function" || deadlineMs <= 0) return fallback;
  // Do not choose a subset by proximity or ranking, or reuse a FINESS associated
  // with several SIRETs in the official results.
  const all = fallback.candidates ?? eligible;
  const remainingRequests = IDENTITY_BUDGET.maxOfficialRequests
    - (fallback.requests ?? []).filter(item => item.source?.startsWith("annuaire:")).length;
  if (eligible.length > FINESS_BUDGET.maxCandidates
    || eligible.filter(candidate => !freshOfficial.has(candidate.siret)).length > remainingRequests
    || eligible.some(candidate =>
    candidate.finessIds.length > FINESS_BUDGET.maxIdsPerCandidate
    || candidate.finessIds.some(id => new Set(all.filter(item => item.finessIds?.includes(id)).map(item => item.siret)).size > 1))) {
    return { ...fallback, diagnostics: [...(fallback.diagnostics ?? []), "FINESS : rattachement non unique ou budget de consultation dépassé."] };
  }

  const controller = new AbortController();
  const requests = [];
  let timer;
  let onAbort;
  const stopped = new Promise((resolve, reject) => {
    onAbort = () => { controller.abort(signal.reason); reject(abortError()); };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new DOMException("Preuve FINESS hors délai", "TimeoutError");
      controller.abort(error);
      reject(error);
    }, deadlineMs);
  });
  const prove = async () => {
    if (controller.signal.aborted) throw abortError();
    const sector = await findSectorLinks({ row, candidates: eligible, signal: controller.signal });
    if (controller.signal.aborted) throw abortError();
    requests.push(...(sector.requests ?? []));
    const links = [];
    const refreshed = new Map();
    const coverage = [...(fallback.coverage ?? [])];
    // One fresh official request per SIRET, even if it has several FINESS IDs.
    for (const siret of new Set((sector.links ?? []).map(link => link.siret))) {
      if (!eligible.some(candidate => candidate.siret === siret)) continue;
      if (controller.signal.aborted) throw abortError();
      const source = `annuaire:finess:${siret}`;
      let current = freshOfficial.get(siret);
      if (!current) {
        const request = buildOfficialIdentifierSearchRequest(siret);
        if (!request) continue;
        requests.push({ source, kind: request.kind, url: request.url });
        const result = await fetchOfficial(request, { signal: controller.signal, cacheTtlMs: 0 });
        current = { candidate: exactCandidate(result, siret), result, request, checkedAt: new Date().toISOString() };
      }
      if (controller.signal.aborted) throw abortError();
      const exact = current.candidate;
      if (!exact || exact.etatAdministratif !== "A") continue;
      coverage.push(officialCoverage(source, current.result));
      for (const link of sector.links.filter(item => item.siret === siret)) {
        if (!exact.finessIds?.includes(link.sourceRecordId)) continue;
        links.push({
          ...link, verifiedOfficial: true,
          officialBinding: {
            siret: exact.siret, finessIds: [...exact.finessIds], adresse: exact.adresse,
            checkedAt: current.checkedAt, url: current.request.url,
          },
        });
      }
      refreshed.set(siret, exact);
    }
    if (!links.length) return { ...fallback, requests: [...(fallback.requests ?? []), ...requests] };
    const candidates = (fallback.candidates ?? []).filter(item => !refreshed.has(item.siret)).concat([...refreshed.values()]);
    const combinedLinks = [...(fallback.links ?? []), ...links];
    const decision = decideIdentity({ row, candidates, links: combinedLinks, coverage, location: fallback.selectedGeocode });
    return {
      ...fallback, decision, candidates, displayCandidates: decisionCandidates(decision), links: combinedLinks,
      coverage, requests: [...(fallback.requests ?? []), ...requests],
    };
  };
  try {
    return await Promise.race([prove(), stopped]);
  } catch (error) {
    if (signal?.aborted) throw abortError();
    // Missing, incompatible or unavailable sector proof must preserve abstention,
    // not discard the probable candidate or consume the global identity deadline.
    controller.abort(error);
    return {
      ...fallback, requests: [...(fallback.requests ?? []), ...requests],
      diagnostics: [...(fallback.diagnostics ?? []), `FINESS : ${error.message || "preuve indisponible"}`],
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function resolveIdentityForEnrichment({
  row,
  signal,
  geocode,
  fetchOfficial = fetchOfficialRequest,
  findPublishedLinks = findPublishedIdentityLinks,
  findSectorLinks = findFinessIdentityLinks,
  resolveFallback = resolveStructureIdentity,
} = {}) {
  if (!row) throw new Error("Fiche Grist absente.");
  const startedAt = Date.now();
  const diagnostics = [];
  let publishedFailed = false;

  if (!String(row.SirenSiret ?? "").trim() && typeof findPublishedLinks === "function") {
    try {
      const published = await findPublishedLinks({ row, signal });
      const links = Array.isArray(published?.candidates) ? published.candidates.slice(0, 2) : [];
      for (const link of links) {
        const siret = normalizeIdentifier(link?.siret);
        if (siret.length !== 14) continue;

        const attempts = publishedVerificationRequests(link, siret);
        let exact = null;
        let verified = null;
        let verifiedRequest = null;
        let successfulAttempt = false;

        for (const request of attempts) {
          try {
            const result = await fetchOfficial(request, { signal, cacheTtlMs: 0 });
            successfulAttempt = true;
            const candidate = exactCandidate(result, siret);
            if (!candidate) continue;
            exact = candidate;
            verified = result;
            verifiedRequest = request;
            break;
          } catch (error) {
            if (signal?.aborted || error?.name === "AbortError") throw abortError();
            diagnostics.push(`Revalidation Annuaire (${request.kind}) : ${error?.message || "indisponible"}`);
          }
        }

        if (!exact) {
          if (!successfulAttempt && attempts.length) publishedFailed = true;
          continue;
        }

        const verifiedLink = { ...link, siret, verifiedOfficial: true };
        const source = `annuaire:verify:${siret}:${verifiedRequest.kind}`;
        const coverage = [publishedCoverage(), officialCoverage(source, verified)];
        const decision = decideIdentity({ row, candidates: [exact], links: [verifiedLink], coverage });
        if (decision.status === IDENTITY_STATES.MATCH_VERIFIED) {
          return {
            decision,
            candidates: [exact],
            displayCandidates: decisionCandidates(decision),
            geocodeCandidates: [],
            selectedGeocode: null,
            links: [verifiedLink],
            coverage,
            requests: [{ source, kind: verifiedRequest.kind, url: verifiedRequest.url }],
            diagnostics,
          };
        }
      }
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw abortError();
      publishedFailed = true;
      diagnostics.push(`Références publiées : ${error?.message || "indisponibles"}`);
    }
  }

  const freshOfficial = new Map();
  let fallback = await resolveFallback({ row, signal, geocode, fetchOfficial: async (request, options) => {
    const result = await fetchOfficial(request, options);
    if (result?.cached === false) {
      for (const candidate of result.items ?? []) {
        freshOfficial.set(candidate.siret, { candidate, result, request, checkedAt: new Date().toISOString() });
      }
    }
    return result;
  } });
  if (fallback?.decision?.status !== IDENTITY_STATES.MATCH_VERIFIED) {
    fallback = await completeSectorProof({
      row, signal, fallback, fetchOfficial, freshOfficial, findSectorLinks,
      deadlineMs: Math.min(FINESS_BUDGET.deadlineMs, IDENTITY_BUDGET.deadlineMs - (Date.now() - startedAt) - 100),
    });
  }
  const combinedDiagnostics = [...diagnostics, ...(fallback?.diagnostics ?? [])];
  if (publishedFailed && ![IDENTITY_STATES.MATCH_VERIFIED, IDENTITY_STATES.MATCH_PROBABLE].includes(fallback?.decision?.status)) {
    return {
      ...fallback,
      decision: {
        ...fallback.decision,
        status: IDENTITY_STATES.INCOMPLETE,
        reason: "Une source de liaison d’identité publiée est indisponible ; l’analyse ne peut pas exclure qu’elle contienne la preuve manquante.",
      },
      diagnostics: combinedDiagnostics,
    };
  }
  return { ...fallback, diagnostics: combinedDiagnostics };
}
