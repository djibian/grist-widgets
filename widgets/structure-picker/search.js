import {
  departmentFromPostalCode,
  getActiveDepartments,
  normalizeDepartmentCode,
} from "./departments.js";

export const LOCAL_LIMIT = 8;
export const EXTERNAL_LIMIT = 10;
export const IDENTITY_CANDIDATE_LIMIT = 250;

export function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeIdentifier(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export const normalizeSiret = normalizeIdentifier;

export function normalizeFiness(value) {
  const id = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{9}$/.test(id) ? id : "";
}

export function identifierParts(value) {
  const identifier = normalizeIdentifier(value);
  if (identifier.length === 14) {
    return { identifier, siren: identifier.slice(0, 9), siret: identifier };
  }
  if (identifier.length === 9) {
    return { identifier, siren: identifier, siret: "" };
  }
  return { identifier, siren: "", siret: "" };
}

export function extractLocationFromAddress(value) {
  const address = String(value ?? "").trim();
  if (!address) return { codePostal: "", commune: "" };

  const matches = [...address.matchAll(/\b(\d{5})\b/g)];
  if (!matches.length) return { codePostal: "", commune: "" };

  const match = matches[matches.length - 1];
  const codePostal = match[1];
  const afterPostalCode = address.slice((match.index ?? 0) + match[0].length);
  const commune = afterPostalCode
    .replace(/^[\s,;\-–—]+/, "")
    .replace(/(?:,\s*)?(?:france|fr)$/i, "")
    .trim();

  return { codePostal, commune };
}

export const extractLocationFromNormalizedAddress = extractLocationFromAddress;

function tokens(value) {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

export function tokenSimilarity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const minLength = Math.min(left.length, right.length);
  const maxLength = Math.max(left.length, right.length);

  if (minLength >= 3 && (left.startsWith(right) || right.startsWith(left))) {
    return Math.max(0.78, minLength / maxLength);
  }
  if (minLength < 3) return 0;

  const similarity = 1 - levenshtein(left, right) / maxLength;
  return similarity >= 0.55 ? similarity : 0;
}

export function fuzzyTextScore(query, text) {
  const normalizedQuery = normalize(query);
  const normalizedText = normalize(text);
  if (!normalizedQuery || !normalizedText) return 0;
  if (normalizedQuery === normalizedText) return 1;
  if (normalizedText.includes(normalizedQuery)) return 0.96;

  const queryTokens = tokens(normalizedQuery);
  const textTokens = tokens(normalizedText);
  if (!queryTokens.length || !textTokens.length) return 0;

  const bestPerQuery = queryTokens.map(queryToken => {
    let best = 0;
    for (const textToken of textTokens) {
      best = Math.max(best, tokenSimilarity(queryToken, textToken));
      if (best === 1) break;
    }
    return best;
  });

  const average = bestPerQuery.reduce((sum, value) => sum + value, 0) / bestPerQuery.length;
  const matchedRatio = bestPerQuery.filter(value => value >= 0.68).length / bestPerQuery.length;
  const phraseBonus = normalizedText.startsWith(normalizedQuery) ? 0.08 : 0;

  return Math.min(1, average * 0.72 + matchedRatio * 0.28 + phraseBonus);
}

export function localSearchText(row) {
  return [row.NomCommercial, row.RaisonSociale, row.Adresse, row.CodePostal, row.Commune, row.SirenSiret]
    .filter(Boolean)
    .join(" ");
}

export function scoreLocal(row, query) {
  const queryIdentifier = identifierParts(query);
  const rowIdentifier = identifierParts(row.SirenSiret);

  if (queryIdentifier.siret && rowIdentifier.siret === queryIdentifier.siret) return 10;
  if (queryIdentifier.siren && rowIdentifier.siren === queryIdentifier.siren) return 9;

  const name = [row.NomCommercial, row.RaisonSociale].filter(Boolean).join(" ");
  const address = [row.Adresse, row.CodePostal, row.Commune].filter(Boolean).join(" ");

  const nameScore = fuzzyTextScore(query, name);
  const addressScore = fuzzyTextScore(query, address);
  const globalScore = fuzzyTextScore(query, localSearchText(row));

  let score = Math.max(nameScore, addressScore * 0.9, globalScore * 0.95);
  const normalizedQuery = normalize(query);
  const normalizedName = normalize(name);
  if (normalizedName.startsWith(normalizedQuery)) score += 0.08;
  if (normalizedName.includes(normalizedQuery)) score += 0.05;
  return Math.min(1.2, score);
}

export function searchLocal(rows, query, limit = LOCAL_LIMIT) {
  if (normalize(query).length < 2) return [];
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({ row, score: scoreLocal(row, query) }))
    .filter(item => item.score >= 0.43)
    .sort((a, b) => b.score - a.score || String(a.row.NomCommercial || "").localeCompare(String(b.row.NomCommercial || ""), "fr"))
    .slice(0, limit)
    .map(item => item.row);
}

export function departmentOf(establishment) {
  const explicit = normalizeDepartmentCode(establishment?.departement);
  if (explicit) return explicit;
  return departmentFromPostalCode(establishment?.code_postal);
}

export function isAllowedDepartment(establishment, departments = getActiveDepartments()) {
  return departments.includes(departmentOf(establishment));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const clean = nonEmptyString(value);
    if (!clean) continue;
    const key = normalize(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function coordinate(value, min, max) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function candidateFrom(unit, establishment, departments = getActiveDepartments()) {
  if (!establishment?.siret) return null;
  if (establishment.etat_administratif && establishment.etat_administratif !== "A") return null;
  if (!isAllowedDepartment(establishment, departments)) return null;

  const aliases = uniqueStrings([
    ...(Array.isArray(establishment.liste_enseignes) ? establishment.liste_enseignes : []),
    establishment.nom_commercial,
  ]);
  const raisonSociale = nonEmptyString(unit?.nom_raison_sociale) || nonEmptyString(unit?.nom_complet);
  const nomUsuelPublic = aliases[0] || "";
  const nomCommercial = nomUsuelPublic || raisonSociale || nonEmptyString(unit?.nom_complet) || "Structure sans nom";

  return {
    nomCommercial,
    aliases,
    nomUsuelDistinct: Boolean(nomUsuelPublic),
    raisonSociale,
    siren: String(unit?.siren ?? ""),
    siret: String(establishment.siret ?? ""),
    // FINESS belongs to this geographic establishment, never to its legal unit.
    finessIds: [...new Set((Array.isArray(establishment.liste_finess) ? establishment.liste_finess : [])
      .map(normalizeFiness).filter(Boolean))],
    adresse: String(establishment.adresse ?? ""),
    codePostal: String(establishment.code_postal ?? ""),
    commune: String(establishment.libelle_commune ?? ""),
    departement: departmentOf(establishment),
    latitude: coordinate(establishment.latitude, -90, 90),
    longitude: coordinate(establishment.longitude, -180, 180),
    etatAdministratif: String(establishment.etat_administratif ?? ""),
    activitePrincipale: String(establishment.activite_principale ?? ""),
  };
}

export function candidateMatchesIdentifier(candidate, value) {
  const local = identifierParts(value);
  const candidateSiret = normalizeIdentifier(candidate?.siret);
  const candidateSiren = normalizeIdentifier(candidate?.siren) || candidateSiret.slice(0, 9);
  if (local.siret) return local.siret === candidateSiret;
  if (local.siren) return local.siren === candidateSiren;
  return false;
}

export function localIdentifierSet(rows) {
  return new Set((Array.isArray(rows) ? rows : [])
    .map(row => normalizeIdentifier(row.SirenSiret))
    .filter(value => value.length === 9 || value.length === 14));
}

export const localSiretSet = localIdentifierSet;

export function candidateIsAlreadyLocal(candidate, localIdentifiers) {
  for (const identifier of localIdentifiers ?? []) {
    if (candidateMatchesIdentifier(candidate, identifier)) return true;
  }
  return false;
}

function matchingEstablishmentsFor(unit, { requestedSiret = "", allowSiegeFallback = false } = {}) {
  const matching = Array.isArray(unit?.matching_etablissements) ? [...unit.matching_etablissements] : [];
  const targetSiret = normalizeIdentifier(requestedSiret);
  if (targetSiret && normalizeIdentifier(unit?.siege?.siret) === targetSiret) matching.push(unit.siege);
  else if (!matching.length && allowSiegeFallback && unit?.siege) matching.push(unit.siege);
  return matching;
}

export function extractOfficialCandidates(payload, {
  localIdentifiers = new Set(),
  limit = IDENTITY_CANDIDATE_LIMIT,
  departments = getActiveDepartments(),
  requestedSiret = "",
  allowSiegeFallback = false,
  page = 1,
  perPage = 25,
  matchingLimit = 100,
} = {}) {
  const candidates = [];
  const seenSirets = new Set();
  let matchingLimitReached = false;
  let candidateLimitHit = false;

  for (const unit of payload?.results ?? []) {
    const establishments = matchingEstablishmentsFor(unit, { requestedSiret, allowSiegeFallback });
    if (establishments.length >= matchingLimit) matchingLimitReached = true;
    for (const establishment of establishments) {
      const candidate = candidateFrom(unit, establishment, departments);
      if (!candidate) continue;
      const siret = normalizeIdentifier(candidate.siret);
      if (!siret || seenSirets.has(siret) || candidateIsAlreadyLocal(candidate, localIdentifiers)) continue;
      if (candidates.length >= limit) {
        candidateLimitHit = true;
        break;
      }
      seenSirets.add(siret);
      candidates.push(candidate);
    }
    if (candidateLimitHit) break;
  }

  const totalResultsRaw = Number(payload?.total_results ?? payload?.totalResults);
  const totalResults = Number.isFinite(totalResultsRaw) ? totalResultsRaw : null;
  const safePage = Math.max(1, Number(page) || 1);
  const safePerPage = Math.max(1, Number(perPage) || 25);
  const hasNextPage = totalResults !== null ? safePage * safePerPage < totalResults : false;
  const completenessKnown = totalResults !== null;
  const complete = !candidateLimitHit && !matchingLimitReached && (!completenessKnown || !hasNextPage);

  return {
    items: candidates,
    coverage: {
      source: "annuaire",
      page: safePage,
      perPage: safePerPage,
      totalResults,
      returnedUnits: Array.isArray(payload?.results) ? payload.results.length : 0,
      unitSirens: uniqueStrings((payload?.results ?? []).map(unit => String(unit?.siren ?? ""))).filter(value => normalizeIdentifier(value).length === 9),
      candidateCount: candidates.length,
      candidateLimitHit,
      matchingLimitReached,
      hasNextPage,
      completenessKnown,
      complete,
    },
  };
}

export function flattenExternalResults(payload, localIdentifiers = new Set(), limit = EXTERNAL_LIMIT, departments = getActiveDepartments()) {
  return extractOfficialCandidates(payload, {
    localIdentifiers,
    limit,
    departments,
    allowSiegeFallback: true,
    perPage: 10,
    matchingLimit: 10,
  }).items;
}

function officialCommonParams({ departments, page, perPage, matchingLimit } = {}) {
  return {
    departement: (departments ?? getActiveDepartments()).join(","),
    etat_administratif: "A",
    minimal: "true",
    include: "matching_etablissements,siege",
    limite_matching_etablissements: String(matchingLimit ?? 100),
    page: String(page ?? 1),
    per_page: String(perPage ?? 25),
  };
}

export function buildExternalSearchUrl(query, { perPage = 10, matchingLimit = 10, codePostal = "", departments = getActiveDepartments() } = {}) {
  const params = new URLSearchParams({
    q: String(query ?? "").trim(),
    ...officialCommonParams({ departments, page: 1, perPage, matchingLimit }),
  });
  if (/^\d{5}$/.test(String(codePostal).trim())) params.set("code_postal", String(codePostal).trim());
  return `https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`;
}

function freezeRequest(request) {
  return Object.freeze({ ...request, cacheKey: request.url });
}

export function buildOfficialTextSearchRequest(query, {
  codePostal = "",
  departments = getActiveDepartments(),
  page = 1,
  perPage = 25,
  matchingLimit = 100,
} = {}) {
  const text = String(query ?? "").trim();
  if (!text) return null;
  const params = new URLSearchParams({
    q: text,
    ...officialCommonParams({ departments, page, perPage, matchingLimit }),
  });
  const postal = /^\d{5}$/.test(String(codePostal).trim()) ? String(codePostal).trim() : "";
  if (postal) params.set("code_postal", postal);
  const url = `https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`;
  return freezeRequest({ kind: "text", query: text, codePostal: postal, page, perPage, matchingLimit, url });
}

export function buildOfficialIdentifierSearchRequest(value, {
  departments = getActiveDepartments(),
  page = 1,
  perPage = 25,
  matchingLimit = 100,
} = {}) {
  const identifier = identifierParts(value);
  if (!identifier.identifier) return null;
  const params = new URLSearchParams({
    q: identifier.identifier,
    ...officialCommonParams({ departments, page, perPage, matchingLimit }),
  });
  const url = `https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`;
  return freezeRequest({
    kind: identifier.siret ? "siret" : "siren",
    identifier: identifier.identifier,
    requestedSiret: identifier.siret,
    page,
    perPage,
    matchingLimit,
    url,
  });
}

export function buildOfficialNearbySearchRequest({
  latitude,
  longitude,
  radius = 0.3,
  departments = getActiveDepartments(),
  page = 1,
  perPage = 25,
  matchingLimit = 100,
} = {}) {
  const lat = coordinate(latitude, -90, 90);
  const lon = coordinate(longitude, -180, 180);
  const distance = Number(radius);
  if (lat === null || lon === null || !Number.isFinite(distance) || distance <= 0) return null;
  const params = new URLSearchParams({
    lat: String(lat),
    long: String(lon),
    radius: String(distance),
    ...officialCommonParams({ departments, page, perPage, matchingLimit }),
  });
  const url = `https://recherche-entreprises.api.gouv.fr/near_point?${params.toString()}`;
  return freezeRequest({ kind: "nearby", latitude: lat, longitude: lon, radius: distance, page, perPage, matchingLimit, url });
}
