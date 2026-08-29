const DEFAULT_DEPARTMENTS = ["44", "85"];
export const DEPARTMENTS = Object.freeze([...DEFAULT_DEPARTMENTS]);
export const LOCAL_LIMIT = 8;
export const EXTERNAL_LIMIT = 10;

export function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeIdentifier(value) {
  return String(value ?? "").replace(/\D/g, "");
}

// Alias conservé pour les éventuels liens/tests historiques.
export const normalizeSiret = normalizeIdentifier;

export function identifierParts(value) {
  const identifier = normalizeIdentifier(value);
  if (identifier.length === 14) {
    return { identifier, siren: identifier.slice(0, 9), siret: identifier };
  }
  if (identifier.length === 9) {
    return { identifier, siren: identifier, siret: "" };
  }
  return { identifier, siren: "", siret: "" };
}

export function extractLocationFromNormalizedAddress(value) {
  const address = String(value ?? "").trim();
  if (!address) return { codePostal: "", commune: "" };

  const matches = [...address.matchAll(/\b(\d{5})\b/g)];
  if (!matches.length) return { codePostal: "", commune: "" };

  // Le label du géocodeur IGN place normalement le code postal juste avant la commune.
  // On prend le dernier code à 5 chiffres pour ne pas confondre avec un numéro présent plus tôt.
  const match = matches[matches.length - 1];
  const codePostal = match[1];
  const afterPostalCode = address.slice((match.index ?? 0) + match[0].length);
  const commune = afterPostalCode
    .replace(/^[\s,;\-–—]+/, "")
    .replace(/(?:,\s*)?(?:france|fr)$/i, "")
    .trim();

  return { codePostal, commune };
}

function tokens(value) {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

export function tokenSimilarity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const minLength = Math.min(left.length, right.length);
  const maxLength = Math.max(left.length, right.length);

  if (minLength >= 3 && (left.startsWith(right) || right.startsWith(left))) {
    return Math.max(0.78, minLength / maxLength);
  }
  if (minLength < 3) return 0;

  const similarity = 1 - levenshtein(left, right) / maxLength;
  return similarity >= 0.55 ? similarity : 0;
}

export function fuzzyTextScore(query, text) {
  const normalizedQuery = normalize(query);
  const normalizedText = normalize(text);
  if (!normalizedQuery || !normalizedText) return 0;
  if (normalizedQuery === normalizedText) return 1;
  if (normalizedText.includes(normalizedQuery)) return 0.96;

  const queryTokens = tokens(normalizedQuery);
  const textTokens = tokens(normalizedText);
  if (!queryTokens.length || !textTokens.length) return 0;

  const bestPerQuery = queryTokens.map(queryToken => {
    let best = 0;
    for (const textToken of textTokens) {
      best = Math.max(best, tokenSimilarity(queryToken, textToken));
      if (best === 1) break;
    }
    return best;
  });

  const average = bestPerQuery.reduce((sum, value) => sum + value, 0) / bestPerQuery.length;
  const matchedRatio = bestPerQuery.filter(value => value >= 0.68).length / bestPerQuery.length;
  const phraseBonus = normalizedText.startsWith(normalizedQuery) ? 0.08 : 0;

  return Math.min(1, average * 0.72 + matchedRatio * 0.28 + phraseBonus);
}

export function localSearchText(row) {
  return [
    row.NomCommercial,
    row.RaisonSociale,
    row.Adresse,
    row.AdresseNormalisee,
    row.CodePostal,
    row.Commune,
    row.SirenSiret,
  ].filter(Boolean).join(" ");
}

export function scoreLocal(row, query) {
  const queryIdentifier = identifierParts(query);
  const rowIdentifier = identifierParts(row.SirenSiret);

  if (queryIdentifier.siret && rowIdentifier.siret === queryIdentifier.siret) return 10;
  if (queryIdentifier.siren && rowIdentifier.siren === queryIdentifier.siren) return 9;

  const name = [row.NomCommercial, row.RaisonSociale].filter(Boolean).join(" ");
  const address = [row.AdresseNormalisee, row.Adresse, row.CodePostal, row.Commune].filter(Boolean).join(" ");

  const nameScore = fuzzyTextScore(query, name);
  const addressScore = fuzzyTextScore(query, address);
  const globalScore = fuzzyTextScore(query, localSearchText(row));

  let score = Math.max(nameScore, addressScore * 0.9, globalScore * 0.95);
  const normalizedQuery = normalize(query);
  const normalizedName = normalize(name);
  if (normalizedName.startsWith(normalizedQuery)) score += 0.08;
  if (normalizedName.includes(normalizedQuery)) score += 0.05;
  return Math.min(1.2, score);
}

export function searchLocal(rows, query, limit = LOCAL_LIMIT) {
  if (normalize(query).length < 2) return [];
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({ row, score: scoreLocal(row, query) }))
    .filter(item => item.score >= 0.43)
    .sort((a, b) => b.score - a.score || String(a.row.NomCommercial || "").localeCompare(String(b.row.NomCommercial || ""), "fr"))
    .slice(0, limit)
    .map(item => item.row);
}

export function departmentOf(establishment) {
  const explicit = String(establishment?.departement ?? "").trim().toUpperCase();
  if (explicit) return explicit;
  const codePostal = String(establishment?.code_postal ?? "").trim();
  return /^\d{5}$/.test(codePostal) ? codePostal.slice(0, 2) : "";
}

export function isAllowedDepartment(establishment, departments = DEPARTMENTS) {
  return departments.includes(departmentOf(establishment));
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function candidateFrom(unit, establishment) {
  if (!establishment?.siret) return null;
  if (establishment.etat_administratif && establishment.etat_administratif !== "A") return null;
  if (!isAllowedDepartment(establishment)) return null;

  const enseigne = Array.isArray(establishment.liste_enseignes)
    ? firstNonEmpty(establishment.liste_enseignes)
    : "";
  const raisonSociale = firstNonEmpty([unit?.nom_raison_sociale, unit?.nom_complet]);
  // Beaucoup d'établissements n'ont pas d'enseigne distincte. Dans ce cas, la raison sociale
  // devient le nom commercial affichable afin que la structure reste exploitable dans Grist.
  const nomCommercial = firstNonEmpty([
    enseigne,
    establishment.nom_commercial,
    raisonSociale,
    unit?.nom_complet,
  ]) || "Structure sans nom";
  const latitude = Number(establishment.latitude);
  const longitude = Number(establishment.longitude);

  return {
    nomCommercial,
    raisonSociale,
    siren: String(unit?.siren ?? ""),
    siret: String(establishment.siret ?? ""),
    adresse: String(establishment.adresse ?? ""),
    codePostal: String(establishment.code_postal ?? ""),
    commune: String(establishment.libelle_commune ?? ""),
    departement: departmentOf(establishment),
    ape: String(establishment.activite_principale ?? unit?.activite_principale ?? ""),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

export function candidateMatchesIdentifier(candidate, value) {
  const local = identifierParts(value);
  const candidateSiret = normalizeIdentifier(candidate?.siret);
  const candidateSiren = normalizeIdentifier(candidate?.siren) || candidateSiret.slice(0, 9);
  if (local.siret) return local.siret === candidateSiret;
  if (local.siren) return local.siren === candidateSiren;
  return false;
}

export function localIdentifierSet(rows) {
  return new Set((Array.isArray(rows) ? rows : [])
    .map(row => normalizeIdentifier(row.SirenSiret))
    .filter(value => value.length === 9 || value.length === 14));
}

// Alias historique : le contenu est désormais un mélange contrôlé de SIREN (9) et SIRET (14).
export const localSiretSet = localIdentifierSet;

export function candidateIsAlreadyLocal(candidate, localIdentifiers) {
  for (const identifier of localIdentifiers ?? []) {
    if (candidateMatchesIdentifier(candidate, identifier)) return true;
  }
  return false;
}

export function flattenExternalResults(payload, localIdentifiers = new Set(), limit = EXTERNAL_LIMIT) {
  const candidates = [];
  const seenSirets = new Set();

  for (const unit of payload?.results ?? []) {
    let establishments = Array.isArray(unit.matching_etablissements) ? unit.matching_etablissements : [];
    if (!establishments.length && unit.siege) establishments = [unit.siege];

    for (const establishment of establishments) {
      const candidate = candidateFrom(unit, establishment);
      if (!candidate) continue;
      const siret = normalizeIdentifier(candidate.siret);
      if (!siret || seenSirets.has(siret) || candidateIsAlreadyLocal(candidate, localIdentifiers)) continue;
      seenSirets.add(siret);
      candidates.push(candidate);
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}

export function buildExternalSearchUrl(query, { perPage = 10, matchingLimit = 10 } = {}) {
  const params = new URLSearchParams({
    q: String(query ?? "").trim(),
    departement: DEPARTMENTS.join(","),
    etat_administratif: "A",
    minimal: "true",
    include: "matching_etablissements,siege",
    limite_matching_etablissements: String(matchingLimit),
    page: "1",
    per_page: String(perPage),
  });
  return `https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`;
}
