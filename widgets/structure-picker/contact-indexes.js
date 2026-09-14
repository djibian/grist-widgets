import {
  departmentFromPostalCode,
  normalizeDepartments,
} from "./departments.js";

export const CONTACT_INDEX_SCHEMA_VERSION = 1;
export const CONTACT_INDEX_MANIFEST_URL = new URL("./contact-indexes/indexed-departments.json", import.meta.url);
export const CONTACT_INDEX_SHARDS = Object.freeze({
  DEPARTMENT: "department",
  POSTCODE: "postcode",
});

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

function normalizeShardBy(value, pathTemplate) {
  const requested = cleanText(value).toLowerCase();
  if (requested === CONTACT_INDEX_SHARDS.POSTCODE) {
    return pathTemplate.includes("{postcode}") ? CONTACT_INDEX_SHARDS.POSTCODE : "";
  }
  if (pathTemplate.includes("{postcode}")) return "";
  return CONTACT_INDEX_SHARDS.DEPARTMENT;
}

function normalizeSource(id, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sourceId = cleanText(id);
  const pathTemplate = normalizePathTemplate(value.pathTemplate);
  if (!sourceId || !pathTemplate) return null;
  const shardBy = normalizeShardBy(value.shardBy, pathTemplate);
  if (!shardBy) return null;

  return Object.freeze({
    id: sourceId,
    label: cleanText(value.label) || sourceId,
    pathTemplate,
    shardBy,
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

function versionedIndexUrl(pathTemplate, replacements, manifestUrl, generatedAt) {
  let path = pathTemplate;
  for (const [key, value] of Object.entries(replacements)) {
    path = path.replaceAll(`{${key}}`, encodeURIComponent(value));
  }
  const url = new URL(path, new URL(".", manifestUrl));
  if (generatedAt) url.searchParams.set("v", generatedAt);
  return url.href;
}

export function resolveContactIndexEntries(manifest, sourceId, requestedDepartments = [], {
  manifestUrl = CONTACT_INDEX_MANIFEST_URL,
} = {}) {
  const availability = indexedDepartmentAvailability(manifest, sourceId, requestedDepartments);
  if (!availability.source || availability.source.shardBy !== CONTACT_INDEX_SHARDS.DEPARTMENT) {
    return Object.freeze([]);
  }

  return Object.freeze(availability.available.map(department => Object.freeze({
    sourceId: availability.source.id,
    department,
    url: versionedIndexUrl(
      availability.source.pathTemplate,
      { department },
      manifestUrl,
      null,
    ),
  })));
}

export function resolveContactIndexShard(manifest, sourceId, location = {}, {
  manifestUrl = CONTACT_INDEX_MANIFEST_URL,
} = {}) {
  const source = manifest?.sources?.[cleanText(sourceId)] ?? null;
  if (!source) return null;

  const postcode = cleanText(location.postcode);
  const explicitDepartment = normalizeDepartments([location.department], [])[0] ?? "";
  const postalDepartment = /^\d{5}$/.test(postcode) ? departmentFromPostalCode(postcode) : "";
  const department = explicitDepartment || postalDepartment;
  if (!department || (explicitDepartment && postalDepartment && explicitDepartment !== postalDepartment)) return null;
  if (!source.departments.includes(department)) return null;

  if (source.shardBy === CONTACT_INDEX_SHARDS.POSTCODE) {
    if (!/^\d{5}$/.test(postcode) || !postalDepartment) return null;
    return Object.freeze({
      sourceId: source.id,
      department,
      postcode,
      url: versionedIndexUrl(
        source.pathTemplate,
        { department, postcode },
        manifestUrl,
        manifest?.generatedAt,
      ),
    });
  }

  return Object.freeze({
    sourceId: source.id,
    department,
    postcode: null,
    url: versionedIndexUrl(
      source.pathTemplate,
      { department },
      manifestUrl,
      manifest?.generatedAt,
    ),
  });
}

export async function loadContactIndexShard(entry, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (!entry?.url) return null;
  if (typeof fetchImpl !== "function") throw new Error("Fetch indisponible pour charger un index de contacts.");

  const response = await fetchImpl(entry.url, { signal });
  if (response?.status === 404) return null;
  if (!response?.ok) {
    throw new Error(`Index de contacts indisponible (${response?.status ?? "erreur"}).`);
  }

  const data = await response.json();
  const valid = data
    && Number(data.schemaVersion) === CONTACT_INDEX_SCHEMA_VERSION
    && cleanText(data.source) === cleanText(entry.sourceId)
    && cleanText(data.department) === cleanText(entry.department)
    && (!entry.postcode || cleanText(data.postcode) === cleanText(entry.postcode))
    && Array.isArray(data.records)
    && Number(data.recordCount) === data.records.length;
  if (!valid) throw new Error("Index de contacts invalide ou incohérent avec le manifest.");

  return Object.freeze({
    ...data,
    records: Object.freeze(data.records),
  });
}
