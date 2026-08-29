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

export function diagnoseRow(row) {
  if (!row) return null;
  const identifier = identifierParts(row.SirenSiret);
  const latitude = Number(row.Latitude);
  const longitude = Number(row.Longitude);
  const coordinatesComplete = hasValue(row.Latitude) && hasValue(row.Longitude) && Number.isFinite(latitude) && Number.isFinite(longitude);
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

export function enterpriseSearchContext(row, geocodeCandidate = null) {
  const identifier = identifierParts(row?.SirenSiret);
  if (identifier.identifier) return { query: identifier.identifier, codePostal: "" };

  const fromAddress = extractLocationFromAddress(geocodeCandidate?.adresse || row?.Adresse);
  const codePostal = geocodeCandidate?.codePostal || fromAddress.codePostal;
  const commune = geocodeCandidate?.commune || fromAddress.commune;
  const name = String(row?.NomCommercial ?? "").trim();
  const query = [name, commune].filter(Boolean).join(" ").trim();
  return { query, codePostal };
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
