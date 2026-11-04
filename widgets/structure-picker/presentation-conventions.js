// User-facing spelling never participates in identity or geometry decisions.
import {
  extractLocationFromAddress,
  normalizeIdentifier,
  normalize,
} from "./search.js";
import { communeLabels, communeAliases } from "./commune-labels.js";
import { phoneKey } from "./site-context.js";

const particles = new Set([
  "de",
  "du",
  "des",
  "d",
  "la",
  "le",
  "les",
  "l",
  "en",
  "sur",
  "sous",
  "et",
  "au",
  "aux",
]);
const upperFirst = (value) =>
  value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("fr-FR"));
const clean = (value) =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
export function formatPlace(value) {
  let text = clean(
    Object.entries(communeAliases).find(
      ([alias]) => alias.toLowerCase() === clean(value).toLowerCase(),
    )?.[1] || value,
  )
    .replace(/\bST\b/gi, "Saint")
    .replace(/\bSTE\b/gi, "Sainte")
    .replace(/\bCEDEX(?:\s+\d+)?\b/gi, "")
    .trim()
    .toLocaleLowerCase("fr-FR");
  return text
    .split(/([\s'-]+)/)
    .map((word, index) =>
      index === 0 || !particles.has(word) ? upperFirst(word) : word,
    )
    .join("");
}
export function formatUsualName(name, commune = "") {
  const town = formatPlace(commune);
  let text = clean(name)
    .replace(/\b\d{5}\b/g, "")
    .trim();
  if (town) {
    const folded = (value) =>
      value
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase();
    const words = text.split(/\s+/);
    let suffix = words.length;
    for (let i = 0; i < words.length; i++)
      if (
        folded(words.slice(i).join(" ")) === folded(town) ||
        Object.entries(communeAliases).some(
          ([alias, target]) =>
            folded(target) === folded(town) &&
            folded(words.slice(i).join(" ")) === folded(alias),
        )
      ) {
        suffix = i;
        break;
      }
    if (suffix < words.length)
      text = words
        .slice(0, suffix)
        .join(" ")
        .replace(/\s+(?:a|à|de|du|en)\s*$/i, "");
  }
  text = text.replace(/\s*[—–-]\s*$/, "").trim();
  const initials = new Set(
    [...text.matchAll(/(?<![\p{L}\p{N}])[A-Z](?![\p{L}\p{N}])/gu)]
      .map((m) => m[0])
      .filter((s) => !["A", "D", "L"].includes(s)),
  );
  text = upperFirst(text.toLocaleLowerCase("fr-FR")).replace(
    /^ecole\b/i,
    "école",
  );
  text = upperFirst(text);
  for (const letter of initials)
    text = text.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${letter.toLowerCase()}(?![\\p{L}\\p{N}])`,
        "gu",
      ),
      letter,
    );
  return text + (town ? ` — ${town}` : "");
}
const streets = {
  r: "rue",
  rue: "rue",
  bd: "boulevard",
  bld: "boulevard",
  boulevard: "boulevard",
  av: "avenue",
  avenue: "avenue",
  pl: "place",
  place: "place",
  che: "chemin",
  chemin: "chemin",
  rte: "route",
  route: "route",
  imp: "impasse",
  impasse: "impasse",
  all: "allée",
  allee: "allée",
  allée: "allée",
  quai: "quai",
  sq: "square",
  square: "square",
};
export function formatAddress(value, { commune = "", postcode = "" } = {}) {
  let text = clean(value)
    .replace(/[,;]/g, " ")
    .replace(/\b(?:BP|CS)\s*\d+\b/gi, "")
    .replace(/\bCEDEX(?:\s*\d+)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const location = extractLocationFromAddress(text);
  const cp = String(postcode || location.codePostal || "").trim();
  const town = formatPlace(commune || location.commune);
  const postal = [...text.matchAll(/\b\d{5}\b/g)].at(-1);
  if (postal) text = text.slice(0, postal.index).trim();
  const types = Object.keys(streets)
    .sort((a, b) => b.length - a.length)
    .join("|");
  const m = text.match(
    new RegExp(
      `(?:^|\\s)(?:(\\d+)\\s*(bis|ter|quater|[a-d])?\\s+)?(${types})\\.?\\s+(.+)$`,
      "i",
    ),
  );
  if (m) {
    let [, number, rep, type, rest] = m;
    // Remove the town suffix in an otherwise complete address without postcode.
    if (town) {
      const t = town.toLowerCase().replace(/-/g, " ");
      const r = rest.toLowerCase().replace(/-/g, " ");
      if (r.endsWith(t)) rest = rest.slice(0, rest.length - t.length).trim();
    }
    if (number)
      rest = rest.replace(/\s+\b(?:ZA|ZAC|ZI|ZONE COMMERCIALE)\b.*$/i, "");
    const suffix =
      { b: "bis", t: "ter" }[String(rep ?? "").toLowerCase()] ??
      String(rep ?? "").toLowerCase();
    rest = formatPlace(rest)
      .replace(/^(De|Du|Des|D|La|Le|Les|L)(?=[ '-])/u, (w) => w.toLowerCase())
      .replace(/(?<![\p{L}])([ivxlcdm]+)(?![\p{L}])/giu, (word) =>
        /^(?=.+)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(
          word,
        ) && word.length > 1
          ? word.toUpperCase()
          : word,
      );
    text = [number, suffix, streets[type.toLowerCase()], rest]
      .filter(Boolean)
      .join(" ");
  } else {
    text = formatPlace(text);
  }
  return [text, [cp, town].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}
export function formatSiret(value) {
  const id = normalizeIdentifier(value);
  return /^\d{14}$/.test(id)
    ? `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6, 9)} ${id.slice(9)}`
    : /^\d{9}$/.test(id)
      ? id.match(/.{3}/g).join(" ")
      : clean(value);
}
export function formatPhone(value) {
  const digits = phoneKey(value);
  return digits ? digits.match(/.{2}/g).join(".") : clean(value);
}
export function presentedCandidate(candidate, row = null) {
  if (!candidate) return candidate;
  const location = extractLocationFromAddress(candidate.adresse);
  const commune =
    communeLabels[candidate.codeCommune] ||
    candidate.commune ||
    candidate.registryRecord?.commune ||
    location.commune;
  const postcode = candidate.codePostal || location.codePostal;
  let address = formatAddress(candidate.rawSiteAddress ?? candidate.adresse, {
    commune,
    postcode,
  });
  if (row?.Adresse) {
    const current = formatAddress(row.Adresse, { commune, postcode });
    const accents = (value) =>
      (value.normalize("NFD").match(/\p{M}/gu) ?? []).length;
    if (
      normalize(current) === normalize(address) &&
      accents(current) > accents(address)
    )
      address = current;
  }
  return {
    ...candidate,
    rawPublicName: candidate.rawPublicName ?? candidate.nomCommercial,
    rawSiteAddress: candidate.rawSiteAddress ?? candidate.adresse,
    nomCommercial: formatUsualName(
      candidate.rawPublicName ?? candidate.nomCommercial,
      commune,
    ),
    adresse: address,
    telephone: formatPhone(candidate.telephone),
    formattedSiret: formatSiret(candidate.siret || candidate.siren),
  };
}
