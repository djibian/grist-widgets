import { fetchOfficialRequest } from "./enterprise-client.js";
import { IDENTITY_BUDGET, resolveStructureIdentity } from "./identity-orchestrator.js";
import { IDENTITY_STATES, decideIdentity, decisionCandidates } from "./identity-resolution.js";
import { findPublishedIdentityLinks } from "./published-identity-links.js";
import { findFinessIdentityLinks, FINESS_BUDGET } from "./finess-identity.js";
import { findOfficialRegistrySites, verifiedRegistryLink } from "./official-site-registry.js";
import { abortable, boundedSource, emitTrace } from "./bounded-source.js";
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

async function resolveBaseIdentity({
  row,
  signal,
  geocode,
  fetchOfficial = fetchOfficialRequest,
  findPublishedLinks = findPublishedIdentityLinks,
  findSectorLinks = findFinessIdentityLinks,
  resolveFallback = resolveStructureIdentity,
  onProgress,
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
  try { onProgress?.(fallback); } catch { /* Diagnostics cannot change a decision. */ }
  if (fallback?.decision?.status !== IDENTITY_STATES.MATCH_VERIFIED) {
    fallback = await completeSectorProof({
      row, signal, fallback, fetchOfficial, freshOfficial, findSectorLinks,
      deadlineMs: Math.min(FINESS_BUDGET.deadlineMs, IDENTITY_BUDGET.deadlineMs - (Date.now() - startedAt) - 300),
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

// A single coordinator owns the evidence and the deadline. Discovery sources
// run independently; the Annuaire remains the authority for each geographic
// SIRET/sector-identifier binding. Completed observations are checkpointed.
export async function resolveIdentityForEnrichment(options = {}) {
  const { row, signal, onProgress, onEvent, findRegistrySites = findOfficialRegistrySites } = options;
  if (!row) throw new Error("Fiche Grist absente.");
  const started = Date.now();
  const trace = [];
  const results = new Map();
  const fresh = new Map();
  const diagnostics = [];
  let registrySettled = typeof findRegistrySites !== "function";
  const sectorFirst = !row.SirenSiret && /\b(ecole|college|lycee|ehpad|residence|ssiad)\b/.test(String(row.NomCommercial).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
  let releaseRegistry;
  const registryReady = new Promise(resolve => { releaseRegistry = resolve; });
  if (registrySettled) releaseRegistry();
  const event = entry => {
    if (trace.length < 160) trace.push({ ...entry, atMs: Date.now() - started });
    emitTrace(onEvent, entry);
  };
  const combine = () => {
    const all = [...results.values()];
    const candidates = all.flatMap(result => result.candidates ?? []);
    const links = all.flatMap(result => result.links ?? []);
    const coverage = all.flatMap(result => result.coverage ?? []);
    const location = all.find(result => result.selectedGeocode)?.selectedGeocode ?? null;
    let decision = decideIdentity({ row, candidates, links, coverage, location });
    if (decision.status === IDENTITY_STATES.NO_MATCH && all.some(result => result.decision?.status === IDENTITY_STATES.INCOMPLETE)) {
      decision = { ...decision, status: IDENTITY_STATES.INCOMPLETE, reason: "Une recherche nécessaire reste incomplète ; aucune identité n’est inventée." };
    }
    const unresolved = all.flatMap(result => result.unresolvedBindings ?? []);
    if (unresolved.length && !row.SirenSiret && decision.status === IDENTITY_STATES.MATCH_VERIFIED) {
      decision = { ...decision, status: IDENTITY_STATES.INCOMPLETE, reason: "Un autre rattachement sectoriel reste à revalider ; aucun choix automatique." };
    }
    const unverifiedSites = all.flatMap(result => result.unverifiedSites ?? []);
    if (!decision.candidate && decision.status === IDENTITY_STATES.INCOMPLETE && unverifiedSites.length === 1) {
      decision = { ...decision, candidate: unverifiedSites[0] };
    }
    return {
      decision, candidates, links, coverage,
      displayCandidates: decisionCandidates(decision), requests: all.flatMap(result => result.requests ?? []),
      geocodeCandidates: all.flatMap(result => result.geocodeCandidates ?? []),
      selectedGeocode: location,
      diagnostics: [...new Set([...diagnostics, ...all.flatMap(result => result.diagnostics ?? [])])], trace,
    };
  };
  let planSignal;
  const update = (key, result) => {
    if (planSignal?.aborted || signal?.aborted || !result) return;
    results.set(key, result);
    try { onProgress?.(combine()); } catch { /* Observers do not own resolution. */ }
  };
  const originalFetch = options.fetchOfficial ?? fetchOfficialRequest;
  const fetchValidated = async (request, requestOptions = {}) => {
    const result = await boundedSource(`annuaire:${request.kind}`, sourceSignal => originalFetch(request, { ...requestOptions, signal: sourceSignal, onEvent: event }),
      { signal: requestOptions.signal ?? planSignal, timeoutMs: IDENTITY_BUDGET.requestMs, onEvent: event });
    if (result.cached === false) for (const candidate of result.items ?? []) fresh.set(candidate.siret, { candidate, result, request, checkedAt: new Date().toISOString() });
    return result;
  };
  try {
    const completed = await boundedSource("identity:plan", async sourceSignal => {
      planSignal = sourceSignal;
      const fallback = options.resolveFallback ?? resolveStructureIdentity;
      const published = options.findPublishedLinks === undefined ? findPublishedIdentityLinks : options.findPublishedLinks;
      const base = (async () => {
        // A known sector registry can supply the geographic SIRET directly.
        // Do not consume the Annuaire's rate-limited slot with a broad public-
        // name query while that bounded, local source is being revalidated.
        if (sectorFirst) await abortable(registryReady, sourceSignal);
        if (sectorFirst && combine().decision.status === IDENTITY_STATES.MATCH_VERIFIED) return null;
        return resolveBaseIdentity({ ...options, signal: sourceSignal, fetchOfficial: fetchValidated, onProgress: result => update("base", result),
        findPublishedLinks: typeof published === "function" ? args => boundedSource("published:discovery", child => published({ ...args, signal: child }),
          { signal: sourceSignal, timeoutMs: 1000, onEvent: event }) : published,
        resolveFallback: args => fallback({ ...args, onEvent: event, onProgress: result => update("base", result),
          deadlineMs: Math.max(1, IDENTITY_BUDGET.deadlineMs - (Date.now() - started) - 300) }),
        });
      })().then(result => { update("base", result); return "base"; }).catch(error => {
        if (!sourceSignal.aborted) diagnostics.push(`Résolution Annuaire : ${error.message}`);
        return "base";
      });
      const registry = (async () => {
        if (typeof findRegistrySites !== "function") return;
        const requests = []; const candidates = []; const links = []; const coverage = []; const unresolvedBindings = []; const unverifiedSites = [];
        try {
          const discovery = await findRegistrySites({ row, signal: sourceSignal, onEvent: event });
          const records = discovery.records ?? [];
          const ids = [...new Set(records.map(record => record.siret).filter(id => /^\d{14}$/.test(id)))];
          if (!discovery.complete || ids.length > 2) {
            diagnostics.push(discovery.message || "Plusieurs sites sectoriels nécessitent une recherche plus précise.");
            coverage.push({ source: "registry:discovery", status: "error", required: true, coverage: { complete: false } });
          } else {
            for (const siret of ids) {
              if (sourceSignal.aborted) return;
              const request = buildOfficialIdentifierSearchRequest(siret);
              requests.push({ source: "annuaire:registry", kind: request.kind, url: request.url });
              try {
                let current = fresh.get(siret);
                if (!current) {
                  const result = await fetchValidated(request, { signal: sourceSignal, cacheTtlMs: 0 });
                  current = { candidate: exactCandidate(result, siret), result, request, checkedAt: new Date().toISOString() };
                }
                if (current.candidate) candidates.push(current.candidate);
                for (const record of records.filter(record => record.siret === siret)) {
                  const link = current.candidate && verifiedRegistryLink(record, current.candidate, { checkedAt: current.checkedAt, url: current.request.url });
                  if (link) links.push(link);
                  else diagnostics.push(`${record.kind} ${record.recordId} : le SIRET, l’adresse ou l’identifiant du site n’est pas revalidé dans l’Annuaire.`);
                }
              } catch (error) {
                if (sourceSignal.aborted) return;
                unresolvedBindings.push(siret);
                diagnostics.push(`Revalidation du site ${siret} : ${error.message}`);
                coverage.push({ source: `annuaire:registry:${siret}`, status: "error", required: true, coverage: { complete: false } });
                for (const record of records.filter(record => record.siret === siret)) unverifiedSites.push({
                  siret, raisonSociale: "", nomCommercial: record.name, aliases: record.publicNames, nomUsuelDistinct: true,
                  adresse: record.adresse, registryOnly: true, registryRecord: record,
                });
              }
              update("registry", { candidates, links, coverage, requests, unresolvedBindings, unverifiedSites });
            }
          }
          if (records.length && !ids.length) diagnostics.push("Le référentiel atteste un site public mais ne fournit pas de SIRET propre revalidable.");
          update("registry", { candidates, links, coverage, requests, unresolvedBindings, unverifiedSites });
        } catch (error) {
          if (!sourceSignal.aborted) {
            diagnostics.push(`Référentiels de sites : ${error.message}`);
            update("registry", { coverage: [{ source: "registry:discovery", status: "error", required: /\b(ecole|college|lycee|ehpad|residence|ssiad)\b/i.test(String(row.NomCommercial).normalize("NFD").replace(/[\u0300-\u036f]/g, "")), coverage: { complete: false } }] });
          }
        } finally { registrySettled = true; releaseRegistry(); }
      })().then(() => "registry");
      const pending = new Map([["base", base], ["registry", registry]]);
      while (pending.size) {
        const name = await Promise.race(pending.values()); pending.delete(name);
        const result = combine();
        if (result.decision.status === IDENTITY_STATES.MATCH_VERIFIED && (registrySettled || row.SirenSiret
          || !/\b(ecole|college|lycee|ehpad|residence|ssiad)\b/.test(String(row.NomCommercial).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()))) return result;
      }
      return combine();
    }, { signal, timeoutMs: IDENTITY_BUDGET.deadlineMs - 100, onEvent: event });
    return { ...completed, trace: [...trace] };
  } catch (error) {
    if (signal?.aborted) throw error;
    const result = combine();
    if (result.decision.status !== IDENTITY_STATES.MATCH_VERIFIED && !result.decision.identifierConflict) result.decision = {
      ...result.decision, status: IDENTITY_STATES.INCOMPLETE,
      reason: "Certaines sources nécessaires n’ont pas répondu ; les résultats et preuves déjà reçus sont conservés.",
    };
    result.diagnostics.push(error.message);
    return { ...result, trace: [...trace] };
  }
}
