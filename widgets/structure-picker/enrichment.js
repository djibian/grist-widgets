import { extractLocationFromAddress, identifierParts, normalize } from "./search.js";

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
  if (words.length < 3) return "";
  return words.slice(1).join(" ");
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

  const fromAddress = extractLocationFromAddress(geocodeCandidate?.adresse || row?.Adresse);
  const codePostal = geocodeCandidate?.codePostal || fromAddress.codePostal;
  const commune = geocodeCandidate?.commune || fromAddress.commune;
  const name = String(row?.NomCommercial ?? "").trim();
  if (!name) return [];

  const variants = [];
  addSearchVariant(variants, name);

  const withoutLocation = stripLocationEdgeWords(name, commune);
  addSearchVariant(variants, withoutLocation);

  const shortestUsefulName = variants.at(-1) || name;
  addSearchVariant(variants, dropLeadingQualifier(shortestUsefulName));

  const attempts = [];
  for (const query of variants) addSearchAttempt(attempts, query, codePostal);

  // Dernier recours borné : on retire seulement le filtre postal, sans multiplier
  // les variantes larges sur l'ensemble des départements configurés.
  if (codePostal) addSearchAttempt(attempts, name, "");
  return attempts;
}

export function enterpriseSearchContext(row, geocodeCandidate = null) {
  return enterpriseSearchAttempts(row, geocodeCandidate)[0] ?? { query: "", codePostal: "" };
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
