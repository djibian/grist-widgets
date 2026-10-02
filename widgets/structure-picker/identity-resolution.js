import { extractLocationFromAddress, identifierParts, normalize, normalizeFiness, normalizeIdentifier } from "./search.js";

export const IDENTITY_STATES = Object.freeze({
  MATCH_VERIFIED: "MATCH_VERIFIED",
  MATCH_PROBABLE: "MATCH_PROBABLE",
  AMBIGUOUS: "AMBIGUOUS",
  NO_MATCH: "NO_MATCH",
  INCOMPLETE: "INCOMPLETE",
});

const FUNCTION_WORDS = new Set([
  "a", "au", "aux", "d", "de", "des", "du", "et", "en", "l", "la", "le", "les", "sur", "chez",
]);

const GENERIC_CATEGORY_TOKENS = new Set([
  "association", "cabinet", "centre", "college", "creche", "ecole", "ehpad", "foyer", "garage",
  "hotel", "lycee", "magasin", "maison", "microcreche", "restaurant", "service", "soins", "station",
  "supermarche",
]);

const STREET_TYPE_TOKENS = new Set([
  "allee", "av", "avenue", "bd", "boulevard", "chemin", "impasse", "place", "quai", "route", "rue",
]);

const STREET_NOISE_TOKENS = new Set([
  ...FUNCTION_WORDS,
  "commercial", "commerciale", "espace", "lieu", "dit", "za", "zac", "zi", "zone",
]);

function canonicalToken(token) {
  if (token === "st") return "saint";
  if (token === "ste") return "sainte";
  return token;
}

export function comparisonTokens(value) {
  return normalize(value).split(/\s+/).filter(Boolean).map(canonicalToken);
}

export function normalizeIdentity(value) {
  return comparisonTokens(value).join(" ");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function canonicalPlace(value) {
  return comparisonTokens(value).filter(token => !FUNCTION_WORDS.has(token)).join(" ");
}

function stripPostalTokens(value) {
  return comparisonTokens(value).filter(token => !/^\d{5}$/.test(token)).join(" ");
}

function stripCommuneEdgeWords(value, commune) {
  const words = comparisonTokens(value);
  const communeWords = new Set(comparisonTokens(commune));
  if (!words.length || !communeWords.size) return words.join(" ");
  let start = 0;
  let end = words.length;
  while (end - start > 1 && communeWords.has(words[end - 1])) end -= 1;
  while (end - start > 1 && communeWords.has(words[start])) start += 1;
  return words.slice(start, end).join(" ");
}

function withoutLeadingGenericCategory(value) {
  const words = comparisonTokens(value);
  if (words.length < 2 || !GENERIC_CATEGORY_TOKENS.has(words[0])) return "";
  if (words[0] === "micro" && words[1] === "creche") return words.slice(2).join(" ");
  return words.slice(1).join(" ");
}

export function targetNameVariants(row, { includeCategoryFallback = true } = {}) {
  const name = String(row?.NomCommercial ?? "").trim();
  if (!name) return [];
  const location = extractLocationFromAddress(row?.Adresse);
  const noPostal = stripPostalTokens(name);
  const noCommune = stripCommuneEdgeWords(noPostal, location.commune);
  const variants = [normalizeIdentity(name), noPostal, noCommune];
  const noCategory = withoutLeadingGenericCategory(noCommune || noPostal);
  if (includeCategoryFallback && noCategory) variants.push(noCategory);
  return unique(variants.map(normalizeIdentity));
}

export function identitySearchName(row) {
  const variants = targetNameVariants(row);
  if (!variants.length) return "";
  const location = extractLocationFromAddress(row?.Adresse);
  const noPostal = stripPostalTokens(row?.NomCommercial);
  const neutral = stripCommuneEdgeWords(noPostal, location.commune) || noPostal;
  const withoutCategory = withoutLeadingGenericCategory(neutral);
  if (withoutCategory && distinctiveTokens(withoutCategory).length >= 2) return normalizeIdentity(withoutCategory);
  return normalizeIdentity(neutral || variants[0]);
}

function distinctiveTokens(value) {
  return comparisonTokens(value).filter(token => !FUNCTION_WORDS.has(token) && !GENERIC_CATEGORY_TOKENS.has(token));
}

function genericCategories(value) {
  return comparisonTokens(value).filter(token => GENERIC_CATEGORY_TOKENS.has(token));
}

function tokenCoverage(required, observed) {
  const requiredTokens = distinctiveTokens(required);
  const observedSet = new Set(distinctiveTokens(observed));
  if (!requiredTokens.length) return 0;
  return requiredTokens.filter(token => observedSet.has(token)).length / requiredTokens.length;
}

function aliasRelation(row, candidate) {
  const targetVariants = targetNameVariants(row);
  const aliases = unique([
    ...(Array.isArray(candidate?.aliases) ? candidate.aliases : []),
    candidate?.nomUsuelDistinct ? candidate?.nomCommercial : "",
  ].map(normalizeIdentity));

  let exact = false;
  let strong = false;
  let category = false;
  let bestAlias = "";

  for (const alias of aliases) {
    if (!alias) continue;
    const aliasDistinctive = distinctiveTokens(alias);
    const aliasCategories = genericCategories(alias);
    for (const target of targetVariants) {
      if (!target) continue;
      if (alias === target) {
        if (aliasDistinctive.length) exact = true;
        else if (aliasCategories.some(token => genericCategories(target).includes(token))) category = true;
        bestAlias ||= alias;
      }
      if (aliasDistinctive.length) {
        const targetToAlias = tokenCoverage(target, alias);
        const aliasToTarget = tokenCoverage(alias, target);
        if (targetToAlias >= 0.8 && aliasToTarget >= 0.8) {
          strong = true;
          bestAlias ||= alias;
        }
      } else if (aliasCategories.some(token => genericCategories(target).includes(token))) {
        category = true;
        bestAlias ||= alias;
      }
    }
  }

  const legal = normalizeIdentity(candidate?.raisonSociale);
  const legalExact = Boolean(legal && targetVariants.includes(legal));
  const legalStrong = Boolean(legal && targetVariants.some(target => {
    const left = tokenCoverage(target, legal);
    const right = tokenCoverage(legal, target);
    return left >= 0.9 && right >= 0.9;
  }));

  const publicAliasMismatch = Boolean(candidate?.nomUsuelDistinct && aliases.length && !exact && !strong && !category);

  return {
    exactDistinctiveAlias: exact,
    strongDistinctiveAlias: exact || strong,
    categoryMatch: category,
    bestAlias,
    legalExact,
    legalStrong,
    publicAliasMismatch,
  };
}

function parseHouseNumber(addressBeforePostal) {
  const match = String(addressBeforePostal ?? "").match(/\b(\d{1,5})\s*(bis|ter|quater|[a-z])?\b/i);
  if (!match) return { number: "", repetition: "" };
  return {
    number: String(Number(match[1])),
    repetition: normalize(match[2] ?? ""),
  };
}

function repetitionRelation(left, right) {
  if (!left || !right) return "unknown";
  if (left === right) return "same";
  const equivalents = new Set(["b|bis", "bis|b", "t|ter", "ter|t"]);
  return equivalents.has(`${left}|${right}`) ? "compatible" : "conflict";
}

function streetTokens(address, commune) {
  const raw = String(address ?? "");
  const postal = [...raw.matchAll(/\b\d{5}\b/g)].at(-1);
  const beforePostal = postal ? raw.slice(0, postal.index) : raw;
  const normalized = comparisonTokens(beforePostal);
  const typeIndex = normalized.findIndex(token => STREET_TYPE_TOKENS.has(token));
  const scoped = typeIndex >= 0 ? normalized.slice(typeIndex) : normalized;
  const communeWords = new Set(comparisonTokens(commune));
  return scoped
    .filter(token => !/^\d+[a-z]*$/.test(token))
    .filter(token => !STREET_TYPE_TOKENS.has(token))
    .filter(token => !STREET_NOISE_TOKENS.has(token))
    .filter(token => !communeWords.has(token));
}

function setSimilarity(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter(token => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const jaccard = union ? intersection / union : 0;
  const containment = intersection / Math.min(a.size, b.size);
  return Math.max(jaccard, containment * 0.95);
}

export function parseSiteAddress(value) {
  const raw = String(value ?? "").trim();
  const location = extractLocationFromAddress(raw);
  const postalMatch = [...raw.matchAll(/\b\d{5}\b/g)].at(-1);
  const beforePostal = postalMatch ? raw.slice(0, postalMatch.index) : raw;
  const house = parseHouseNumber(beforePostal);
  return {
    raw,
    codePostal: location.codePostal,
    commune: canonicalPlace(location.commune),
    number: house.number,
    repetition: house.repetition,
    streetTokens: streetTokens(raw, location.commune),
  };
}

export function addressEvidence(targetAddress, candidateAddress) {
  const target = parseSiteAddress(targetAddress);
  const candidate = parseSiteAddress(candidateAddress);
  const postal = target.codePostal && candidate.codePostal
    ? target.codePostal === candidate.codePostal ? "same" : "conflict"
    : "unknown";
  const commune = target.commune && candidate.commune
    ? target.commune === candidate.commune ? "same" : "conflict"
    : "unknown";
  const streetSimilarity = setSimilarity(target.streetTokens, candidate.streetTokens);
  const street = streetSimilarity >= 0.9 ? "same" : streetSimilarity >= 0.72 ? "compatible" : target.streetTokens.length && candidate.streetTokens.length ? "conflict" : "unknown";
  const number = target.number && candidate.number
    ? target.number === candidate.number ? "same" : "conflict"
    : "unknown";
  const repetition = repetitionRelation(target.repetition, candidate.repetition);

  const conflict = postal === "conflict" || commune === "conflict" || street === "conflict" || number === "conflict" || repetition === "conflict";
  const compatible = !conflict
    && (postal === "same" || postal === "unknown")
    && (commune === "same" || commune === "unknown")
    && (street === "same" || street === "compatible");
  const complete = compatible
    && postal === "same"
    && street === "same"
    && number === "same"
    && (repetition === "same" || repetition === "compatible" || (!target.repetition && !candidate.repetition));

  return {
    target,
    candidate,
    postal,
    commune,
    street,
    streetSimilarity,
    number,
    repetition,
    conflict,
    compatible,
    complete,
  };
}

function coordinateValue(value, min, max) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function usableCoordinates(latitude, longitude) {
  const lat = coordinateValue(latitude, -90, 90);
  const lon = coordinateValue(longitude, -180, 180);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) < 1e-12 && Math.abs(lon) < 1e-12) return null;
  return { latitude: lat, longitude: lon };
}

function distanceMeters(a, b) {
  if (!a || !b) return null;
  const lat1 = a.latitude * Math.PI / 180;
  const lon1 = a.longitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const lon2 = b.longitude * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function targetCoordinates(row, location) {
  return usableCoordinates(row?.Latitude, row?.Longitude)
    || usableCoordinates(location?.latitude, location?.longitude);
}

function linkEvidenceFor(candidate, row, links) {
  const siret = normalizeIdentifier(candidate?.siret);
  for (const link of Array.isArray(links) ? links : []) {
    if (!siret || normalizeIdentifier(link?.siret) !== siret || !link?.verifiedOfficial) continue;
    if (link.source === "finess") {
      const registry = link.registryEvidence;
      const binding = link.officialBinding;
      const names = new Set(targetNameVariants(row, { includeCategoryFallback: false }));
      const publicName = (link.publicNames ?? []).some(name => names.has(normalizeIdentity(name)));
      const address = addressEvidence(row?.Adresse, link.adresse);
      const officialAddress = addressEvidence(candidate.adresse, link.adresse);
      const id = normalizeFiness(link.sourceRecordId);
      if (id && registry?.finess === id && registry?.siret === siret
        && registry?.type === "EGE" && registry?.status === "A"
        && binding?.siret === siret && binding?.finessIds?.includes(id)
        && candidate.finessIds?.includes(id) && publicName && !aliasRelation(row, candidate).publicAliasMismatch
        && address.compatible && address.postal === "same" && address.commune === "same"
        && officialAddress.compatible && officialAddress.postal === "same" && officialAddress.commune === "same") {
        return { verified: true, link, nameCompatible: true, siteCompatible: true, distance: null };
      }
      continue;
    }
    const pseudoCandidate = {
      aliases: link.publicNames ?? [],
      nomCommercial: (link.publicNames ?? [])[0] ?? "",
      nomUsuelDistinct: Boolean((link.publicNames ?? []).length),
      raisonSociale: "",
    };
    const names = aliasRelation(row, pseudoCandidate);
    const address = addressEvidence(row?.Adresse, link?.adresse);
    const rowCoords = targetCoordinates(row, null);
    const linkCoords = usableCoordinates(link?.latitude, link?.longitude);
    const distance = distanceMeters(rowCoords, linkCoords);
    const nameCompatible = names.exactDistinctiveAlias || names.strongDistinctiveAlias;
    const siteCompatible = address.compatible || (distance !== null && distance <= 300);
    if (nameCompatible && siteCompatible) {
      return { verified: true, link, nameCompatible, siteCompatible, distance };
    }
  }
  return { verified: false, link: null, nameCompatible: false, siteCompatible: false, distance: null };
}

function mergeCandidateGroup(group) {
  const sorted = [...group].sort((a, b) => String(a.siret).localeCompare(String(b.siret)) || String(a.adresse).localeCompare(String(b.adresse)));
  const first = sorted[0];
  const aliases = unique(sorted.flatMap(item => item.aliases ?? []).concat(sorted.filter(item => item.nomUsuelDistinct).map(item => item.nomCommercial)));
  return {
    ...first,
    aliases,
    finessIds: unique(sorted.flatMap(item => item.finessIds ?? []).map(normalizeFiness)),
    nomUsuelDistinct: aliases.length > 0,
    nomCommercial: aliases[0] || first.nomCommercial,
    observations: sorted,
  };
}

export function mergeOfficialCandidates(candidates) {
  const groups = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const siret = normalizeIdentifier(candidate?.siret);
    if (siret.length !== 14) continue;
    if (!groups.has(siret)) groups.set(siret, []);
    groups.get(siret).push(candidate);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => mergeCandidateGroup(group));
}

function bestAddressEvidence(row, candidate) {
  const observations = Array.isArray(candidate?.observations) && candidate.observations.length ? candidate.observations : [candidate];
  const all = observations.map(item => addressEvidence(row?.Adresse, item?.adresse));
  return all.sort((a, b) => Number(b.complete) - Number(a.complete) || Number(b.compatible) - Number(a.compatible) || b.streetSimilarity - a.streetSimilarity)[0]
    || addressEvidence(row?.Adresse, candidate?.adresse);
}

function bestDistance(row, candidate, location) {
  const target = targetCoordinates(row, location);
  if (!target) return null;
  const observations = Array.isArray(candidate?.observations) && candidate.observations.length ? candidate.observations : [candidate];
  const distances = observations
    .map(item => distanceMeters(target, usableCoordinates(item?.latitude, item?.longitude)))
    .filter(value => value !== null);
  return distances.length ? Math.min(...distances) : null;
}

export function candidateCertificate(row, candidate, { location = null, links = [] } = {}) {
  const identifiers = identifierParts(row?.SirenSiret);
  const candidateSiret = normalizeIdentifier(candidate?.siret);
  const exactSiret = Boolean(identifiers.siret && identifiers.siret === candidateSiret);
  const names = aliasRelation(row, candidate);
  const address = bestAddressEvidence(row, candidate);
  const distance = bestDistance(row, candidate, location);
  const link = linkEvidenceFor(candidate, row, links);
  const inactive = candidate?.etatAdministratif && candidate.etatAdministratif !== "A";
  const conflict = Boolean(inactive || address.conflict);

  const publicIdentity = names.exactDistinctiveAlias || names.strongDistinctiveAlias;
  const legalIdentity = !names.publicAliasMismatch && (names.legalExact || names.legalStrong);
  const typedLegalIdentity = legalIdentity && names.categoryMatch;
  const positiveIdentity = exactSiret || link.verified || publicIdentity || typedLegalIdentity || legalIdentity;

  let level = "weak";
  if (!conflict) {
    if (exactSiret || link.verified || (names.exactDistinctiveAlias && address.complete)) level = "verified";
    else if (
      (publicIdentity && address.compatible)
      || (typedLegalIdentity && address.compatible)
      || (legalIdentity && address.complete)
    ) level = "probable";
  }

  const explanations = [];
  if (exactSiret) explanations.push("SIRET identique à la fiche et revalidé dans l’Annuaire");
  if (link.verified) explanations.push(link.link?.source === "finess"
    ? `FINESS géographique ${link.link.sourceRecordId} : nom public et adresse concordants, SIRET ${candidateSiret} explicite et rattachement FINESS revalidé dans l’Annuaire`
    : `Référence SIRET explicite ${link.link?.sourceLabel || link.link?.source || "POI"}, revalidée dans l’Annuaire`);
  if (names.exactDistinctiveAlias) explanations.push(`Nom public distinctif concordant${names.bestAlias ? ` : ${names.bestAlias}` : ""}`);
  else if (names.strongDistinctiveAlias) explanations.push(`Termes distinctifs du nom public concordants${names.bestAlias ? ` : ${names.bestAlias}` : ""}`);
  else if (names.categoryMatch && names.legalExact) explanations.push("Type de site compatible et raison sociale concordante");
  else if (names.legalExact) explanations.push("Raison sociale concordante");
  if (address.complete) explanations.push("Adresse de site complète concordante");
  else if (address.compatible) explanations.push("Adresse de site compatible mais incomplète");
  if (distance !== null && distance <= 300) explanations.push(`Localisation compatible (${Math.round(distance)} m)`);
  if (names.publicAliasMismatch) explanations.push("Nom public de cet établissement incompatible avec la fiche");
  if (address.conflict) explanations.push("Contradiction d’adresse explicite");
  if (inactive) explanations.push("Établissement signalé non actif");

  return {
    siret: candidateSiret,
    candidate,
    level,
    admissible: positiveIdentity && !conflict,
    conflict,
    exactSiret,
    explicitLink: link.verified,
    names,
    address,
    distanceMeters: distance,
    explanations,
  };
}

export function summarizeCoverage(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  const required = list.filter(item => item?.required !== false);
  const failed = required.filter(item => item?.status === "error" || item?.status === "timeout");
  const truncated = required.filter(item => item?.coverage && item.coverage.complete === false);
  return {
    complete: failed.length === 0 && truncated.length === 0,
    failed,
    truncated,
    entries: list,
  };
}

function deterministicCertificates(certificates) {
  const rank = { verified: 0, probable: 1, weak: 2 };
  return [...certificates].sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9) || a.siret.localeCompare(b.siret));
}

export function decideIdentity({ row, candidates = [], links = [], coverage = [], location = null } = {}) {
  const merged = mergeOfficialCandidates(candidates);
  const certificates = deterministicCertificates(merged.map(candidate => candidateCertificate(row, candidate, { links, location })));
  const coverageSummary = summarizeCoverage(coverage);
  const identifiers = identifierParts(row?.SirenSiret);
  const exactCertificate = identifiers.siret ? certificates.find(item => item.exactSiret) : null;

  if (identifiers.siret) {
    if (exactCertificate?.level === "verified") {
      return {
        status: IDENTITY_STATES.MATCH_VERIFIED,
        candidate: exactCertificate.candidate,
        alternatives: [],
        certificates,
        coverage: coverageSummary,
        reason: "Le SIRET de la fiche a été revalidé sans contradiction de site.",
      };
    }
    if (exactCertificate?.conflict) {
      return {
        status: IDENTITY_STATES.INCOMPLETE,
        candidate: exactCertificate.candidate,
        alternatives: [],
        certificates,
        coverage: coverageSummary,
        reason: "Le SIRET existe mais des informations explicites du site se contredisent.",
      };
    }
    return {
      status: coverageSummary.complete ? IDENTITY_STATES.NO_MATCH : IDENTITY_STATES.INCOMPLETE,
      candidate: null,
      alternatives: [],
      certificates,
      coverage: coverageSummary,
      reason: coverageSummary.complete
        ? "Le SIRET fourni n’a pas été revalidé dans le périmètre exploré."
        : "La validation du SIRET n’a pas pu être menée à terme.",
    };
  }

  const verified = certificates.filter(item => item.level === "verified" && item.admissible);
  const probable = certificates.filter(item => item.level === "probable" && item.admissible);

  if (verified.length === 1) {
    return {
      status: IDENTITY_STATES.MATCH_VERIFIED,
      candidate: verified[0].candidate,
      alternatives: probable.map(item => item.candidate).slice(0, 2),
      certificates,
      coverage: coverageSummary,
      reason: "Un seul établissement possède une chaîne de preuves suffisante.",
    };
  }

  if (verified.length > 1) {
    return {
      status: IDENTITY_STATES.AMBIGUOUS,
      candidate: null,
      alternatives: verified.slice(0, 2).map(item => item.candidate),
      certificates,
      coverage: coverageSummary,
      reason: "Plusieurs établissements possèdent des preuves de même niveau.",
    };
  }

  if (!coverageSummary.complete && probable.length) {
    return {
      status: IDENTITY_STATES.INCOMPLETE,
      candidate: probable.length === 1 ? probable[0].candidate : null,
      alternatives: probable.slice(0, 2).map(item => item.candidate),
      certificates,
      coverage: coverageSummary,
      reason: "Un candidat est plausible mais une recherche nécessaire est incomplète.",
    };
  }

  if (probable.length === 1) {
    return {
      status: IDENTITY_STATES.MATCH_PROBABLE,
      candidate: probable[0].candidate,
      alternatives: [],
      certificates,
      coverage: coverageSummary,
      reason: "Un seul établissement reste probable, mais une preuve manque pour le confirmer.",
    };
  }

  if (probable.length > 1) {
    return {
      status: IDENTITY_STATES.AMBIGUOUS,
      candidate: null,
      alternatives: probable.slice(0, 2).map(item => item.candidate),
      certificates,
      coverage: coverageSummary,
      reason: "Plusieurs établissements restent plausibles et aucune preuve ne les départage.",
    };
  }

  return {
    status: coverageSummary.complete ? IDENTITY_STATES.NO_MATCH : IDENTITY_STATES.INCOMPLETE,
    candidate: null,
    alternatives: [],
    certificates,
    coverage: coverageSummary,
    reason: coverageSummary.complete
      ? "Aucun établissement ne dispose des preuves d’identité nécessaires dans le périmètre exploré."
      : "L’analyse ne dispose pas d’une couverture suffisante pour conclure.",
  };
}

export function decisionCandidates(decision) {
  if (!decision) return [];
  if (decision.candidate) return [decision.candidate];
  return Array.isArray(decision.alternatives) ? decision.alternatives.slice(0, 2) : [];
}

export function decisionEvidence(decision, candidate) {
  const siret = normalizeIdentifier(candidate?.siret);
  return decision?.certificates?.find(item => item.siret === siret)?.explanations ?? [];
}
