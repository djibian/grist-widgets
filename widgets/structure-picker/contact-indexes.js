import { normalizeDepartments } from "./departments.js";

export const CONTACT_INDEX_SCHEMA_VERSION = 1;
export const CONTACT_INDEX_MANIFEST_URL = new URL("./contact-indexes/indexed-departments.json", import.meta.url);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizePathTemplate(value) {
  const path = cleanText(value).replace(/^\.\//, "");
  if (!path || !path.includes("{department}")) return "";
  if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return "";
  return path;
}

function normalizeSource(id, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sourceId = cleanText(id);
  const pathTemplate = normalizePathTemplate(value.pathTemplate);
  if (!sourceId || !pathTemplate) return null;

  return Object.freeze({
    id: sourceId,
    label: cleanText(value.label) || sourceId,
    pathTemplate,
    departments: Object.freeze(normalizeDepartments(value.departments, [])),
  });
}

export function normalizeContactIndexManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Manifest des index de contacts invalide.");
  }
  if (Number(value.schemaVersion) !== CONTACT_INDEX_SCHEMA_VERSION) {
    throw new Error(`Version de manifest non prise en charge : ${value.schemaVersion ?? "absente"}.`);
  }

  const entries = Object.entries(value.sources && typeof value.sources === "object" ? value.sources : {});
  const sources = {};
  for (const [id, config] of entries) {
    const normalized = normalizeSource(id, config);
    if (normalized) sources[normalized.id] = normalized;
  }

  return Object.freeze({
    schemaVersion: CONTACT_INDEX_SCHEMA_VERSION,
    generatedAt: cleanText(value.generatedAt) || null,
    sources: Object.freeze(sources),
  });
}

export async function loadContactIndexManifest({
  fetchImpl = globalThis.fetch,
  url = CONTACT_INDEX_MANIFEST_URL,
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch indisponible pour charger les index de contacts.");
  const response = await fetchImpl(url, { cache: "no-store", signal });
  if (!response?.ok) {
    throw new Error(`Manifest des index de contacts indisponible (${response?.status ?? "erreur"}).`);
  }
  return normalizeContactIndexManifest(await response.json());
}

export function indexedDepartmentAvailability(manifest, sourceId, requestedDepartments = []) {
  const source = manifest?.sources?.[cleanText(sourceId)] ?? null;
  const requested = normalizeDepartments(requestedDepartments, []);
  const indexed = new Set(source?.departments ?? []);
  const available = requested.filter(code => indexed.has(code));
  const missing = requested.filter(code => !indexed.has(code));
  return Object.freeze({
    source,
    requested: Object.freeze(requested),
    available: Object.freeze(available),
    missing: Object.freeze(missing),
  });
}

export function resolveContactIndexEntries(manifest, sourceId, requestedDepartments = [], {
  manifestUrl = CONTACT_INDEX_MANIFEST_URL,
} = {}) {
  const availability = indexedDepartmentAvailability(manifest, sourceId, requestedDepartments);
  if (!availability.source) return Object.freeze([]);

  const baseUrl = new URL(".", manifestUrl);
  return Object.freeze(availability.available.map(department => Object.freeze({
    sourceId: availability.source.id,
    department,
    url: new URL(
      availability.source.pathTemplate.replaceAll("{department}", encodeURIComponent(department)),
      baseUrl,
    ).href,
  })));
}
