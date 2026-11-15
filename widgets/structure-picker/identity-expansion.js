import {
  buildOfficialIdentifierSearchRequest,
  buildOfficialTextSearchRequest,
  extractLocationFromAddress,
  normalize,
} from "./search.js";
import { identitySearchName, targetNameVariants } from "./identity-resolution.js";

// Discovery requests are hypotheses, never confirmation of the establishment.
// The existing identity decision remains the sole validator.
export function planIdentityExpansion(row, { alreadyRequested = [], maxQueries = 12 } = {}) {
  const used = new Set(alreadyRequested.filter(Boolean));
  const location = extractLocationFromAddress(row?.Adresse);
  const queries = [];
  const add = (request, reason) => {
    if (!request?.url || used.has(request.url) || queries.length >= maxQueries) return;
    used.add(request.url);
    queries.push({ request, reason });
  };

  // An entered identifier is searched *independently* from the name.
  // Its results are not treated as corroboration without site evidence.
  if (String(row?.SirenSiret ?? "").trim()) {
    add(buildOfficialIdentifierSearchRequest(row.SirenSiret), "identifier-hint");
  }

  const names = [...new Set([
    identitySearchName(row),
    ...targetNameVariants(row),
    normalize(row?.RaisonSociale ?? ""),
  ].map(name => String(name ?? "").trim()).filter(name => name.length >= 3))];

  // First explore alternate names at the supplied postal code. Then loosen
  // that constraint without changing the departments configured in Grist.
  for (const name of names) {
    if (location.codePostal)
      add(buildOfficialTextSearchRequest(name, { codePostal: location.codePostal }), "name-postcode");
  }
  for (const name of names) {
    add(buildOfficialTextSearchRequest(name), "name-department");
  }
  return queries;
}
