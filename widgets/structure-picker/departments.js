export const DEFAULT_DEPARTMENTS = Object.freeze(["44", "85"]);

export const DEPARTMENT_CATALOG = Object.freeze([
  ["01", "Ain"], ["02", "Aisne"], ["03", "Allier"], ["04", "Alpes-de-Haute-Provence"],
  ["05", "Hautes-Alpes"], ["06", "Alpes-Maritimes"], ["07", "Ardèche"], ["08", "Ardennes"],
  ["09", "Ariège"], ["10", "Aube"], ["11", "Aude"], ["12", "Aveyron"], ["13", "Bouches-du-Rhône"],
  ["14", "Calvados"], ["15", "Cantal"], ["16", "Charente"], ["17", "Charente-Maritime"], ["18", "Cher"],
  ["19", "Corrèze"], ["2A", "Corse-du-Sud"], ["2B", "Haute-Corse"], ["21", "Côte-d'Or"], ["22", "Côtes-d'Armor"],
  ["23", "Creuse"], ["24", "Dordogne"], ["25", "Doubs"], ["26", "Drôme"], ["27", "Eure"], ["28", "Eure-et-Loir"],
  ["29", "Finistère"], ["30", "Gard"], ["31", "Haute-Garonne"], ["32", "Gers"], ["33", "Gironde"], ["34", "Hérault"],
  ["35", "Ille-et-Vilaine"], ["36", "Indre"], ["37", "Indre-et-Loire"], ["38", "Isère"], ["39", "Jura"], ["40", "Landes"],
  ["41", "Loir-et-Cher"], ["42", "Loire"], ["43", "Haute-Loire"], ["44", "Loire-Atlantique"], ["45", "Loiret"],
  ["46", "Lot"], ["47", "Lot-et-Garonne"], ["48", "Lozère"], ["49", "Maine-et-Loire"], ["50", "Manche"],
  ["51", "Marne"], ["52", "Haute-Marne"], ["53", "Mayenne"], ["54", "Meurthe-et-Moselle"], ["55", "Meuse"],
  ["56", "Morbihan"], ["57", "Moselle"], ["58", "Nièvre"], ["59", "Nord"], ["60", "Oise"], ["61", "Orne"],
  ["62", "Pas-de-Calais"], ["63", "Puy-de-Dôme"], ["64", "Pyrénées-Atlantiques"], ["65", "Hautes-Pyrénées"],
  ["66", "Pyrénées-Orientales"], ["67", "Bas-Rhin"], ["68", "Haut-Rhin"], ["69", "Rhône"], ["70", "Haute-Saône"],
  ["71", "Saône-et-Loire"], ["72", "Sarthe"], ["73", "Savoie"], ["74", "Haute-Savoie"], ["75", "Paris"],
  ["76", "Seine-Maritime"], ["77", "Seine-et-Marne"], ["78", "Yvelines"], ["79", "Deux-Sèvres"], ["80", "Somme"],
  ["81", "Tarn"], ["82", "Tarn-et-Garonne"], ["83", "Var"], ["84", "Vaucluse"], ["85", "Vendée"],
  ["86", "Vienne"], ["87", "Haute-Vienne"], ["88", "Vosges"], ["89", "Yonne"], ["90", "Territoire de Belfort"],
  ["91", "Essonne"], ["92", "Hauts-de-Seine"], ["93", "Seine-Saint-Denis"], ["94", "Val-de-Marne"], ["95", "Val-d'Oise"],
  ["971", "Guadeloupe"], ["972", "Martinique"], ["973", "Guyane"], ["974", "La Réunion"], ["976", "Mayotte"],
].map(([code, name]) => Object.freeze({ code, name })));

const DEPARTMENT_BY_CODE = new Map(DEPARTMENT_CATALOG.map(item => [item.code, item]));
const CATALOG_INDEX = new Map(DEPARTMENT_CATALOG.map((item, index) => [item.code, index]));
let activeDepartments = [...DEFAULT_DEPARTMENTS];
const listeners = new Set();

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeDepartmentCode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  if (/^2[AB]$/.test(raw)) return DEPARTMENT_BY_CODE.has(raw) ? raw : "";
  if (/^\d{1,2}$/.test(raw)) {
    const code = raw.padStart(2, "0");
    return DEPARTMENT_BY_CODE.has(code) ? code : "";
  }
  if (/^\d{3}$/.test(raw)) return DEPARTMENT_BY_CODE.has(raw) ? raw : "";
  return "";
}

export function normalizeDepartments(values, fallback = DEFAULT_DEPARTMENTS) {
  const source = Array.isArray(values) ? values : [];
  let unique = new Set(source.map(normalizeDepartmentCode).filter(Boolean));
  if (!unique.size) {
    const fallbackSource = Array.isArray(fallback) ? fallback : [];
    unique = new Set(fallbackSource.map(normalizeDepartmentCode).filter(Boolean));
  }
  return [...unique].sort((a, b) => (CATALOG_INDEX.get(a) ?? 999) - (CATALOG_INDEX.get(b) ?? 999));
}

export function departmentFromPostalCode(value) {
  const postalCode = String(value ?? "").trim();
  if (!/^\d{5}$/.test(postalCode)) return "";
  const overseas = normalizeDepartmentCode(postalCode.slice(0, 3));
  if (overseas) return overseas;
  if (postalCode.startsWith("20")) return "";
  return normalizeDepartmentCode(postalCode.slice(0, 2));
}

export function departmentInfo(code) {
  return DEPARTMENT_BY_CODE.get(normalizeDepartmentCode(code)) ?? null;
}

export function searchDepartments(query, { exclude = [], limit = 12 } = {}) {
  const text = normalizeText(query);
  if (!text) return [];
  const excluded = new Set(normalizeDepartments(exclude, []));
  return DEPARTMENT_CATALOG
    .filter(item => !excluded.has(item.code))
    .map(item => {
      const name = normalizeText(item.name);
      const compactQuery = text.replace(/\s+/g, "");
      let score = 0;
      if (item.code.toLowerCase() === compactQuery) score = 5;
      else if (item.code.toLowerCase().startsWith(compactQuery)) score = 4;
      else if (name === text) score = 3;
      else if (name.startsWith(text)) score = 2;
      else if (name.includes(text)) score = 1;
      return { item, score };
    })
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || (CATALOG_INDEX.get(a.item.code) ?? 999) - (CATALOG_INDEX.get(b.item.code) ?? 999))
    .slice(0, Math.max(1, Number(limit) || 12))
    .map(result => result.item);
}

export function formatDepartmentCodes(codes = activeDepartments) {
  const values = normalizeDepartments(codes, DEFAULT_DEPARTMENTS);
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} et ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} et ${values.at(-1)}`;
}

export function formatDepartmentScope(codes = activeDepartments) {
  const values = normalizeDepartments(codes, DEFAULT_DEPARTMENTS);
  return values
    .map(code => {
      const item = departmentInfo(code);
      return item ? `${item.code} — ${item.name}` : code;
    })
    .join(" · ");
}

export function getActiveDepartments() {
  return [...activeDepartments];
}

export function setActiveDepartments(values) {
  const next = normalizeDepartments(values, DEFAULT_DEPARTMENTS);
  if (next.length === activeDepartments.length && next.every((code, index) => code === activeDepartments[index])) return false;
  activeDepartments = next;
  for (const listener of listeners) listener(getActiveDepartments());
  return true;
}

export function onDepartmentsChanged(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}
