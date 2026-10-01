import { buildNearbySearchQuery, extractLocationFromAddress, identifierParts, normalize } from "./search.js";

const FIELD_LABELS = {
  NomCommercial: "Nom usuel",
  Adresse: "Adresse",
  SirenSiret: "SIREN / SIRET",
  RaisonSociale: "Raison sociale",
  Latitude: "Latitude",
  Longitude: "Longitude",
  Telephone: "Téléphone",
  Courriel: "Courriel",
  SiteWeb: "Site web",
};

const GENERIC_LEADING_QUALIFIERS = new Set([
  "creche",
  "microcreche",
  "micro",
  "ehpad",
  "restaurant",
  "garage",
  "hotel",
  "association",
  "societe",
  "sarl",
  "sas",
]);

const ADDRESS_STOP_WORDS = new Set([
  "rue", "route", "avenue", "av", "boulevard", "bd", "chemin", "impasse", "place", "allee",
  "zone", "commerciale", "za", "zi", "lotissement", "lieu", "dit", "de", "des", "du", "la", "le", "les",
  "bis", "ter",
]);

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function coordinatesAreUsable(latitudeValue, longitudeValue) {
  if (!hasValue(latitudeValue) || !hasValue(longitudeValue)) return false;
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false;
  return !(Math.abs(latitude) < 1e-12 && Math.abs(longitude) < 1e-12);
}

function numericEqual(a, b) {
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-7;
}

function valuesEqual(field, current, proposed) {
  if (field === "Latitude" || field === "Longitude") return numericEqual(current, proposed);
  if (field === "SirenSiret") {
    const left = identifierParts(current);
    const right = identifierParts(proposed);
    return Boolean(left.identifier && right.identifier && left.identifier === right.identifier);
  }
  return normalize(current) === normalize(proposed);
}

function normalizedWords(value) {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function stripPostalTokens(value) {
  return String(value ?? "")
    .split(/\s+/)
    .filter(token => !/^\d{5}$/.test(token))
    .join(" ")
    .trim();
}

function stripLocationEdgeWords(name, commune) {
  const words = normalizedWords(name);
  const locationWords = new Set(normalizedWords(commune));
  if (!words.length || !locationWords.size) return normalize(name);

  let start = 0;
  let end = words.length;
  while (end - start > 1 && locationWords.has(words[end - 1])) end -= 1;
  while (end - start > 1 && locationWords.has(words[start])) start += 1;
  return words.slice(start, end).join(" ");
}

function dropLeadingQualifier(name) {
  const words = normalizedWords(name);
  if (words.length < 2 || !GENERIC_LEADING_QUALIFIERS.has(words[0])) return "";
  if (words[0] === "micro" && words[1] === "creche") return words.slice(2).join(" ");
  return words.slice(1).join(" ");
}

function dropSingleLetterTokens(name) {
  const words = normalizedWords(name);
  const filtered = words.filter(word => word.length > 1);
  if (!filtered.length || filtered.length === words.length) return "";
  return filtered.join(" ");
}

function addressSearchHint(address) {
  const raw = String(address ?? "").trim();
  if (!raw) return "";
  const postalMatch = raw.match(/\b\d{5}\b/);
  const streetPart = postalMatch ? raw.slice(0, postalMatch.index) : raw;
  const words = normalizedWords(streetPart)
    .filter(word => !/^\d+[a-z]*$/.test(word))
    .filter(word => !ADDRESS_STOP_WORDS.has(word));
  return words.slice(-3).join(" ");
}

function addSearchVariant(variants, value) {
  const query = String(value ?? "").trim();
  if (!query) return;
  const key = normalize(query);
  if (!key || variants.some(item => normalize(item) === key)) return;
  variants.push(query);
}

function addSearchAttempt(attempts, query, codePostal) {
  const normalizedQuery = normalize(query);
  const postal = /^\d{5}$/.test(String(codePostal ?? "").trim()) ? String(codePostal).trim() : "";
  if (!normalizedQuery) return;
  if (attempts.some(item => normalize(item.query) === normalizedQuery && item.codePostal === postal)) return;
  attempts.push({ query: String(query).trim(), codePostal: postal });
}

export function diagnoseRow(row) {
  if (!row) return null;
  const identifier = identifierParts(row.SirenSiret);
  const coordinatesComplete = coordinatesAreUsable(row.Latitude, row.Longitude);
  const location = extractLocationFromAddress(row.Adresse);

  return {
    hasName: hasValue(row.NomCommercial),
    hasAddress: hasValue(row.Adresse),
    hasIdentifier: Boolean(identifier.siren),
    hasSiret: Boolean(identifier.siret),
    hasLegalName: hasValue(row.RaisonSociale),
    hasCoordinates: coordinatesComplete,
    codePostal: location.codePostal,
    commune: location.commune,
    needsEnterprise: !identifier.siret || !hasValue(row.RaisonSociale),
    needsGeocode: hasValue(row.Adresse) && !coordinatesComplete,
  };
}

export function enterpriseSearchAttempts(row, geocodeCandidate = null) {
  const identifier = identifierParts(row?.SirenSiret);
  if (identifier.identifier) return [{ query: identifier.identifier, codePostal: "" }];

  const sourceAddress = geocodeCandidate?.adresse || row?.Adresse;
  const fromAddress = extractLocationFromAddress(sourceAddress);
  const codePostal = geocodeCandidate?.codePostal || fromAddress.codePostal;
  const commune = geocodeCandidate?.commune || fromAddress.commune;
  const rawName = String(row?.NomCommercial ?? "").trim();
  if (!rawName) return [];

  const name = stripPostalTokens(rawName);
  const attempts = [];

  // L'adresse géocodée est un signal d'établissement bien plus discriminant que
  // le moteur plein texte. On interroge d'abord les établissements réellement
  // voisins, puis on ne conserve côté client que ceux dont le nom correspond.
  if (geocodeCandidate && coordinatesAreUsable(geocodeCandidate.latitude, geocodeCandidate.longitude)) {
    for (const radius of [0.25, 0.75]) {
      addSearchAttempt(attempts, buildNearbySearchQuery({
        latitude: geocodeCandidate.latitude,
        longitude: geocodeCandidate.longitude,
        radius,
        name,
        address: sourceAddress,
      }), codePostal);
    }
  }

  const variants = [];
  addSearchVariant(variants, name);
  addSearchVariant(variants, stripLocationEdgeWords(name, commune));

  const shortestUsefulName = variants.at(-1) || name;
  addSearchVariant(variants, dropLeadingQualifier(shortestUsefulName));
  const weakTokenFallback = dropSingleLetterTokens(variants.at(-1) || shortestUsefulName);

  const streetHint = codePostal ? addressSearchHint(sourceAddress) : "";
  if (streetHint) {
    addSearchAttempt(attempts, `${variants[0]} ${streetHint}`, codePostal);
    if (variants.length > 1) addSearchAttempt(attempts, `${variants.at(-1)} ${streetHint}`, codePostal);
  }

  for (const query of variants) addSearchAttempt(attempts, query, codePostal);
  if (weakTokenFallback) addSearchAttempt(attempts, weakTokenFallback, codePostal);
  if (codePostal) addSearchAttempt(attempts, name, "");
  return attempts.slice(0, 8);
}

export function enterpriseSearchContext(row, geocodeCandidate = null) {
  const identifier = identifierParts(row?.SirenSiret);
  if (identifier.identifier) return { query: identifier.identifier, codePostal: "" };
  const fromAddress = extractLocationFromAddress(geocodeCandidate?.adresse || row?.Adresse);
  const codePostal = geocodeCandidate?.codePostal || fromAddress.codePostal;
  return { query: stripPostalTokens(String(row?.NomCommercial ?? "").trim()), codePostal };
}

function proposal(field, current, proposed, source) {
  if (!hasValue(proposed) || valuesEqual(field, current, proposed)) return null;
  return {
    field,
    label: FIELD_LABELS[field] || field,
    current,
    proposed,
    source,
    selectedByDefault: !hasValue(current),
    replacesExisting: hasValue(current),
  };
}

export function buildEnrichmentProposals(row, enterpriseCandidate = null, geocodeCandidate = null) {
  const proposals = [];
  const add = item => { if (item) proposals.push(item); };

  if (enterpriseCandidate) {
    if (enterpriseCandidate.nomUsuelDistinct || !hasValue(row.NomCommercial)) {
      add(proposal("NomCommercial", row.NomCommercial, enterpriseCandidate.nomCommercial, "Annuaire des Entreprises"));
    }
    add(proposal("SirenSiret", row.SirenSiret, enterpriseCandidate.siret || enterpriseCandidate.siren, "Annuaire des Entreprises"));
    add(proposal("RaisonSociale", row.RaisonSociale, enterpriseCandidate.raisonSociale, "Annuaire des Entreprises"));
  }

  const addressSource = geocodeCandidate || enterpriseCandidate;
  if (addressSource) {
    add(proposal("Adresse", row.Adresse, addressSource.adresse, geocodeCandidate ? "Géocodage IGN" : "Annuaire des Entreprises"));
  }

  const coordinateSource = geocodeCandidate || enterpriseCandidate;
  if (coordinateSource) {
    const source = geocodeCandidate ? "Géocodage IGN" : "Annuaire des Entreprises";
    add(proposal("Latitude", row.Latitude, coordinateSource.latitude, source));
    add(proposal("Longitude", row.Longitude, coordinateSource.longitude, source));
  }

  return proposals;
}

export function selectedChanges(proposals, selectedFields) {
  const selected = selectedFields instanceof Set ? selectedFields : new Set(selectedFields ?? []);
  const changes = {};
  for (const item of proposals ?? []) {
    if (selected.has(item.field)) changes[item.field] = item.proposed;
  }
  return changes;
}
