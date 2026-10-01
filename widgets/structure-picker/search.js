import {
  departmentFromPostalCode,
  getActiveDepartments,
  normalizeDepartmentCode,
} from "./departments.js";

export const LOCAL_LIMIT = 8;
export const EXTERNAL_LIMIT = 10;

const NEARBY_QUERY_PREFIX = "__near_point__:";
const TARGETED_TEXT_QUERY_PREFIX = "__targeted_text__:";
const IDENTITY_STOP_WORDS = new Set([
  "a", "au", "aux", "d", "de", "des", "du", "et", "en", "l", "la", "le", "les", "sur",
  "st", "ste", "saint", "sainte",
]);
const ADDRESS_STOP_WORDS = new Set([
  "rue", "route", "avenue", "av", "boulevard", "bd", "chemin", "impasse", "place", "allee",
  "zone", "commerciale", "espace", "cial", "za", "zi", "lotissement", "lieu", "dit",
  "de", "des", "du", "la", "le", "les", "bis", "ter",
]);
let externalRankingContext = { mode: "text", query: "", codePostal: "", targetAddress: "", latitude: null, longitude: null, radius: null };

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

function identityText(value) {
  return tokens(value)
    .filter(token => token.length > 1 && !IDENTITY_STOP_WORDS.has(token))
    .join(" ");
}

function streetText(value, codePostal = "", commune = "") {
  const communeWords = new Set(tokens(commune));
  const postal = String(codePostal ?? "").trim();
  return tokens(value)
    .filter(token => token !== postal)
    .filter(token => !/^\d+[a-z]*$/.test(token))
    .filter(token => !ADDRESS_STOP_WORDS.has(token))
    .filter(token => !communeWords.has(token))
    .join(" ");
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

function firstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function candidateFrom(unit, establishment, departments = getActiveDepartments()) {
  if (!establishment?.siret) return null;
  if (establishment.etat_administratif && establishment.etat_administratif !== "A") return null;
  if (!isAllowedDepartment(establishment, departments)) return null;

  const enseigne = Array.isArray(establishment.liste_enseignes) ? firstNonEmpty(establishment.liste_enseignes) : "";
  const nomUsuelPublic = firstNonEmpty([enseigne, establishment.nom_commercial]);
  const raisonSociale = firstNonEmpty([unit?.nom_raison_sociale, unit?.nom_complet]);
  const nomCommercial = firstNonEmpty([
    nomUsuelPublic,
    raisonSociale,
    unit?.nom_complet,
  ]) || "Structure sans nom";
  const latitude = Number(establishment.latitude);
  const longitude = Number(establishment.longitude);

  return {
    nomCommercial,
    nomUsuelDistinct: Boolean(nomUsuelPublic),
    raisonSociale,
    siren: String(unit?.siren ?? ""),
    siret: String(establishment.siret ?? ""),
    adresse: String(establishment.adresse ?? ""),
    codePostal: String(establishment.code_postal ?? ""),
    commune: String(establishment.libelle_commune ?? ""),
    departement: departmentOf(establishment),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
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

function queryTokenCoverage(query, text) {
  const queryTokens = tokens(query);
  const textTokens = tokens(text);
  if (!queryTokens.length || !textTokens.length) return 0;

  const bestPerQuery = queryTokens.map(queryToken => {
    let best = 0;
    for (const textToken of textTokens) {
      best = Math.max(best, tokenSimilarity(queryToken, textToken));
      if (best === 1) break;
    }
    return best;
  });
  return bestPerQuery.reduce((sum, value) => sum + value, 0) / bestPerQuery.length;
}

function haversineKm(latitude1, longitude1, latitude2, longitude2) {
  const values = [latitude1, longitude1, latitude2, longitude2].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [lat1, lon1, lat2, lon2] = values.map(value => value * Math.PI / 180);
  const deltaLat = lat2 - lat1;
  const deltaLon = lon2 - lon1;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function candidateHasIndependentPublicName(candidate) {
  if (!candidate?.nomUsuelDistinct) return false;
  const publicName = normalize(candidate?.nomCommercial);
  const legalName = normalize(candidate?.raisonSociale);
  return Boolean(publicName && (!legalName || publicName !== legalName));
}

function candidateNameScore(candidate, targetName) {
  const targetIdentity = identityText(targetName) || normalize(targetName);
  const publicIdentity = identityText(candidate?.nomCommercial) || normalize(candidate?.nomCommercial);
  const legalIdentity = identityText(candidate?.raisonSociale) || normalize(candidate?.raisonSociale);

  let publicScore = fuzzyTextScore(targetIdentity, publicIdentity);
  const publicCoverage = queryTokenCoverage(targetIdentity, publicIdentity);

  if (targetIdentity && publicIdentity && (
    targetIdentity === publicIdentity
    || targetIdentity.includes(publicIdentity)
    || publicIdentity.includes(targetIdentity)
  )) {
    publicScore = Math.max(publicScore, 0.98);
  }

  // Dès qu'un établissement publie une enseigne ou un nom commercial réellement
  // distinct de la raison sociale, ce nom public porte son identité.
  if (candidateHasIndependentPublicName(candidate)) {
    return Math.max(publicScore, publicCoverage * 0.96);
  }

  const legalScore = fuzzyTextScore(targetIdentity, legalIdentity);
  const legalCoverage = queryTokenCoverage(targetIdentity, legalIdentity);
  return Math.max(publicScore, legalScore, publicCoverage * 0.96, legalCoverage * 0.92);
}

export function scoreAddressEvidence(targetAddress, candidate, fallbackPostalCode = "") {
  const targetLocation = extractLocationFromAddress(targetAddress);
  const targetPostal = targetLocation.codePostal || String(fallbackPostalCode ?? "").trim();
  const candidatePostal = String(candidate?.codePostal ?? "").trim();
  if (targetPostal && candidatePostal && targetPostal !== candidatePostal) return 0;

  const targetStreet = streetText(targetAddress, targetPostal, targetLocation.commune);
  const candidateStreet = streetText(candidate?.adresse, candidatePostal, candidate?.commune);
  if (!targetStreet || !candidateStreet) return 0;
  return fuzzyTextScore(targetStreet, candidateStreet);
}

export function scoreExternalCandidate(candidate, query, codePostal = "") {
  const nameText = [candidate?.nomCommercial, candidate?.raisonSociale].filter(Boolean).join(" ");
  const nameCoverage = queryTokenCoverage(query, nameText);
  const commercialScore = fuzzyTextScore(query, candidate?.nomCommercial);
  const legalScore = fuzzyTextScore(query, candidate?.raisonSociale);
  const postalScore = codePostal && String(candidate?.codePostal ?? "") === String(codePostal) ? 1 : 0;
  return nameCoverage * 0.67 + commercialScore * 0.20 + legalScore * 0.08 + postalScore * 0.05;
}

export function rankExternalCandidates(candidates, query, codePostal = "") {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => ({ candidate, index, score: scoreExternalCandidate(candidate, query, codePostal) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.candidate);
}

function evidenceForCandidate(candidate, context, withDistance) {
  const nameScore = candidateNameScore(candidate, context?.query);
  const addressScore = scoreAddressEvidence(context?.targetAddress, candidate, context?.codePostal);
  const postalScore = context?.codePostal && String(candidate?.codePostal ?? "") === String(context.codePostal) ? 1 : 0;
  const distance = withDistance
    ? haversineKm(context?.latitude, context?.longitude, candidate?.latitude, candidate?.longitude)
    : null;
  const radius = Number(context?.radius);
  const distanceScore = !withDistance
    ? 0
    : distance === null || !Number.isFinite(radius) || radius <= 0
      ? 0.5
      : Math.max(0, 1 - distance / radius);

  const strongName = nameScore >= 0.55;
  const addressOnly = !candidateHasIndependentPublicName(candidate)
    && nameScore < 0.20
    && addressScore >= 0.90
    && (!context?.codePostal || postalScore === 1);

  return {
    nameScore,
    addressScore,
    postalScore,
    distanceScore,
    eligible: strongName || addressOnly,
  };
}

export function scoreNearbyCandidate(candidate, context) {
  const evidence = evidenceForCandidate(candidate, context, true);
  return evidence.nameScore * 0.72
    + evidence.addressScore * 0.20
    + evidence.distanceScore * 0.05
    + evidence.postalScore * 0.03;
}

export function rankNearbyCandidates(candidates, context) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => {
      const evidence = evidenceForCandidate(candidate, context, true);
      return {
        candidate,
        index,
        ...evidence,
        score: evidence.nameScore * 0.72
          + evidence.addressScore * 0.20
          + evidence.distanceScore * 0.05
          + evidence.postalScore * 0.03,
      };
    })
    // La proximité seule ne suffit jamais. Un candidat doit avoir soit une
    // identité convaincante, soit une concordance de voie quasi exacte lorsque
    // l'Annuaire ne publie pas l'enseigne sous laquelle le public le connaît.
    .filter(item => item.eligible)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.candidate);
}

export function rankTargetedTextCandidates(candidates, context) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => {
      const evidence = evidenceForCandidate(candidate, context, false);
      return {
        candidate,
        index,
        ...evidence,
        score: evidence.nameScore * 0.76
          + evidence.addressScore * 0.21
          + evidence.postalScore * 0.03,
      };
    })
    .filter(item => item.eligible)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.candidate);
}

export function buildNearbySearchQuery({ latitude, longitude, radius = 0.25, name = "", address = "" } = {}) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const distance = Number(radius);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(distance) || distance <= 0) return "";
  const payload = [lat, lon, distance, encodeURIComponent(String(name ?? "").trim()), encodeURIComponent(String(address ?? "").trim())];
  return `${NEARBY_QUERY_PREFIX}${payload.join("|")}`;
}

export function buildTargetedTextSearchQuery({ query = "", name = "", address = "" } = {}) {
  const apiQuery = String(query ?? "").trim();
  const targetName = String(name ?? "").trim();
  if (!apiQuery || !targetName) return "";
  return `${TARGETED_TEXT_QUERY_PREFIX}${[
    encodeURIComponent(apiQuery),
    encodeURIComponent(targetName),
    encodeURIComponent(String(address ?? "").trim()),
  ].join("|")}`;
}

function parseNearbySearchQuery(query) {
  const raw = String(query ?? "");
  if (!raw.startsWith(NEARBY_QUERY_PREFIX)) return null;
  const [latitudeRaw, longitudeRaw, radiusRaw, nameRaw = "", addressRaw = ""] = raw.slice(NEARBY_QUERY_PREFIX.length).split("|");
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  const radius = Number(radiusRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radius) || radius <= 0) return null;
  try {
    return {
      latitude,
      longitude,
      radius,
      name: decodeURIComponent(nameRaw),
      address: decodeURIComponent(addressRaw),
    };
  } catch {
    return null;
  }
}

function parseTargetedTextSearchQuery(query) {
  const raw = String(query ?? "");
  if (!raw.startsWith(TARGETED_TEXT_QUERY_PREFIX)) return null;
  const [queryRaw = "", nameRaw = "", addressRaw = ""] = raw.slice(TARGETED_TEXT_QUERY_PREFIX.length).split("|");
  try {
    const apiQuery = decodeURIComponent(queryRaw).trim();
    const name = decodeURIComponent(nameRaw).trim();
    if (!apiQuery || !name) return null;
    return {
      query: apiQuery,
      name,
      address: decodeURIComponent(addressRaw).trim(),
    };
  } catch {
    return null;
  }
}

export function flattenExternalResults(payload, localIdentifiers = new Set(), limit = EXTERNAL_LIMIT, departments = getActiveDepartments()) {
  const candidates = [];
  const seenSirets = new Set();

  for (const unit of payload?.results ?? []) {
    let establishments = Array.isArray(unit.matching_etablissements) ? unit.matching_etablissements : [];
    if (!establishments.length && unit.siege) establishments = [unit.siege];

    for (const establishment of establishments) {
      const candidate = candidateFrom(unit, establishment, departments);
      if (!candidate) continue;
      const siret = normalizeIdentifier(candidate.siret);
      if (!siret || seenSirets.has(siret) || candidateIsAlreadyLocal(candidate, localIdentifiers)) continue;
      seenSirets.add(siret);
      candidates.push(candidate);
    }
  }

  const ranked = externalRankingContext.mode === "nearby"
    ? rankNearbyCandidates(candidates, externalRankingContext)
    : externalRankingContext.mode === "targeted_text"
      ? rankTargetedTextCandidates(candidates, externalRankingContext)
      : externalRankingContext.query
        ? rankExternalCandidates(candidates, externalRankingContext.query, externalRankingContext.codePostal)
        : candidates;
  return ranked.slice(0, limit);
}

export function buildExternalSearchUrl(query, { perPage = 10, matchingLimit = 10, codePostal = "", departments = getActiveDepartments() } = {}) {
  const normalizedPostalCode = /^\d{5}$/.test(String(codePostal).trim()) ? String(codePostal).trim() : "";
  const nearby = parseNearbySearchQuery(query);
  if (nearby) {
    externalRankingContext = {
      mode: "nearby",
      query: nearby.name,
      targetAddress: nearby.address,
      codePostal: normalizedPostalCode,
      latitude: nearby.latitude,
      longitude: nearby.longitude,
      radius: nearby.radius,
    };
    const params = new URLSearchParams({
      lat: String(nearby.latitude),
      long: String(nearby.longitude),
      radius: String(nearby.radius),
      page: "1",
      per_page: "25",
      sort_by_size: "true",
      minimal: "true",
      include: "matching_etablissements,siege",
      limite_matching_etablissements: String(Math.min(25, Math.max(10, Number(matchingLimit) || 10))),
    });
    return `https://recherche-entreprises.api.gouv.fr/near_point?${params.toString()}`;
  }

  const targetedText = parseTargetedTextSearchQuery(query);
  const apiQuery = targetedText?.query || String(query ?? "").trim();
  externalRankingContext = targetedText
    ? {
        mode: "targeted_text",
        query: targetedText.name,
        codePostal: normalizedPostalCode,
        targetAddress: targetedText.address,
        latitude: null,
        longitude: null,
        radius: null,
      }
    : {
        mode: "text",
        query: apiQuery,
        codePostal: normalizedPostalCode,
        targetAddress: "",
        latitude: null,
        longitude: null,
        radius: null,
      };

  const requestedPerPage = Number.isFinite(Number(perPage)) ? Number(perPage) : 10;
  const effectivePerPage = normalizedPostalCode
    ? Math.min(25, Math.max(20, requestedPerPage))
    : Math.min(25, Math.max(1, requestedPerPage));

  const params = new URLSearchParams({
    q: apiQuery,
    departement: departments.join(","),
    etat_administratif: "A",
    minimal: "true",
    include: "matching_etablissements,siege",
    limite_matching_etablissements: String(matchingLimit),
    page: "1",
    per_page: String(effectivePerPage),
  });
  if (normalizedPostalCode) params.set("code_postal", normalizedPostalCode);
  return `https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`;
}
