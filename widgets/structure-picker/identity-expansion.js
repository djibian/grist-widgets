import {
  buildOfficialIdentifierSearchRequest,
  buildOfficialTextSearchRequest,
  extractLocationFromAddress,
  normalize,
} from "./search.js";
import { identitySearchName, targetNameVariants } from "./identity-resolution.js";

// Discovery requests are hypotheses, never confirmation of the establishment.
// The existing identity decision remains the sole validator.
export function planIdentityExpansion(row, { alreadyRequested = [], maxQueries = 12, guidance = null } = {}) {
  const used = new Set(alreadyRequested.filter(Boolean));
  const selected = guidance?.selected ?? [];
  const hint = field => selected.find(entry => entry.field === field)?.value ?? "";
  const selectedAddress = hint("address");
  const location = extractLocationFromAddress(selectedAddress || row?.Adresse);
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

  const names = [...new Set([
    hint("name"),
    hint("operator"),
    identitySearchName(row),
    ...targetNameVariants(row),
    normalize(row?.RaisonSociale ?? ""),
  ].map(name => normalize(name)).filter(name => name.length >= 3))];

  // First explore alternate names at the supplied postal code. Then loosen
  // that constraint without changing the departments configured in Grist.
  for (const name of names) {
    if (location.codePostal)
      add(buildOfficialTextSearchRequest(name, { codePostal: location.codePostal }), "name-postcode");
  }
  for (const name of names) {
    add(buildOfficialTextSearchRequest(name), "name-department");
  }
  // Commune-only hints aid discovery, not official site attribution.
  const commune = hint("commune");
  if (commune && !location.codePostal) {
    for (const name of names)
      add(buildOfficialTextSearchRequest(name + " " + commune), "name-commune-hint");
  }
  return queries;
}
