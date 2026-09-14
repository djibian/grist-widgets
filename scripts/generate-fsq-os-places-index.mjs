import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { departmentFromPostalCode, normalizeDepartments } from "../widgets/structure-picker/departments.js";

export const FSQ_SOURCE_ID = "fsq-os-places";
export const CONTACT_INDEX_DATA_SCHEMA_VERSION = 1;

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

export function normalizeFsqFeature(feature, requestedDepartments = []) {
  if (!feature || typeof feature !== "object") return null;
  const properties = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
  const country = clean(properties.country).toUpperCase();
  if (country && country !== "FR") return null;
  if (clean(properties.date_closed)) return null;
  const postcode = clean(properties.postcode);
  const department = departmentFromPostalCode(postcode);
  if (!department || !new Set(normalizeDepartments(requestedDepartments, [])).has(department)) return null;
  const telephone = clean(properties.tel);
  const courriel = clean(properties.email);
  const siteWeb = clean(properties.website);
  if (!telephone && !courriel && !siteWeb) return null;
  const recordId = clean(properties.fsq_place_id ?? feature.id);
  if (!recordId) return null;
  const coordinates = feature.geometry?.type === "Point" ? feature.geometry.coordinates : [];
  return {
    department,
    record: {
      recordId,
      fsqPlaceId: recordId,
      name: clean(properties.name),
      siret: "",
      address: [clean(properties.address), [postcode, clean(properties.locality)].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      postcode,
      city: clean(properties.locality),
      latitude: Number.isFinite(Number(coordinates?.[1])) ? Number(coordinates[1]) : null,
      longitude: Number.isFinite(Number(coordinates?.[0])) ? Number(coordinates[0]) : null,
      telephone,
      courriel,
      siteWeb,
      dateCreated: clean(properties.date_created),
      dateRefreshed: clean(properties.date_refreshed),
      categories: Array.isArray(properties.fsq_category_labels) ? [...new Set(properties.fsq_category_labels.map(clean).filter(Boolean))] : [],
      categoryIds: Array.isArray(properties.fsq_category_ids) ? [...new Set(properties.fsq_category_ids.map(clean).filter(Boolean))] : [],
      unresolvedFlags: Array.isArray(properties.unresolved_flags) ? [...new Set(properties.unresolved_flags.map(clean).filter(Boolean))] : [],
      placemakerUrl: clean(properties.placemaker_url),
    },
  };
}

function collectFeatures(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (value.type === "Feature" && value.geometry) result.push(value);
  else if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    for (const child of value.features) collectFeatures(child, result);
  }
  return result;
}

function richness(record) {
  return Number(Boolean(record.telephone)) + Number(Boolean(record.courriel)) + Number(Boolean(record.siteWeb));
}

function preferred(left, right) {
  const contactDelta = richness(right) - richness(left);
  if (contactDelta) return contactDelta > 0 ? right : left;
  const flagDelta = right.unresolvedFlags.length - left.unresolvedFlags.length;
  if (flagDelta) return flagDelta < 0 ? right : left;
  return right.dateRefreshed > left.dateRefreshed ? right : left;
}

export async function generateFsqIndexes({
  input,
  departments,
  outputDir,
  manifestPath,
  generatedAt = new Date().toISOString(),
  release = null,
  delivery = null,
} = {}) {
  if (!input) throw new Error("Le chemin vers l'export FSQ OS Places est obligatoire.");
  if (!outputDir || !manifestPath) throw new Error("Les chemins de sortie et de manifest sont obligatoires.");
  const requested = normalizeDepartments(departments, []);
  if (!requested.length) throw new Error("Au moins un département valide est requis.");

  const source = JSON.parse(await readFile(input, "utf8"));
  const features = collectFeatures(source);
  const byDepartment = new Map(requested.map(code => [code, new Map()]));
  const stats = { features: features.length, candidates: 0, indexed: 0, duplicates: 0 };

  for (const feature of features) {
    const item = normalizeFsqFeature(feature, requested);
    if (!item) continue;
    stats.candidates += 1;
    const records = byDepartment.get(item.department);
    const previous = records.get(item.record.recordId);
    if (previous) stats.duplicates += 1;
    records.set(item.record.recordId, previous ? preferred(previous, item.record) : item.record);
  }

  await mkdir(outputDir, { recursive: true });
  const writtenDepartments = [];
  const perDepartment = {};
  for (const department of requested) {
    const records = [...byDepartment.get(department).values()].sort((a, b) => a.recordId.localeCompare(b.recordId));
    perDepartment[department] = records.length;
    if (!records.length) continue;
    const index = {
      schemaVersion: CONTACT_INDEX_DATA_SCHEMA_VERSION,
      source: FSQ_SOURCE_ID,
      department,
      generatedAt,
      upstream: {
        project: "Foursquare Open Source Places",
        release: clean(release) || null,
        delivery: clean(delivery) || null,
        license: "Apache-2.0",
      },
      recordCount: records.length,
      records,
    };
    await writeFile(path.join(outputDir, `${department}.json`), `${JSON.stringify(index)}\n`, "utf8");
    writtenDepartments.push(department);
    stats.indexed += records.length;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.sources?.[FSQ_SOURCE_ID]) throw new Error("La source fsq-os-places est absente du manifest.");
  manifest.generatedAt = generatedAt;
  manifest.sources[FSQ_SOURCE_ID].departments = writtenDepartments;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { source: FSQ_SOURCE_ID, generatedAt, requested, writtenDepartments, perDepartment, stats };
}
