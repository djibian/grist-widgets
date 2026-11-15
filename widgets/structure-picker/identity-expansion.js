import {
  buildOfficialIdentifierSearchRequest,
  buildOfficialTextSearchRequest,
  extractLocationFromAddress,
  normalize,
  normalizeIdentifier,
} from "./search.js";
import { identitySearchName, targetNameVariants } from "./identity-resolution.js";

// The public Annuaire API also searches by street address. Keep the street
// separate from the postal filter; do not turn this lookup into site proof.
// Broad or postal-only addresses are deliberately not searched as street names.
export function addressSearchPhrase(value) {
  const raw = String(value ?? "").trim().slice(0, 240);
  const { codePostal } = extractLocationFromAddress(raw);
  const beforePostal = codePostal ? raw.slice(0, raw.lastIndexOf(codePostal)) : raw;
  const street = normalize(beforePostal);
  const words = street.split(" ").filter(Boolean);
  if (street.length < 8 || words.length < 2 || !words.some(word => word.length >= 4 && /[a-z]/.test(word)))
    return "";
  return street.slice(0, 120);
}

// Discovery requests are hypotheses, never confirmation of the establishment.
// The existing identity decision remains the sole validator.
export function planIdentityExpansion(row, { alreadyRequested = [], maxQueries = 12, guidance = null, discoveredCandidates = [] } = {}) {
  const used = new Set(alreadyRequested.filter(Boolean));
  const selected = guidance?.selected ?? [];
  const hint = field => selected.find(entry => entry.field === field)?.value ?? "";
  const selectedAddress = hint("address");
  const location = extractLocationFromAddress(selectedAddress || row?.Adresse);
  const addressOptions = [...new Set([selectedAddress, row?.Adresse]
    .map(value => String(value ?? "").trim()).filter(Boolean))]
    .map(value => ({ ...extractLocationFromAddress(value), street: addressSearchPhrase(value) }));
  const queries = [];
  const add = (request, reason) => {
    if (!request?.url || used.has(request.url) || queries.length >= maxQueries) return;
    used.add(request.url);
    queries.push({ request, reason });
  };

  // An entered identifier is searched *independently* from the name.
  // Its results are not treated as corroboration without site evidence.
  for (const identifier of [hint("siret"), row?.SirenSiret]) {
    if (String(identifier ?? "").trim())
      add(buildOfficialIdentifierSearchRequest(identifier), "identifier-hint");
  }

  // A teacher may recognise a *manager*, not the geographic internship site.
  // The Annuaire's verified candidate SIREN is then a discovery route to its
  // other establishments. Require an actual candidate and an exact, unedited
  // choice of its published legal name; a typed correction is not such a link.
  // Neither the choice nor any resulting SIREN is a proof of the site's SIRET.
  for (const selection of selected) {
    if (selection.field !== "operator" || selection.corrected ||
        guidance?.rejected?.includes(selection.key)) continue;
    const manager = discoveredCandidates.find(candidate => {
      const siret = normalizeIdentifier(candidate?.siret);
      return siret.length === 14 && selection.key === "siret:" + siret &&
        normalize(selection.value) === normalize(candidate?.raisonSociale);
    });
    const siren = normalizeIdentifier(manager?.siren);
    if (siren.length === 9)
      add(buildOfficialIdentifierSearchRequest(siren), "operator-establishments");
  }

  const names = [...new Set([
    hint("name"),
    hint("operator"),
    identitySearchName(row),
    ...targetNameVariants(row),
    normalize(row?.RaisonSociale ?? ""),
  ].map(name => normalize(name)).filter(name => name.length >= 3))];

  // A teacher-confirmed commune is an independent search clue. Never force
  // the old postal code onto it: the old address may describe another site.
  const selectedCommune = normalize(hint("commune"));
  if (selectedCommune.length >= 3) {
    for (const name of names)
      add(buildOfficialTextSearchRequest(name + " " + selectedCommune), "name-commune-hint");
  }

  // First explore alternate names at the supplied postal code. Then loosen
  // that constraint without changing the departments configured in Grist.
  for (const name of names) {
    if (location.codePostal)
      add(buildOfficialTextSearchRequest(name, { codePostal: location.codePostal }), "name-postcode");
  }
  // A street query can discover an unknown trading name or an operator whose
  // legal name is unrelated to the place. Require a postal filter first to
  // avoid exhausting the quota on common street names nationwide.
  for (const address of addressOptions) {
    if (address.street && address.codePostal)
      add(buildOfficialTextSearchRequest(address.street, { codePostal: address.codePostal }), "address-postcode");
  }
  for (const name of names) {
    add(buildOfficialTextSearchRequest(name), "name-department");
  }
  // Only after name-based lookups: relax the postal constraint of address
  // hypotheses. These are discovery requests, never verified site locations.
  for (const address of addressOptions) {
    if (address.street)
      add(buildOfficialTextSearchRequest(address.street), "address-department");
  }
  return queries;
}
