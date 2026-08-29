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

export function normalizeSiret(value) {
  return String(value ?? "").replace(/\D/g, "");
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
    row.Nom,
    row.NomCommercial,
    row.RaisonSociale,
    row.Adresse,
    row.AdresseNormalisee,
    row.CodePostal,
    row.Commune,
    row.SIRET,
    row.SIREN,
  ].filter(Boolean).join(" ");
}

export function scoreLocal(row, query) {
  const digits = normalizeSiret(query);
  const siret = normalizeSiret(row.SIRET);
  const siren = normalizeSiret(row.SIREN);

  if (digits.length === 14 && siret === digits) return 10;
  if (digits.length === 9 && siren === digits) return 9;

  const name = [row.NomCommercial, row.Nom, row.RaisonSociale].filter(Boolean).join(" ");
  const address = [row.Adresse, row.AdresseNormalisee, row.CodePostal, row.Commune].filter(Boolean).join(" ");

  const nameScore = fuzzyTextScore(query, name);
  const addressScore = fuzzyTextScore(query, address);
  const globalScore = fuzzyTextScore(query, localSearchText(row));

  let score = Math.max(nameScore, addressScore * 0.88, globalScore * 0.94);
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
    .sort((a, b) => b.score - a.score || String(a.row.Nom || "").localeCompare(String(b.row.Nom || ""), "fr"))
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
  const nomCommercial = firstNonEmpty([enseigne, establishment.nom_commercial]);
  const raisonSociale = firstNonEmpty([unit?.nom_raison_sociale, unit?.nom_complet]);
  const nom = firstNonEmpty([nomCommercial, raisonSociale, unit?.nom_complet]) || "Structure sans nom";
  const latitude = Number(establishment.latitude);
  const longitude = Number(establishment.longitude);

  return {
    nom,
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

export function flattenExternalResults(payload, localSirets = new Set(), limit = EXTERNAL_LIMIT) {
  const candidates = [];
  const seen = new Set();
  const normalizedLocal = new Set([...localSirets].map(normalizeSiret).filter(Boolean));

  for (const unit of payload?.results ?? []) {
    let establishments = Array.isArray(unit.matching_etablissements) ? unit.matching_etablissements : [];
    if (!establishments.length && unit.siege) establishments = [unit.siege];

    for (const establishment of establishments) {
      const candidate = candidateFrom(unit, establishment);
      if (!candidate) continue;
      const siret = normalizeSiret(candidate.siret);
      if (!siret || seen.has(siret) || normalizedLocal.has(siret)) continue;
      seen.add(siret);
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

export function localSiretSet(rows) {
  return new Set((Array.isArray(rows) ? rows : [])
    .map(row => normalizeSiret(row.SIRET))
    .filter(Boolean));
}
