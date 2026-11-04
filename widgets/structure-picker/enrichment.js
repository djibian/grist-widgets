import {
  presentedCandidate,
  formatSiret,
  formatPhone,
  formatUsualName,
  formatAddress,
} from "./presentation-conventions.js";
import {
  validateNamedSite,
  namedSiteCandidate,
} from "./named-site-directory.js";
import { publicSiteWriteProofValid } from "./public-sites.js";
import {
  extractLocationFromAddress,
  identifierParts,
  normalize,
} from "./search.js";
import {
  IDENTITY_STATES,
  usableCoordinates,
  parseSiteAddress,
} from "./identity-resolution.js";
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
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) < 1e-7
  );
}

function valuesEqual(field, current, proposed) {
  if (field === "Latitude" || field === "Longitude")
    return numericEqual(current, proposed);
  return String(current ?? "").trim() === String(proposed ?? "").trim();
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
  if (identifier.identifier)
    return { query: identifier.identifier, codePostal: "" };
  const fromAddress = extractLocationFromAddress(row?.Adresse);
  return {
    query: String(row?.NomCommercial ?? "").trim(),
    codePostal: fromAddress.codePostal,
  };
}

function proposal(
  field,
  current,
  proposed,
  source,
  { selectedByDefault = true } = {},
) {
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

export function normalizationProposals(row) {
  const location = extractLocationFromAddress(row?.Adresse);
  return [
    ["NomCommercial", formatUsualName(row?.NomCommercial, location.commune)],
    ["Adresse", formatAddress(row?.Adresse)],
    ["SirenSiret", formatSiret(row?.SirenSiret)],
    ["Telephone", formatPhone(row?.Telephone)],
  ]
    .filter(([field]) => hasValue(row?.[field]))
    .map(([field, value]) =>
      proposal(field, row[field], value, "Présentation harmonisée"),
    )
    .filter(Boolean);
}
export function buildEnrichmentProposals(
  row,
  enterpriseCandidate = null,
  { identityStatus = enterpriseCandidate?.identityStatus ?? "" } = {},
) {
  if (
    enterpriseCandidate &&
    !enterpriseCandidate.nomUsuelDistinct &&
    row.NomCommercial
  )
    enterpriseCandidate = {
      ...enterpriseCandidate,
      rawPublicName: row.NomCommercial,
      nomCommercial: row.NomCommercial,
    };
  enterpriseCandidate = presentedCandidate(enterpriseCandidate, row);
  if (
    [
      IDENTITY_STATES.INCOMPLETE,
      IDENTITY_STATES.NO_MATCH,
      IDENTITY_STATES.AMBIGUOUS,
    ].includes(identityStatus)
  )
    return normalizationProposals(row);
  if (enterpriseCandidate?.identityScope === "PUBLIC_SITE") {
    const point = enterpriseCandidate.position;
    if (
      ![
        IDENTITY_STATES.MATCH_VERIFIED,
        IDENTITY_STATES.MATCH_PROBABLE,
      ].includes(identityStatus)
    )
      return [];
    const siteProposals = [];
    const record = enterpriseCandidate.siteEvidence;
    if (
      validateNamedSite(record) &&
      (namedSiteCandidate(record, row) ||
        enterpriseCandidate.addressCorrectionSuggestion)
    ) {
      for (const [field, value] of [
        ["NomCommercial", enterpriseCandidate.nomCommercial],
        ["Adresse", enterpriseCandidate.adresse],
        [
          "Telephone",
          enterpriseCandidate.telephone || formatPhone(row.Telephone),
        ],
        ["Courriel", enterpriseCandidate.courriel],
        ["SiteWeb", enterpriseCandidate.siteWeb],
      ]) {
        const item = proposal(field, row[field], value, record.publisherLabel, {
          selectedByDefault: identityStatus === IDENTITY_STATES.MATCH_VERIFIED,
        });
        if (item) siteProposals.push(item);
      }
    }
    if (!siteProposals.length && publicSiteWriteProofValid(point)) {
      for (const [field, value] of [
        ["NomCommercial", enterpriseCandidate.nomCommercial],
        ["Adresse", enterpriseCandidate.adresse],
        ["Telephone", formatPhone(row.Telephone)],
      ]) {
        const item = proposal(field, row[field], value, "Lieu confirmé");
        if (item) siteProposals.push(item);
      }
    }
    if (enterpriseCandidate.operator?.scope === "operator") {
      const legal = proposal(
        "RaisonSociale",
        row.RaisonSociale,
        enterpriseCandidate.operator.raisonSociale,
        "Gestionnaire confirmé",
      );
      if (legal) {
        legal.label = "Raison sociale du gestionnaire";
        siteProposals.push(legal);
      }
    }
    const registrationFormat = proposal(
      "SirenSiret",
      row.SirenSiret,
      formatSiret(row.SirenSiret),
      "Présentation harmonisée",
    );
    if (registrationFormat) siteProposals.push(registrationFormat);
    if (
      !publicSiteWriteProofValid(point) ||
      (numericEqual(row.Latitude, point.latitude) &&
        numericEqual(row.Longitude, point.longitude))
    )
      return siteProposals;
    const current = usableCoordinates(row.Latitude, row.Longitude);
    return [
      ...siteProposals,
      {
        field: "Coordinates",
        fields: ["Latitude", "Longitude"],
        label: FIELD_LABELS.Coordinates,
        current: current ? `${row.Latitude}, ${row.Longitude}` : "—",
        proposed: `${point.latitude}, ${point.longitude}`,
        source: `${point.source.label} — point du site public ; SIRET propre non établi`,
        requiresSiteId: point.siteId,
        currentRegistration: String(row.SirenSiret ?? "").trim(),
        publicSitePosition: point,
        selectedByDefault: !String(row.SirenSiret ?? "").trim(),
        replacesExisting: Boolean(current),
        changes: {
          Latitude: point.latitude,
          Longitude: point.longitude,
          PositionSource: `${point.source.label} (${point.source.recordId}) ${point.source.url}`,
          PositionProof: JSON.stringify(point),
        },
      },
    ];
  }
  const proposals = [];
  const add = (item) => {
    if (item) proposals.push(item);
  };
  const identityVerified =
    !identityStatus || identityStatus === IDENTITY_STATES.MATCH_VERIFIED;

  if (enterpriseCandidate) {
    if (enterpriseCandidate.nomCommercial) {
      add(
        proposal(
          "NomCommercial",
          row.NomCommercial,
          enterpriseCandidate.nomCommercial,
          "Annuaire des Entreprises",
          {
            selectedByDefault: identityVerified,
          },
        ),
      );
    }
    add(
      proposal(
        "SirenSiret",
        row.SirenSiret,
        formatSiret(enterpriseCandidate.siret || enterpriseCandidate.siren),
        "Annuaire des Entreprises",
        {
          selectedByDefault: identityVerified,
        },
      ),
    );
    add(
      proposal(
        "RaisonSociale",
        row.RaisonSociale,
        enterpriseCandidate.raisonSociale,
        "Annuaire des Entreprises",
        {
          selectedByDefault: identityVerified,
        },
      ),
    );
  }

  const addressSource = enterpriseCandidate;
  if (
    addressSource &&
    !(
      parseSiteAddress(row.Adresse).number &&
      !parseSiteAddress(addressSource.adresse).number
    ) &&
    !(
      parseSiteAddress(row.Adresse).repetition &&
      !parseSiteAddress(addressSource.adresse).repetition
    )
  ) {
    add(
      proposal(
        "Adresse",
        row.Adresse,
        addressSource.adresse,
        "Annuaire des Entreprises",
        {
          selectedByDefault: identityVerified,
        },
      ),
    );
  }

  if (identityVerified) {
    for (const [field, value] of [
      ["Telephone", enterpriseCandidate?.telephone],
      ["Courriel", enterpriseCandidate?.courriel],
      ["SiteWeb", enterpriseCandidate?.siteWeb],
    ]) {
      add(proposal(field, row[field], value, "Contact publié pour ce lieu"));
    }
  }

  for (const [field, value] of [
    ["Telephone", formatPhone(row.Telephone)],
    ["SirenSiret", formatSiret(row.SirenSiret)],
  ]) {
    if (!proposals.some((p) => p.field === field))
      add(
        proposal(field, row[field], value, "Présentation harmonisée", {
          selectedByDefault: true,
        }),
      );
  }
  if (!proposals.some((p) => p.field === "Adresse") && row.Adresse)
    add(
      proposal(
        "Adresse",
        row.Adresse,
        formatAddress(row.Adresse),
        "Présentation harmonisée",
        { selectedByDefault: true },
      ),
    );
  const position = enterpriseCandidate?.position;
  if (
    position?.siret === enterpriseCandidate?.siret &&
    [
      POSITION_STATES.SITE_CONFIRMED,
      POSITION_STATES.SITE_CORROBORATED,
    ].includes(position?.status) &&
    usableCoordinates(position.latitude, position.longitude) &&
    (!numericEqual(row.Latitude, position.latitude) ||
      !numericEqual(row.Longitude, position.longitude))
  ) {
    const currentCoordinates = usableCoordinates(row.Latitude, row.Longitude);
    let currentProof;
    try {
      currentProof = JSON.parse(row.PositionProof);
    } catch {}
    const preservesStronger =
      currentCoordinates &&
      currentProof?.status === POSITION_STATES.SITE_CONFIRMED &&
      currentProof?.siret === position.siret &&
      position.status === POSITION_STATES.SITE_CORROBORATED;
    const source = `${position.source.label} — ${position.reason}`;
    add({
      field: "Coordinates",
      fields: ["Latitude", "Longitude"],
      label: FIELD_LABELS.Coordinates,
      current: currentCoordinates ? `${row.Latitude}, ${row.Longitude}` : "—",
      proposed: `${position.latitude}, ${position.longitude}`,
      source,
      changes: {
        Latitude: position.latitude,
        Longitude: position.longitude,
        PositionSource: `${position.source.label} (${position.source.recordId}) ${position.source.url}`,
        PositionProof: JSON.stringify({
          siret: position.siret,
          status: position.status,
          source: position.source,
          proof: position.proof,
        }),
      },
      requiresSiret: position.siret,
      currentSiret: identifierParts(row.SirenSiret).siret,
      selectedByDefault: identityVerified && !preservesStronger,
      replacesExisting: Boolean(currentCoordinates),
    });
  }

  return proposals;
}

export function selectedChanges(proposals, selectedFields) {
  const selected =
    selectedFields instanceof Set
      ? selectedFields
      : new Set(selectedFields ?? []);
  const changes = {};
  for (const item of proposals ?? []) {
    if (selected.has(item.field) && !item.requiresSiret && !item.requiresSiteId)
      changes[item.field] = item.proposed;
  }
  for (const item of proposals ?? []) {
    if (
      selected.has(item.field) &&
      item.requiresSiret &&
      identifierParts(changes.SirenSiret ?? item.currentSiret).siret ===
        item.requiresSiret
    ) {
      Object.assign(changes, item.changes);
    }
  }
  for (const item of proposals ?? []) {
    if (
      selected.has(item.field) &&
      item.requiresSiteId &&
      !item.currentRegistration &&
      publicSiteWriteProofValid(item.publicSitePosition) &&
      item.requiresSiteId === item.publicSitePosition.siteId
    )
      Object.assign(changes, item.changes);
  }
  return changes;
}
