import { fetchOfficialRequest } from "./enterprise-client.js";
import { resolveStructureIdentity } from "./identity-orchestrator.js";
import { IDENTITY_STATES, decideIdentity, decisionCandidates } from "./identity-resolution.js";
import { findPublishedIdentityLinks } from "./published-identity-links.js";
import { buildOfficialIdentifierSearchRequest, normalizeIdentifier } from "./search.js";

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

export async function resolveIdentityForEnrichment({
  row,
  signal,
  geocode,
  fetchOfficial = fetchOfficialRequest,
  findPublishedLinks = findPublishedIdentityLinks,
  resolveFallback = resolveStructureIdentity,
} = {}) {
  if (!row) throw new Error("Fiche Grist absente.");
  const diagnostics = [];
  let publishedFailed = false;

  if (!String(row.SirenSiret ?? "").trim() && typeof findPublishedLinks === "function") {
    try {
      const published = await findPublishedLinks({ row, signal });
      const links = Array.isArray(published?.candidates) ? published.candidates.slice(0, 2) : [];
      for (const link of links) {
        const siret = normalizeIdentifier(link?.siret);
        if (siret.length !== 14) continue;
        const request = buildOfficialIdentifierSearchRequest(siret);
        // A published SIRET is legal-identity evidence, not a search convenience.
        // Always revalidate it against the current Annuaire response instead of
        // trusting sessionStorage populated by an earlier implementation/run.
        const verified = await fetchOfficial(request, { signal, cacheTtlMs: 0 });
        const exact = (verified?.items ?? []).find(item => normalizeIdentifier(item?.siret) === siret);
        if (!exact) continue;
        const verifiedLink = { ...link, siret, verifiedOfficial: true };
        const coverage = [publishedCoverage(), officialCoverage(`annuaire:verify:${siret}`, verified)];
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
            requests: [{ source: `annuaire:verify:${siret}`, kind: request.kind, url: request.url }],
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

  const fallback = await resolveFallback({ row, signal, geocode, fetchOfficial });
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
