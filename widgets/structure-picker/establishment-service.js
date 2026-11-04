import { findCertifiedEntrance } from "./certified-entrances.js";
import { publicSiteBuildingPosition } from "./public-sites.js";
import { resolveAdministrativeSite } from "./administrative-site.js";
import { resolveIdentityForEnrichment } from "./identity-service.js";
import {
  IDENTITY_STATES,
  publishedAccessBinding,
  normalizeIdentity,
  targetNameVariants,
} from "./identity-resolution.js";
import {
  resolveSitePosition,
  POSITION_STATES,
} from "./establishment-position.js";
import {
  findIndexedSitePositions,
  findOsmSiretPositions,
} from "./site-position-sources.js";
import { IDENTITY_BUDGET } from "./identity-orchestrator.js";

export const ESTABLISHMENT_BUDGET = Object.freeze({
  deadlineMs: 24000,
  indexedDeadlineMs: 10000,
  osmDeadlineMs: 1500,
});

function incompleteIdentity(partial, message) {
  const previous = partial.identity;
  return previous
    ? {
        ...previous,
        decision:
          previous.decision?.status === IDENTITY_STATES.MATCH_VERIFIED
            ? previous.decision
            : {
                ...previous.decision,
                status: IDENTITY_STATES.INCOMPLETE,
                reason:
                  "Réponses nécessaires manquantes ; informations reçues conservées.",
              },
        diagnostics: [...(previous.diagnostics ?? []), message],
      }
    : {
        decision: {
          status: IDENTITY_STATES.INCOMPLETE,
          candidate: null,
          alternatives: [],
          certificates: [],
          reason:
            "Les sources d’identité n’ont pas répondu dans leur budget. Aucune identité n’est inventée.",
        },
        candidates: [],
        links: [],
        diagnostics: [message],
        trace: [],
      };
}

async function boundedOperation(source, options, timeoutMs, optional = false) {
  if (options.signal?.aborted)
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  const partial = { observations: [], coverage: [] };
  let timer;
  let onAbort;
  const stopped = new Promise((resolve, reject) => {
    onAbort = () => {
      controller.abort(options.signal.reason);
      reject(
        options.signal.reason ?? new DOMException("Aborted", "AbortError"),
      );
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new DOMException(
        optional
          ? "Source de position hors délai"
          : "Le délai maximal de l’analyse d’identité a été atteint.",
        "TimeoutError",
      );
      controller.abort(error);
      if (optional)
        resolve({
          observations: [...partial.observations],
          coverage: [
            ...partial.coverage,
            { source: source.name, status: "timeout" },
          ],
        });
      else resolve(incompleteIdentity(partial, error.message));
    }, timeoutMs);
  });
  try {
    if (options.signal?.aborted)
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    return await Promise.race([
      source({ ...options, signal: controller.signal, partial }),
      stopped,
    ]);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (!optional) return incompleteIdentity(partial, error.message);
    return {
      observations: [...partial.observations],
      coverage: [
        ...partial.coverage,
        { source: source.name, status: "error", message: error.message },
      ],
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

function publicName(candidate, row, links) {
  const linked = (links ?? []).find(
    (link) => link.verifiedOfficial && link.siret === candidate.siret,
  );
  const targets = new Set(
    targetNameVariants(row, { includeCategoryFallback: false }),
  );
  return (
    (links ?? []).find(
      (link) =>
        link.verifiedOfficial &&
        link.siret === candidate.siret &&
        link.siteRecord,
    )?.siteRecord.name ||
    (candidate.aliases ?? []).find(
      (name) =>
        normalizeIdentity(name) === normalizeIdentity(row.NomCommercial),
    ) ||
    linked?.publicNames?.find((name) => targets.has(normalizeIdentity(name))) ||
    linked?.registryRecord?.name ||
    linked?.siteRecord?.name ||
    (candidate.nomUsuelDistinct
      ? candidate.nomCommercial
      : row.NomCommercial) ||
    candidate.raisonSociale
  );
}

export async function resolveEstablishmentForEnrichment({
  row,
  signal,
  resolveIdentity = resolveIdentityForEnrichment,
  findIndexedPositions = findIndexedSitePositions,
  findOsmPositions = findOsmSiretPositions,
  findAdministrativeSite = resolveAdministrativeSite,
  findEntrance = findCertifiedEntrance,
  ...identityOptions
} = {}) {
  const startedAt = Date.now();
  const remaining = (cap) =>
    Math.max(
      1,
      Math.min(cap, ESTABLISHMENT_BUDGET.deadlineMs - (Date.now() - startedAt)),
    );
  const administrative = await findAdministrativeSite({
    ...identityOptions,
    row,
    signal,
  });
  if (administrative) row = administrative.row;
  const identity = await boundedOperation(
    (options) =>
      resolveIdentity({
        ...identityOptions,
        row,
        signal: options.signal,
        onProgress: (result) => {
          if (options.signal.aborted) return;
          options.partial.identity = result;
          identityOptions.onProgress?.(result);
        },
      }),
    { signal },
    remaining(IDENTITY_BUDGET.deadlineMs),
  );
  const decision = identity.decision;
  const eligible = [
    IDENTITY_STATES.MATCH_VERIFIED,
    IDENTITY_STATES.MATCH_PROBABLE,
  ].includes(decision?.status);
  const official = eligible ? decision.candidate : null;
  if (official?.identityScope === "PUBLIC_SITE") {
    let candidate = official;
    if (
      official.position?.status === POSITION_STATES.UNRESOLVED &&
      decision.status === IDENTITY_STATES.MATCH_VERIFIED
    ) {
      const indexed = await boundedOperation(
        findIndexedPositions,
        {
          candidate: official,
          links: identity.links ?? [],
          identityStatus: decision.status,
          signal,
        },
        remaining(ESTABLISHMENT_BUDGET.indexedDeadlineMs),
        true,
      );
      let position = publicSiteBuildingPosition(
        official,
        indexed.observations ?? [],
      );
      if (!position) position = indexed.certifiedEntrance;
      if (!position)
        position = await boundedOperation(
          findEntrance,
          { candidate: official, identityStatus: decision.status, signal },
          remaining(1000),
          true,
        );
      if (position?.status)
        candidate = {
          ...official,
          position,
          latitude: position.latitude,
          longitude: position.longitude,
        };
    }
    return {
      decision: { ...decision, candidate },
      candidate,
      alternatives: [],
      diagnostics: identity.diagnostics ?? [],
      trace: identity.trace ?? [],
    };
  }
  if (!official) {
    const partial =
      decision?.status === IDENTITY_STATES.INCOMPLETE && decision.candidate
        ? {
            ...decision.candidate,
            latitude: null,
            longitude: null,
            identityStatus: decision.status,
            position: {
              siret: decision.candidate.siret,
              status: POSITION_STATES.UNRESOLVED,
              latitude: null,
              longitude: null,
              source: null,
              proof: [],
              evidence: [],
              coverage: [],
              reason:
                "Identité à revalider : aucune position finale rattachée.",
            },
          }
        : null;
    const alternatives = (decision?.alternatives ?? []).map((candidate) => ({
      ...candidate,
      latitude: null,
      longitude: null,
      identityStatus: decision.status,
      position: {
        siret: candidate.siret,
        status: POSITION_STATES.UNRESOLVED,
        latitude: null,
        longitude: null,
        source: null,
        proof: [],
        evidence: [],
        coverage: [],
        reason: "Identité non résolue : aucune position de site rattachée.",
      },
    }));
    return {
      decision: { ...decision, candidate: partial, alternatives },
      candidate: partial,
      alternatives,
      diagnostics: identity.diagnostics ?? [],
      trace: identity.trace ?? [],
      discovery: identity.geocodeCandidates ?? [],
    };
  }

  const sourceOptions = {
    candidate: official,
    links: identity.links ?? [],
    identityStatus: decision.status,
    signal,
  };
  const indexed = await boundedOperation(
    findIndexedPositions,
    sourceOptions,
    remaining(ESTABLISHMENT_BUDGET.indexedDeadlineMs),
    true,
  );
  const options = {
    ...indexed,
    links: identity.links ?? [],
    identityStatus: decision.status,
    requestedAddress: (identity.links ?? []).some(
      (link) =>
        link.verifiedOfficial &&
        publishedAccessBinding(link.siteRecord, official),
    )
      ? official.adresse
      : row.Adresse,
    discovery: identity.geocodeCandidates ?? [],
  };
  let position = resolveSitePosition(official, options);
  if (
    position.status === POSITION_STATES.UNRESOLVED &&
    indexed.certifiedEntrance
  )
    position = indexed.certifiedEntrance;
  if (position.status === POSITION_STATES.UNRESOLVED) {
    const osm = await boundedOperation(
      findOsmPositions,
      sourceOptions,
      remaining(ESTABLISHMENT_BUDGET.osmDeadlineMs),
      true,
    );
    position = resolveSitePosition(official, {
      ...options,
      observations: [
        ...(indexed.observations ?? []),
        ...(osm.observations ?? []),
      ],
      coverage: [...(indexed.coverage ?? []), ...(osm.coverage ?? [])],
    });
  }
  if (position.status === POSITION_STATES.UNRESOLVED) {
    const entrance = await boundedOperation(
      findEntrance,
      { candidate: official, identityStatus: decision.status, signal },
      remaining(1000),
      true,
    );
    if (entrance?.status) position = entrance;
  }
  for (const link of identity.links ?? []) {
    const access =
      link.verifiedOfficial &&
      publishedAccessBinding(link.siteRecord, official);
    if (
      access &&
      [
        POSITION_STATES.SITE_CONFIRMED,
        POSITION_STATES.SITE_CORROBORATED,
      ].includes(position.status)
    )
      position.proof.push({
        ...access,
        description:
          "Adresse du lieu et accès par une autre voie publiés explicitement par l’établissement.",
      });
  }
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const siteLinks = (identity.links ?? []).filter(
    (link) => link.verifiedOfficial && link.siret === official.siret,
  );
  const siteAddress =
    siteLinks.find((link) => link.siteRecord)?.siteRecord.adresse ||
    siteLinks.find((link) => link.registryRecord)?.registryRecord.adresse ||
    official.adresse;
  const selectedName = publicName(official, row, identity.links);
  const accentCount = (value) =>
    (String(value).normalize("NFD").match(/\p{M}/gu) ?? []).length;
  const displayName =
    targetNameVariants(row, { includeCategoryFallback: false }).includes(
      normalizeIdentity(selectedName),
    ) && accentCount(row.NomCommercial) > accentCount(selectedName)
      ? row.NomCommercial
      : selectedName;
  const candidate = {
    ...official,
    administrativeInputProof: administrative?.proof ?? null,
    officialAddress: official.adresse,
    adresse: siteAddress,
    nomCommercial: displayName,
    nomUsuelDistinct:
      official.nomUsuelDistinct ||
      (identity.links ?? []).some(
        (link) => link.verifiedOfficial && link.siret === official.siret,
      ),
    latitude: position.latitude,
    longitude: position.longitude,
    identityStatus: decision.status,
    position,
    identityProof:
      decision.certificates?.find((item) => item.siret === official.siret)
        ?.explanations ?? [],
    identityLinks: (identity.links ?? []).filter(
      (link) => link.siret === official.siret,
    ),
    ...(() => {
      const contact = [...(identity.links ?? [])]
        .sort(
          (a, b) =>
            Number(Boolean(b.siteRecord)) - Number(Boolean(a.siteRecord)),
        )
        .find(
          (link) =>
            link.siret === official.siret &&
            link.verifiedOfficial &&
            (link.siteRecord?.contacts || link.registryRecord?.contacts),
        );
      const c =
        contact?.siteRecord?.contacts ?? contact?.registryRecord?.contacts;
      return c
        ? {
            telephone: c.phones?.[0] || "",
            courriel: c.emails?.[0] || "",
            siteWeb: c.websites?.[0] || "",
          }
        : {};
    })(),
  };
  return {
    decision: { ...decision, candidate },
    candidate,
    alternatives: [],
    diagnostics: identity.diagnostics ?? [],
    trace: identity.trace ?? [],
  };
}
