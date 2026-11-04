import { communeAliases } from "./commune-labels.js";
import {
  extractLocationFromAddress,
  identifierParts,
  normalize,
  normalizeFiness,
  normalizeIdentifier,
} from "./search.js";

export const IDENTITY_STATES = Object.freeze({
  MATCH_VERIFIED: "MATCH_VERIFIED",
  MATCH_PROBABLE: "MATCH_PROBABLE",
  AMBIGUOUS: "AMBIGUOUS",
  NO_MATCH: "NO_MATCH",
  INCOMPLETE: "INCOMPLETE",
});

const FUNCTION_WORDS = new Set([
  "a",
  "au",
  "aux",
  "d",
  "de",
  "des",
  "du",
  "et",
  "en",
  "l",
  "la",
  "le",
  "les",
  "sur",
  "chez",
]);

const GENERIC_CATEGORY_TOKENS = new Set([
  "association",
  "cabinet",
  "centre",
  "college",
  "creche",
  "ecole",
  "ehpad",
  "foyer",
  "garage",
  "hotel",
  "lycee",
  "magasin",
  "maison",
  "microcreche",
  "restaurant",
  "service",
  "soins",
  "station",
  "supermarche",
]);

const STREET_TYPE_TOKENS = new Set([
  "allee",
  "av",
  "avenue",
  "bd",
  "boulevard",
  "chemin",
  "impasse",
  "place",
  "quai",
  "route",
  "rue",
]);

const STREET_NOISE_TOKENS = new Set([
  ...FUNCTION_WORDS,
  "commercial",
  "commerciale",
  "espace",
  "lieu",
  "dit",
  "za",
  "zac",
  "zi",
  "zone",
]);

function canonicalToken(token) {
  if (token === "st") return "saint";
  if (token === "ste") return "sainte";
  return (
    {
      r: "rue",
      pl: "place",
      rte: "route",
      che: "chemin",
      av: "avenue",
      bd: "boulevard",
      imp: "impasse",
    }[token] || token
  );
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
  const official = Object.entries(communeAliases).find(
    ([alias]) => normalizeIdentity(alias) === normalizeIdentity(value),
  );
  return comparisonTokens(official?.[1] || value)
    .filter((token) => !FUNCTION_WORDS.has(token))
    .join(" ");
}

function stripPostalTokens(value) {
  return comparisonTokens(value)
    .filter((token) => !/^\d{5}$/.test(token))
    .join(" ");
}

function stripCommuneEdgeWords(value, commune) {
  let text = normalizeIdentity(value);
  const alternatives = [
    commune,
    ...Object.entries(communeAliases)
      .filter(
        ([, target]) => canonicalPlace(target) === canonicalPlace(commune),
      )
      .map(([alias]) => alias),
  ]
    .map(normalizeIdentity)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const town of alternatives) {
    if (text.endsWith(" " + town)) return text.slice(0, -town.length - 1);
    if (text.startsWith(town + " ")) return text.slice(town.length + 1);
  }
  return text;
}

function withoutLeadingGenericCategory(value) {
  const words = comparisonTokens(value);
  if (words.length < 2 || !GENERIC_CATEGORY_TOKENS.has(words[0])) return "";
  if (words[0] === "micro" && words[1] === "creche")
    return words.slice(2).join(" ");
  return words.slice(1).join(" ");
}

export function targetNameVariants(
  row,
  { includeCategoryFallback = true } = {},
) {
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
  if (withoutCategory && distinctiveTokens(withoutCategory).length >= 2)
    return normalizeIdentity(withoutCategory);
  return normalizeIdentity(neutral || variants[0]);
}

function distinctiveTokens(value) {
  return comparisonTokens(value).filter(
    (token) =>
      !FUNCTION_WORDS.has(token) && !GENERIC_CATEGORY_TOKENS.has(token),
  );
}

function genericCategories(value) {
  return comparisonTokens(value).filter((token) =>
    GENERIC_CATEGORY_TOKENS.has(token),
  );
}

function tokenCoverage(required, observed) {
  const requiredTokens = distinctiveTokens(required);
  const observedSet = new Set(distinctiveTokens(observed));
  if (!requiredTokens.length) return 0;
  return (
    requiredTokens.filter((token) => observedSet.has(token)).length /
    requiredTokens.length
  );
}

function aliasRelation(row, candidate) {
  const targetVariants = targetNameVariants(row);
  const aliases = unique(
    [
      ...(Array.isArray(candidate?.aliases) ? candidate.aliases : []),
      candidate?.nomUsuelDistinct ? candidate?.nomCommercial : "",
    ].map(normalizeIdentity),
  );

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
        else if (
          aliasCategories.some((token) =>
            genericCategories(target).includes(token),
          )
        )
          category = true;
        bestAlias ||= alias;
      }
      if (aliasDistinctive.length) {
        const targetToAlias = tokenCoverage(target, alias);
        const aliasToTarget = tokenCoverage(alias, target);
        if (targetToAlias >= 0.8 && aliasToTarget >= 0.8) {
          strong = true;
          bestAlias ||= alias;
        }
      } else if (
        aliasCategories.some((token) =>
          genericCategories(target).includes(token),
        )
      ) {
        category = true;
        bestAlias ||= alias;
      }
    }
  }

  const legal = normalizeIdentity(candidate?.raisonSociale);
  const legalExact = Boolean(legal && targetVariants.includes(legal));
  const legalStrong = Boolean(
    legal &&
      targetVariants.some((target) => {
        const left = tokenCoverage(target, legal);
        const right = tokenCoverage(legal, target);
        return left >= 0.9 && right >= 0.9;
      }),
  );

  const publicAliasMismatch = Boolean(
    candidate?.nomUsuelDistinct &&
      aliases.length &&
      !exact &&
      !strong &&
      !category,
  );

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
  const match = String(addressBeforePostal ?? "").match(
    /\b(\d{1,5})\s*(bis|ter|quater|[a-z])?\b/i,
  );
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
  const raw = normalizeAddressTypography(address).normalized;
  const postal = [...raw.matchAll(/\b\d{5}\b/g)].at(-1);
  const beforePostal = postal ? raw.slice(0, postal.index) : raw;
  const detailed =
    /\b\d+\s*(?:bis|ter|[a-d])?\s+(?:rue|r|bd|boulevard|avenue|route|chemin|place)\b/i.test(
      beforePostal,
    )
      ? beforePostal.replace(
          /\s+\b(?:ZA|ZAC|ZI|ZONE ARTISANALE|ZONE INDUSTRIELLE)\b.*$/i,
          "",
        )
      : beforePostal;
  const normalized = comparisonTokens(detailed);
  const typeIndex = normalized.findIndex((token) =>
    STREET_TYPE_TOKENS.has(token),
  );
  const scoped = typeIndex >= 0 ? normalized.slice(typeIndex) : normalized;
  const communeWords = new Set(comparisonTokens(commune));
  return scoped
    .filter((token) => !/^\d+[a-z]*$/.test(token))
    .filter((token) => !STREET_TYPE_TOKENS.has(token))
    .filter((token) => !STREET_NOISE_TOKENS.has(token))
    .filter((token) => !communeWords.has(token));
}

// A typed Roman numeral can contain lowercase l glyphs instead of uppercase I.
// Correct only an otherwise invalid numeral with an uppercase Roman prefix and
// repeated lowercase l suffix. Valid numerals (XL, LIII, XXII), house numbers,
// arbitrary words and single ambiguous letters are left intact.
export function normalizeAddressTypography(value) {
  const changes = [];
  const valid = (text) =>
    /^(?=.+)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(text);
  const normalized = String(value ?? "").replace(
    /\b([MDCLXVI]+)(l{2,})\b/g,
    (token, prefix, suffix) => {
      const replacement = prefix + "I".repeat(suffix.length);
      if (valid(token.toUpperCase()) || !valid(replacement)) return token;
      changes.push({
        kind: "ROMAN_NUMERAL_HOMOGLYPH",
        original: token,
        normalized: replacement,
      });
      return replacement;
    },
  );
  return { normalized, changes };
}

function setSimilarity(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const jaccard = union ? intersection / union : 0;
  const containment = intersection / Math.min(a.size, b.size);
  return Math.max(jaccard, containment * 0.95);
}

export function parseSiteAddress(value, { communeHint = "" } = {}) {
  const raw = String(value ?? "").trim();
  const location = extractLocationFromAddress(raw);
  const postalMatch = [...raw.matchAll(/\b\d{5}\b/g)].at(-1);
  const beforePostal = postalMatch ? raw.slice(0, postalMatch.index) : raw;
  const house = parseHouseNumber(
    beforePostal.replace(/\b(?:BP|CS)\s*\d+\b/gi, ""),
  );
  // Missing postcode does not erase an explicitly written commune. A hint is
  // accepted only when its complete canonical name is a suffix of the input.
  const hinted =
    !location.commune &&
    communeHint &&
    canonicalPlace(raw).endsWith(` ${canonicalPlace(communeHint)}`)
      ? communeHint
      : "";
  const commune = location.commune || hinted;
  return {
    raw,
    codePostal: location.codePostal,
    commune: canonicalPlace(commune),
    number: house.number,
    repetition: house.repetition,
    streetTokens: streetTokens(raw, commune),
    typography: normalizeAddressTypography(raw).changes,
  };
}

export function addressEvidence(targetAddress, candidateAddress) {
  const initialTarget = parseSiteAddress(targetAddress);
  const initialCandidate = parseSiteAddress(candidateAddress);
  const target = parseSiteAddress(targetAddress, {
    communeHint: initialCandidate.commune,
  });
  const candidate = parseSiteAddress(candidateAddress, {
    communeHint: initialTarget.commune,
  });
  const postal =
    target.codePostal && candidate.codePostal
      ? target.codePostal === candidate.codePostal
        ? "same"
        : "conflict"
      : "unknown";
  let commune =
    target.commune && candidate.commune
      ? target.commune === candidate.commune
        ? "same"
        : "conflict"
      : "unknown";
  const streetSimilarity = setSimilarity(
    target.streetTokens,
    candidate.streetTokens,
  );
  const street =
    streetSimilarity >= 0.9
      ? "same"
      : streetSimilarity >= 0.72
        ? "compatible"
        : target.streetTokens.length && candidate.streetTokens.length
          ? "conflict"
          : "unknown";
  const number =
    target.number && candidate.number
      ? target.number === candidate.number
        ? "same"
        : "conflict"
      : "unknown";
  const repetition = repetitionRelation(
    target.repetition,
    candidate.repetition,
  );
  if (
    commune === "conflict" &&
    postal === "same" &&
    street === "same" &&
    number === "same"
  ) {
    const shorter =
      target.commune.length < candidate.commune.length
        ? target.commune
        : candidate.commune;
    const longer =
      shorter === target.commune ? candidate.commune : target.commune;
    if (
      !["saint", "sainte"].includes(shorter) &&
      longer.startsWith(shorter + " ")
    )
      commune = "same";
  }

  const conflict =
    postal === "conflict" ||
    commune === "conflict" ||
    street === "conflict" ||
    number === "conflict" ||
    repetition === "conflict";
  const compatible =
    !conflict &&
    (postal === "same" || postal === "unknown") &&
    (commune === "same" || commune === "unknown") &&
    (street === "same" || street === "compatible");
  const complete =
    compatible &&
    postal === "same" &&
    street === "same" &&
    number === "same" &&
    (repetition === "same" ||
      repetition === "compatible" ||
      (!target.repetition && !candidate.repetition));

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

// A different entrance is an alias only when the operator explicitly publishes
// both addresses and its own exact registration. An address resemblance is insufficient.
export function publishedAccessBinding(record, candidate) {
  if (
    record?.publisherKind !== "operator" ||
    record.siret !== candidate?.siret ||
    candidate.etatAdministratif !== "A" ||
    !record.registeredAddress ||
    !record.access
  )
    return null;
  try {
    if (
      new URL(record.registration?.url).origin !== new URL(record.url).origin ||
      new URL(record.access.url).origin !== new URL(record.url).origin
    )
      return null;
  } catch {
    return null;
  }
  if (
    !/^[a-f0-9]{64}$/.test(record.registration?.sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(record.access.sourceSha256 ?? "")
  )
    return null;
  const proofText = (key) => {
    const p = record.native?.fields?.[key];
    return p && String(p.value) === String(record[key])
      ? String(p.excerpts?.join(" ") ?? "").replace(/<[^>]*>/g, " ")
      : "";
  };
  if (!proofText("siret").replace(/\D/g, "").includes(candidate.siret))
    return null;
  const tokens = new Set(
    normalizeIdentity(proofText("registeredAddress")).split(" "),
  );
  if (comparisonTokens(record.registeredAddress).some((t) => !tokens.has(t)))
    return null;
  const registered = addressEvidence(
    record.registeredAddress,
    candidate.adresse,
  );
  if (!registered.complete || registered.commune !== "same") return null;
  const html = normalizeIdentity(
    String(record.access.nativeHtml ?? "").replace(/<[^>]*>/g, " "),
  );
  const afterAccess = html.split("acces").slice(1).join("acces");
  if (
    !afterAccess.includes("par ") ||
    !afterAccess.includes(normalizeIdentity(record.access.street))
  )
    return null;
  const physical = parseSiteAddress(record.adresse),
    official = parseSiteAddress(record.registeredAddress);
  if (
    physical.codePostal !== official.codePostal ||
    physical.commune !== official.commune
  )
    return null;
  if (
    comparisonTokens(record.adresse).some((t) => !html.split(" ").includes(t))
  )
    return null;
  const access = parseSiteAddress(
    `${record.access.street} ${physical.codePostal} ${record.commune}`,
  );
  if (
    [...new Set(access.streetTokens)].sort().join(" ") !==
    [...new Set(official.streetTokens)].sort().join(" ")
  )
    return null;
  return {
    kind: "PUBLISHED_ACCESS",
    physicalAddress: record.adresse,
    registeredAddress: record.registeredAddress,
    source: {
      label: record.publisherLabel,
      url: record.registration.url,
      version: record.registration.sha256,
    },
    access: record.access,
  };
}

function coordinateValue(value, min, max) {
  if (value === undefined || value === null || String(value).trim() === "")
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
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
  const lat1 = (a.latitude * Math.PI) / 180;
  const lon1 = (a.longitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const lon2 = (b.longitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function targetCoordinates(row, location) {
  return (
    usableCoordinates(row?.Latitude, row?.Longitude) ||
    usableCoordinates(location?.latitude, location?.longitude)
  );
}

export function registryPublicNameMatch(
  target,
  published,
  kind,
  categoryCode = "",
  siteType = "",
) {
  const input = comparisonTokens(target);
  const official = comparisonTokens(published);
  const schoolTypes = new Set(["ecole", "college", "lycee"]);
  if (kind === "education") {
    const requested = input.find((token) => schoolTypes.has(token));
    const actual =
      official.find((token) => schoolTypes.has(token)) ||
      comparisonTokens(siteType).find((token) => schoolTypes.has(token));
    if (requested && requested !== actual) return false;
  } else if (kind === "finess" || categoryCode) {
    const categories = { ehpad: "500", ssiad: "354", usld: "362" };
    if (
      input.some(
        (token) => categories[token] && categories[token] !== categoryCode,
      )
    )
      return false;
  }
  const descriptors = new Set(
    kind === "education"
      ? [
          "ecole",
          "college",
          "lycee",
          "groupe",
          "scolaire",
          "primaire",
          "prive",
          "privee",
          "public",
          "publique",
          "elementaire",
          "maternelle",
          "general",
          "generale",
          "technologique",
          "professionnel",
          "professionnelle",
          "agricole",
          ...FUNCTION_WORDS,
        ]
      : ["ehpad", "residence", "ssiad", "usld", ...FUNCTION_WORDS],
  );
  const stem = (words) => {
    let index = 0;
    while (index < words.length && descriptors.has(words[index])) index += 1;
    return words
      .slice(index)
      .filter((token) => !FUNCTION_WORDS.has(token))
      .join(" ");
  };
  const left = stem(input);
  return left.length >= 4 && left === stem(official);
}

export function registrySiteMatches(row, record) {
  const context = siteContextEvidence(row, record);
  return context.matched;
}

export function registryLinkValid(link, candidate, row) {
  const record = link.registryRecord;
  const binding = link.officialBinding;
  if (
    !record ||
    !registrySiteMatches(row, record) ||
    record.siret !== candidate.siret ||
    link.siret !== candidate.siret ||
    record.recordId !== link.sourceRecordId ||
    binding?.siret !== candidate.siret ||
    !binding.checkedAt ||
    !binding.url ||
    candidate.etatAdministratif !== "A"
  )
    return false;
  const address = addressEvidence(candidate.adresse, record.adresse);
  if (
    !address.compatible ||
    address.postal !== "same" ||
    address.commune !== "same"
  )
    return false;
  if (record.kind === "education")
    return (
      record.status === "OUVERT" &&
      record.native?.etat === "OUVERT" &&
      record.name === record.native.nom_etablissement &&
      record.publicNames?.includes(record.native.nom_etablissement) &&
      record.native?.identifiant_de_l_etablissement === record.recordId &&
      record.native?.siren_siret === candidate.siret &&
      /^\d{7}[A-Z]$/.test(record.recordId) &&
      candidate.uaiIds?.includes(record.recordId) &&
      binding.uaiIds?.includes(record.recordId)
    );
  return (
    record.kind === "finess" &&
    record.status === "A" &&
    record.native?.etatObjet === "A" &&
    record.native?.informationsGeneralesEGE?.numFinessEge === record.recordId &&
    record.native?.informationsGeneralesEGE?.siret === candidate.siret &&
    normalizeFiness(record.recordId) &&
    candidate.finessIds?.includes(record.recordId) &&
    binding.finessIds?.includes(record.recordId) &&
    link.registryEvidence?.type === "EGE" &&
    link.registryEvidence?.siret === candidate.siret
  );
}

function linkEvidenceFor(candidate, row, links) {
  const siret = normalizeIdentifier(candidate?.siret);
  for (const link of Array.isArray(links) ? links : []) {
    if (
      !siret ||
      normalizeIdentifier(link?.siret) !== siret ||
      !link?.verifiedOfficial
    )
      continue;
    if (link.registryRecord && ["education", "finess"].includes(link.source)) {
      if (registryLinkValid(link, candidate, row))
        return {
          verified: true,
          link,
          nameCompatible: true,
          siteCompatible: true,
          distance: null,
        };
      continue;
    }
    if (link.source === "finess") {
      const registry = link.registryEvidence;
      const binding = link.officialBinding;
      const names = new Set(
        targetNameVariants(row, { includeCategoryFallback: false }),
      );
      const publicName = (link.publicNames ?? []).some((name) =>
        names.has(normalizeIdentity(name)),
      );
      const address = addressEvidence(row?.Adresse, link.adresse);
      const officialAddress = addressEvidence(candidate.adresse, link.adresse);
      const id = normalizeFiness(link.sourceRecordId);
      if (
        id &&
        registry?.finess === id &&
        registry?.siret === siret &&
        registry?.type === "EGE" &&
        registry?.status === "A" &&
        binding?.siret === siret &&
        binding?.finessIds?.includes(id) &&
        candidate.finessIds?.includes(id) &&
        publicName &&
        !aliasRelation(row, candidate).publicAliasMismatch &&
        address.compatible &&
        address.postal === "same" &&
        address.commune === "same" &&
        officialAddress.compatible &&
        officialAddress.postal === "same" &&
        officialAddress.commune === "same"
      ) {
        return {
          verified: true,
          link,
          nameCompatible: true,
          siteCompatible: true,
          distance: null,
        };
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
    const nameCompatible =
      names.exactDistinctiveAlias ||
      names.strongDistinctiveAlias ||
      (link.source === "named-site-directory" &&
        siteContextEvidence(row, link.siteRecord).matched) ||
      (link.source === "published-identity" &&
        siteContextEvidence(row, {
          name: link.publicNames?.[0],
          publicNames: link.publicNames,
          adresse: link.adresse,
          commune: link.city,
        }).matched);
    const accessBinding =
      link.source === "named-site-directory" &&
      publishedAccessBinding(link.siteRecord, candidate);
    const physical =
      accessBinding && addressEvidence(row.Adresse, link.siteRecord.adresse);
    const siteCompatible =
      (address.compatible && !address.conflict) ||
      Boolean(physical?.compatible && physical.commune === "same");
    if (nameCompatible && siteCompatible) {
      return { verified: true, link, nameCompatible, siteCompatible, distance };
    }
  }
  return {
    verified: false,
    link: null,
    nameCompatible: false,
    siteCompatible: false,
    distance: null,
  };
}

function mergeCandidateGroup(group) {
  const sorted = [...group].sort(
    (a, b) =>
      String(a.siret).localeCompare(String(b.siret)) ||
      String(a.adresse).localeCompare(String(b.adresse)),
  );
  const first = sorted[0];
  const aliases = unique(
    sorted
      .flatMap((item) => item.aliases ?? [])
      .concat(
        sorted
          .filter((item) => item.nomUsuelDistinct)
          .map((item) => item.nomCommercial),
      ),
  );
  return {
    ...first,
    aliases,
    finessIds: unique(
      sorted.flatMap((item) => item.finessIds ?? []).map(normalizeFiness),
    ),
    uaiIds: unique(sorted.flatMap((item) => item.uaiIds ?? [])),
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
  const observations =
    Array.isArray(candidate?.observations) && candidate.observations.length
      ? candidate.observations
      : [candidate];
  const all = observations.map((item) =>
    addressEvidence(row?.Adresse, item?.adresse),
  );
  return (
    all.sort(
      (a, b) =>
        Number(b.complete) - Number(a.complete) ||
        Number(b.compatible) - Number(a.compatible) ||
        b.streetSimilarity - a.streetSimilarity,
    )[0] || addressEvidence(row?.Adresse, candidate?.adresse)
  );
}

function bestDistance(row, candidate, location) {
  const target = targetCoordinates(row, location);
  if (!target) return null;
  const observations =
    Array.isArray(candidate?.observations) && candidate.observations.length
      ? candidate.observations
      : [candidate];
  const distances = observations
    .map((item) =>
      distanceMeters(
        target,
        usableCoordinates(item?.latitude, item?.longitude),
      ),
    )
    .filter((value) => value !== null);
  return distances.length ? Math.min(...distances) : null;
}

export function candidateCertificate(
  row,
  candidate,
  { location = null, links = [] } = {},
) {
  const identifiers = identifierParts(row?.SirenSiret);
  const candidateSiret = normalizeIdentifier(candidate?.siret);
  const exactSiret = Boolean(
    identifiers.siret && identifiers.siret === candidateSiret,
  );
  const names = aliasRelation(row, candidate);
  let address = bestAddressEvidence(row, candidate);
  const distance = bestDistance(row, candidate, location);
  const link = linkEvidenceFor(candidate, row, links);
  const accessBinding =
    link.verified && publishedAccessBinding(link.link?.siteRecord, candidate);
  if (accessBinding)
    address = addressEvidence(row.Adresse, link.link.siteRecord.adresse);
  const inactive =
    candidate?.etatAdministratif && candidate.etatAdministratif !== "A";
  const conflict = Boolean(
    inactive ||
      address.conflict ||
      (names.publicAliasMismatch && !link.verified),
  );

  const publicIdentity =
    names.exactDistinctiveAlias || names.strongDistinctiveAlias;
  const legalIdentity =
    !names.publicAliasMismatch && (names.legalExact || names.legalStrong);
  const typedLegalIdentity = legalIdentity && names.categoryMatch;
  const supportedIdentifier =
    exactSiret &&
    (publicIdentity || legalIdentity || link.verified) &&
    address.compatible;
  const positiveIdentity =
    supportedIdentifier ||
    link.verified ||
    publicIdentity ||
    typedLegalIdentity ||
    legalIdentity;

  let level = "weak";
  if (!conflict) {
    if (
      supportedIdentifier ||
      link.verified ||
      (names.exactDistinctiveAlias && address.complete)
    )
      level = "verified";
    else if (
      (publicIdentity && address.compatible) ||
      (typedLegalIdentity && address.compatible) ||
      (legalIdentity && address.complete)
    )
      level = "probable";
  }

  const explanations = [];
  if (accessBinding)
    explanations.push(
      "Adresse physique et accès enregistrés reliés explicitement par l’établissement, avec son SIRET propre revalidé.",
    );
  if (exactSiret)
    explanations.push("SIRET identique à la fiche et revalidé dans l’Annuaire");
  if (link.verified)
    explanations.push(
      link.link?.source === "education"
        ? `UAI ${link.link.sourceRecordId} : établissement scolaire ouvert, nom/adresse et SIRET exacts, rattachement UAI revalidé dans l’Annuaire`
        : link.link?.source === "finess"
          ? `FINESS géographique ${link.link.sourceRecordId} : nom public et adresse concordants, SIRET ${candidateSiret} explicite et rattachement FINESS revalidé dans l’Annuaire`
          : `Référence SIRET explicite ${link.link?.sourceLabel || link.link?.source || "POI"}, revalidée dans l’Annuaire`,
    );
  if (names.exactDistinctiveAlias)
    explanations.push(
      `Nom public distinctif concordant${names.bestAlias ? ` : ${names.bestAlias}` : ""}`,
    );
  else if (names.strongDistinctiveAlias)
    explanations.push(
      `Termes distinctifs du nom public concordants${names.bestAlias ? ` : ${names.bestAlias}` : ""}`,
    );
  else if (names.categoryMatch && names.legalExact)
    explanations.push("Type de site compatible et raison sociale concordante");
  else if (names.legalExact) explanations.push("Raison sociale concordante");
  if (address.complete)
    explanations.push("Adresse de site complète concordante");
  else if (address.compatible)
    explanations.push("Adresse de site compatible mais incomplète");
  for (const change of address.target.typography)
    explanations.push(
      `Graphie du chiffre romain normalisée : ${change.original} → ${change.normalized} (confusion l/I)`,
    );
  if (distance !== null && distance <= 300)
    explanations.push(`Localisation compatible (${Math.round(distance)} m)`);
  if (names.publicAliasMismatch && !link.verified)
    explanations.push(
      "Nom public de cet établissement incompatible avec la fiche",
    );
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
  const required = list.filter((item) => item?.required !== false);
  const failed = required.filter(
    (item) => item?.status === "error" || item?.status === "timeout",
  );
  const truncated = required.filter(
    (item) => item?.coverage && item.coverage.complete === false,
  );
  return {
    complete: failed.length === 0 && truncated.length === 0,
    failed,
    truncated,
    entries: list,
  };
}

function deterministicCertificates(certificates) {
  const rank = { verified: 0, probable: 1, weak: 2 };
  return [...certificates].sort(
    (a, b) =>
      (rank[a.level] ?? 9) - (rank[b.level] ?? 9) ||
      a.siret.localeCompare(b.siret),
  );
}

function decideFromSiteEvidence({
  row,
  candidates = [],
  links = [],
  coverage = [],
  location = null,
} = {}) {
  const merged = mergeOfficialCandidates(candidates);
  const certificates = deterministicCertificates(
    merged.map((candidate) =>
      candidateCertificate(row, candidate, { links, location }),
    ),
  );
  const coverageSummary = summarizeCoverage(coverage);
  const verified = certificates.filter(
    (item) => item.level === "verified" && item.admissible,
  );
  const probable = certificates.filter(
    (item) => item.level === "probable" && item.admissible,
  );

  if (verified.length === 1) {
    return {
      status: IDENTITY_STATES.MATCH_VERIFIED,
      candidate: verified[0].candidate,
      alternatives: probable.map((item) => item.candidate).slice(0, 2),
      certificates,
      coverage: coverageSummary,
      reason: "Un seul établissement possède une chaîne de preuves suffisante.",
    };
  }

  if (verified.length > 1) {
    return {
      status: IDENTITY_STATES.AMBIGUOUS,
      candidate: null,
      alternatives: verified.slice(0, 2).map((item) => item.candidate),
      certificates,
      coverage: coverageSummary,
      reason: "Plusieurs établissements possèdent des preuves de même niveau.",
    };
  }

  if (!coverageSummary.complete && probable.length) {
    return {
      status: IDENTITY_STATES.INCOMPLETE,
      candidate: probable.length === 1 ? probable[0].candidate : null,
      alternatives: probable.slice(0, 2).map((item) => item.candidate),
      certificates,
      coverage: coverageSummary,
      reason:
        "Un candidat est plausible mais une recherche nécessaire est incomplète.",
    };
  }

  if (probable.length === 1) {
    return {
      status: IDENTITY_STATES.MATCH_PROBABLE,
      candidate: probable[0].candidate,
      alternatives: [],
      certificates,
      coverage: coverageSummary,
      reason:
        "Un seul établissement reste probable, mais une preuve manque pour le confirmer.",
    };
  }

  if (probable.length > 1) {
    return {
      status: IDENTITY_STATES.AMBIGUOUS,
      candidate: null,
      alternatives: probable.slice(0, 2).map((item) => item.candidate),
      certificates,
      coverage: coverageSummary,
      reason:
        "Plusieurs établissements restent plausibles et aucune preuve ne les départage.",
    };
  }

  return {
    status: coverageSummary.complete
      ? IDENTITY_STATES.NO_MATCH
      : IDENTITY_STATES.INCOMPLETE,
    candidate: null,
    alternatives: [],
    certificates,
    coverage: coverageSummary,
    reason: coverageSummary.complete
      ? "Aucun établissement ne dispose des preuves d’identité nécessaires dans le périmètre exploré."
      : "L’analyse ne dispose pas d’une couverture suffisante pour conclure.",
  };
}

// The entered registration number is fallible user input. It can corroborate
// evidence for this site, but never veto another independently proven site or
// choose between two establishments already supported at the same level.
export function decideIdentity(options = {}) {
  const decision = decideFromSiteEvidence(options);
  const supplied = identifierParts(options.row?.SirenSiret);
  if (!String(options.row?.SirenSiret ?? "").trim()) return decision;
  const candidate = decision.candidate;
  const agrees =
    candidate &&
    (supplied.siret
      ? candidate.siret === supplied.siret
      : supplied.siren && candidate.siren === supplied.siren);
  if (agrees) return decision;
  const entered = String(options.row.SirenSiret).trim();
  const other = decision.certificates.find(
    (item) => item.siret === supplied.siret,
  )?.candidate;
  return {
    ...decision,
    identifierWarning: {
      entered,
      proposedSiret: candidate?.siret ?? null,
      reportedAddress: other?.adresse ?? null,
      message: candidate
        ? `Le numéro renseigné (${entered}) ne corrobore pas l’établissement démontré par son nom et son adresse. SIRET du site : ${candidate.siret}. La correction proposée reste à valider.`
        : `Le numéro renseigné (${entered}) reste un indice non confirmé ; il n’a pas servi à exclure un établissement.`,
    },
  };
}

export function decisionCandidates(decision) {
  if (!decision) return [];
  if (decision.candidate) return [decision.candidate];
  return Array.isArray(decision.alternatives)
    ? decision.alternatives.slice(0, 2)
    : [];
}

export function decisionEvidence(decision, candidate) {
  const siret = normalizeIdentifier(candidate?.siret);
  return (
    decision?.certificates?.find((item) => item.siret === siret)
      ?.explanations ?? []
  );
}

export function phoneKey(value) {
  const digits = String(value ?? "")
    .replace(/^(\+33|0033)\s*\(0\)/, "$1")
    .replace(/\D/g, "")
    .replace(/^0033/, "0")
    .replace(/^33(?=\d{9}$)/, "0");
  return /^0[1-9]\d{8}$/.test(digits) ? digits : "";
}
export const emailKey = (value) =>
  /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(value ?? "").trim())
    ? String(value).trim().toLowerCase()
    : "";
export function webKey(value) {
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol)
      ? u.hostname.toLowerCase().replace(/^www\./, "") +
          u.pathname.replace(/\/$/, "")
      : "";
  } catch {
    return "";
  }
}
const contextNoise = new Set([
  "ecole",
  "groupe",
  "scolaire",
  "primaire",
  "maternelle",
  "elementaire",
  "publique",
  "public",
  "privee",
  "prive",
  "ehpad",
  "residence",
  "association",
  "creche",
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "l",
  "d",
  "et",
  "en",
  "a",
  "saint",
  "sainte",
  "periscolaire",
  "saad",
  "saa",
  "g2l",
]);
function contextNearWord(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1)
    return false;
  let i = 0,
    j = 0,
    errors = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++errors > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return errors + (i < a.length || j < b.length ? 1 : 0) <= 1;
}
export function contextualNameMatch(row, record) {
  const name = String(row.NomCommercial ?? "");
  const requested = comparisonTokens(name).find((t) =>
    ["ecole", "college", "lycee", "ehpad", "ssiad", "usld"].includes(t),
  );
  const actual = comparisonTokens(record.name).find((t) =>
    ["ecole", "college", "lycee", "ehpad", "ssiad", "usld"].includes(t),
  );
  if (requested && actual && requested !== actual) return false;
  if (
    targetNameVariants(row, { includeCategoryFallback: false }).some((target) =>
      (record.publicNames ?? [record.name]).some((n) =>
        registryPublicNameMatch(
          target,
          n,
          record.kind ?? "directory",
          record.categoryCode,
          record.siteType,
        ),
      ),
    )
  )
    return true;
  const place = new Set(comparisonTokens(record.commune));
  const tokens = (v) =>
    comparisonTokens(v).filter(
      (t) => !contextNoise.has(t) && !place.has(t) && !/^\d+$/.test(t),
    );
  const a = tokens(name);
  // Typo tolerance never supplies identity alone: the caller must also bind
  // the full site address or an independently published contact/identifier.
  return (record.publicNames ?? [record.name]).some((alias) => {
    const b = tokens(alias),
      remaining = [...b];
    let edits = 0;
    if (a.length < 2 || a.length > b.length) return false;
    for (const token of a) {
      let index = remaining.indexOf(token);
      if (index < 0) {
        index = remaining.findIndex((other) => contextNearWord(token, other));
        if (index < 0 || ++edits > 1) return false;
      }
      remaining.splice(index, 1);
    }
    return true;
  });
}
export function siteContextEvidence(row, record) {
  const address = addressEvidence(row.Adresse, record.adresse);
  const contact = record.contacts ?? {};
  const phone = phoneKey(row.Telephone);
  const email = emailKey(row.Courriel);
  const web = webKey(row.SiteWeb);
  const uai = String(row.Courriel ?? "")
    .match(/\b(\d{7}[a-z])@ac-[a-z-]+\.fr\b/i)?.[1]
    ?.toUpperCase();
  const anchors = [
    phone && (contact.phones ?? []).map(phoneKey).includes(phone)
      ? "phone"
      : null,
    email && (contact.emails ?? []).map(emailKey).includes(email)
      ? "email"
      : null,
    web && (contact.websites ?? []).map(webKey).includes(web)
      ? "website"
      : null,
    uai && uai === record.recordId ? "uai-email" : null,
  ].filter(Boolean);
  const name = contextualNameMatch(row, record);
  const exactStreet =
    address.street === "same" &&
    address.number === "same" &&
    address.repetition !== "conflict" &&
    (!address.target.repetition || address.candidate.repetition);
  const location = address.commune === "same" || address.postal === "same";
  const suffixUnresolved = Boolean(
    address.target.number &&
      address.candidate.number &&
      Boolean(address.target.repetition) !==
        Boolean(address.candidate.repetition),
  );
  return {
    name,
    address,
    anchors,
    matched:
      name &&
      !address.conflict &&
      !suffixUnresolved &&
      (location || exactStreet || anchors.length > 0),
    conflict: name && address.conflict && anchors.length > 0,
  };
}
