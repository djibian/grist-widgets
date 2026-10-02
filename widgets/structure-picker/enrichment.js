import { extractLocationFromAddress, identifierParts, normalize } from "./search.js";
import { IDENTITY_STATES, usableCoordinates } from "./identity-resolution.js";
import { POSITION_STATES } from "./establishment-position.js";

const FIELD_LABELS = {
  NomCommercial: "Nom usuel",
  Adresse: "Adresse",
  SirenSiret: "SIREN / SIRET",
  RaisonSociale: "Raison sociale",
  Latitude: "Latitude",
  Longitude: "Longitude",
  Coordinates: "Position du site (latitude / longitude)",
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
  const coordinates = usableCoordinates(row.Latitude, row.Longitude);
  const location = extractLocationFromAddress(row.Adresse);

  return {
    hasName: hasValue(row.NomCommercial),
    hasAddress: hasValue(row.Adresse),
    hasIdentifier: Boolean(identifier.siren),
    hasSiret: Boolean(identifier.siret),
    hasLegalName: hasValue(row.RaisonSociale),
    hasCoordinates: Boolean(coordinates),
    codePostal: location.codePostal,
    commune: location.commune,
    needsEnterprise: !identifier.siret || !hasValue(row.RaisonSociale),
    needsGeocode: hasValue(row.Adresse) && !coordinates,
  };
}

// Conservé pour le mode de recherche simple et la compatibilité des appels
// existants. Le résolveur d'identité utilise désormais son propre plan borné.
export function enterpriseSearchContext(row) {
  const identifier = identifierParts(row?.SirenSiret);
  if (identifier.identifier) return { query: identifier.identifier, codePostal: "" };
  const fromAddress = extractLocationFromAddress(row?.Adresse);
  return { query: String(row?.NomCommercial ?? "").trim(), codePostal: fromAddress.codePostal };
}

function proposal(field, current, proposed, source, { selectedByDefault = !hasValue(current) } = {}) {
  if (!hasValue(proposed) || valuesEqual(field, current, proposed)) return null;
  return {
    field,
    label: FIELD_LABELS[field] || field,
    current,
    proposed,
    source,
    selectedByDefault,
    replacesExisting: hasValue(current),
  };
}

export function buildEnrichmentProposals(row, enterpriseCandidate = null, { identityStatus = enterpriseCandidate?.identityStatus ?? "" } = {}) {
  const proposals = [];
  const add = item => { if (item) proposals.push(item); };
  const identityVerified = !identityStatus || identityStatus === IDENTITY_STATES.MATCH_VERIFIED;

  if (enterpriseCandidate) {
    if (enterpriseCandidate.nomUsuelDistinct || !hasValue(row.NomCommercial)) {
      add(proposal("NomCommercial", row.NomCommercial, enterpriseCandidate.nomCommercial, "Annuaire des Entreprises", {
        selectedByDefault: identityVerified && !hasValue(row.NomCommercial),
      }));
    }
    add(proposal("SirenSiret", row.SirenSiret, enterpriseCandidate.siret || enterpriseCandidate.siren, "Annuaire des Entreprises", {
      selectedByDefault: identityVerified && !hasValue(row.SirenSiret),
    }));
    add(proposal("RaisonSociale", row.RaisonSociale, enterpriseCandidate.raisonSociale, "Annuaire des Entreprises", {
      selectedByDefault: identityVerified && !hasValue(row.RaisonSociale),
    }));
  }

  const addressSource = enterpriseCandidate;
  if (addressSource) {
    add(proposal("Adresse", row.Adresse, addressSource.adresse, "Annuaire des Entreprises", {
      selectedByDefault: !hasValue(row.Adresse),
    }));
  }

  const position = enterpriseCandidate?.position;
  if (position?.siret === enterpriseCandidate?.siret
    && [POSITION_STATES.SITE_CONFIRMED, POSITION_STATES.SITE_CORROBORATED].includes(position?.status)
    && usableCoordinates(position.latitude, position.longitude)
    && (!numericEqual(row.Latitude, position.latitude) || !numericEqual(row.Longitude, position.longitude))) {
    const currentCoordinates = usableCoordinates(row.Latitude, row.Longitude);
    const source = `${position.source.label} — ${position.reason}`;
    add({
      field: "Coordinates", fields: ["Latitude", "Longitude"], label: FIELD_LABELS.Coordinates,
      current: currentCoordinates ? `${row.Latitude}, ${row.Longitude}` : "—",
      proposed: `${position.latitude}, ${position.longitude}`, source,
      changes: {
        Latitude: position.latitude, Longitude: position.longitude,
        PositionSource: `${position.source.label} (${position.source.recordId}) ${position.source.url}`,
        PositionProof: JSON.stringify({ siret: position.siret, status: position.status, source: position.source, proof: position.proof }),
      },
      requiresSiret: position.siret, currentSiret: identifierParts(row.SirenSiret).siret,
      selectedByDefault: identityVerified && !currentCoordinates,
      replacesExisting: Boolean(currentCoordinates),
    });
  }

  return proposals;
}

export function selectedChanges(proposals, selectedFields) {
  const selected = selectedFields instanceof Set ? selectedFields : new Set(selectedFields ?? []);
  const changes = {};
  for (const item of proposals ?? []) {
    if (selected.has(item.field) && !item.requiresSiret) changes[item.field] = item.proposed;
  }
  for (const item of proposals ?? []) {
    if (selected.has(item.field) && item.requiresSiret
      && identifierParts(changes.SirenSiret ?? item.currentSiret).siret === item.requiresSiret) {
      Object.assign(changes, item.changes);
    }
  }
  return changes;
}
