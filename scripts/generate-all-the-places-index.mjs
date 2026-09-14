#!/usr/bin/env node

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  departmentFromPostalCode,
  normalizeDepartments,
} from "../widgets/structure-picker/departments.js";

export const ALL_THE_PLACES_SOURCE_ID = "all-the-places";
export const CONTACT_INDEX_DATA_SCHEMA_VERSION = 1;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "widgets/structure-picker/contact-indexes/all-the-places");
const DEFAULT_MANIFEST = path.join(REPO_ROOT, "widgets/structure-picker/contact-indexes/indexed-departments.json");

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function finiteOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function coordinatesOf(feature) {
  if (feature?.geometry?.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) {
    return { latitude: null, longitude: null };
  }
  const [longitude, latitude] = feature.geometry.coordinates;
  return { latitude: finiteOrNull(latitude), longitude: finiteOrNull(longitude) };
}

function addressOf(properties) {
  const full = clean(properties["addr:full"]);
  if (full) return full;
  const streetAddress = clean(properties["addr:street_address"]);
  const street = streetAddress || [
    clean(properties["addr:housenumber"]),
    clean(properties["addr:street"]),
  ].filter(Boolean).join(" ");
  const locality = [
    clean(properties["addr:postcode"]),
    clean(properties["addr:city"]),
  ].filter(Boolean).join(" ");
  return [street, locality].filter(Boolean).join(", ");
}

function recordIdOf(feature, properties) {
  const featureId = clean(feature?.id);
  if (featureId) return featureId;
  const spider = clean(properties["@spider"]);
  const ref = clean(properties.ref);
  if (spider && ref) return `${spider}:${ref}`;
  return clean(properties["@source_uri"]);
}

export function normalizeAllThePlacesFeature(feature, requestedDepartments = []) {
  if (!feature || typeof feature !== "object") return null;
  const properties = feature.properties && typeof feature.properties === "object"
    ? feature.properties
    : {};
  const country = clean(properties["addr:country"]).toUpperCase();
  if (country && country !== "FR") return null;

  const postcode = clean(properties["addr:postcode"]);
  const department = departmentFromPostalCode(postcode);
  const requested = new Set(normalizeDepartments(requestedDepartments, []));
  if (!department || !requested.has(department)) return null;

  const telephone = clean(properties.phone);
  const courriel = clean(properties.email);
  const siteWeb = clean(properties.website);
  if (!telephone && !courriel && !siteWeb) return null;

  const recordId = recordIdOf(feature, properties);
  if (!recordId) return null;
  const { latitude, longitude } = coordinatesOf(feature);

  return Object.freeze({
    department,
    record: Object.freeze({
      recordId,
      spider: clean(properties["@spider"]),
      ref: clean(properties.ref),
      sourceUri: clean(properties["@source_uri"]),
      name: clean(properties.name),
      siret: clean(properties["ref:FR:SIRET"] || properties.siret),
      address: addressOf(properties),
      postcode,
      city: clean(properties["addr:city"]),
      latitude,
      longitude,
      telephone,
      courriel,
      siteWeb,
    }),
  });
}

async function* walkGeoJsonFiles(inputPath) {
  const info = await stat(inputPath);
  if (info.isFile()) {
    if (inputPath.toLowerCase().endsWith(".geojson")) yield inputPath;
    return;
  }
  if (!info.isDirectory()) return;
  const entries = await readdir(inputPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const child = path.join(inputPath, entry.name);
    if (entry.isDirectory()) yield* walkGeoJsonFiles(child);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".geojson")) yield child;
  }
}

async function readFeatures(file) {
  const data = JSON.parse(await readFile(file, "utf8"));
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error(`GeoJSON ATP invalide : ${file}`);
  }
  return data.features;
}

function richness(record) {
  return [record.telephone, record.courriel, record.siteWeb].filter(Boolean).length;
}

function sortedRecords(records) {
  return [...records.values()].sort((left, right) =>
    left.recordId.localeCompare(right.recordId)
    || left.name.localeCompare(right.name));
}

export async function generateAllThePlacesIndexes({
  input,
  departments,
  outputDir = DEFAULT_OUTPUT_DIR,
  manifestPath = DEFAULT_MANIFEST,
  generatedAt = new Date().toISOString(),
  runId = null,
} = {}) {
  if (!input) throw new Error("Le chemin vers l'export All The Places est obligatoire.");
  const requested = normalizeDepartments(departments, []);
  if (!requested.length) throw new Error("Au moins un département valide est requis.");

  const byDepartment = new Map(requested.map(code => [code, new Map()]));
  const stats = { files: 0, features: 0, candidates: 0, indexed: 0, duplicates: 0 };

  for await (const file of walkGeoJsonFiles(input)) {
    stats.files += 1;
    const features = await readFeatures(file);
    stats.features += features.length;
    for (const feature of features) {
      const item = normalizeAllThePlacesFeature(feature, requested);
      if (!item) continue;
      stats.candidates += 1;
      const records = byDepartment.get(item.department);
      const previous = records.get(item.record.recordId);
      if (previous) stats.duplicates += 1;
      if (!previous || richness(item.record) > richness(previous)) {
        records.set(item.record.recordId, item.record);
      }
    }
  }

  await mkdir(outputDir, { recursive: true });
  const writtenDepartments = [];
  const perDepartment = {};
  for (const department of requested) {
    const records = sortedRecords(byDepartment.get(department));
    perDepartment[department] = records.length;
    if (!records.length) continue;
    const index = {
      schemaVersion: CONTACT_INDEX_DATA_SCHEMA_VERSION,
      source: ALL_THE_PLACES_SOURCE_ID,
      department,
      generatedAt,
      upstream: { project: "All The Places", runId: clean(runId) || null },
      recordCount: records.length,
      records,
    };
    await writeFile(path.join(outputDir, `${department}.json`), `${JSON.stringify(index)}\n`, "utf8");
    writtenDepartments.push(department);
    stats.indexed += records.length;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.sources?.[ALL_THE_PLACES_SOURCE_ID]) {
    throw new Error("La source all-the-places est absente du manifest des index.");
  }
  manifest.generatedAt = generatedAt;
  manifest.sources[ALL_THE_PLACES_SOURCE_ID].departments = writtenDepartments;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return Object.freeze({
    source: ALL_THE_PLACES_SOURCE_ID,
    generatedAt,
    requested: Object.freeze(requested),
    writtenDepartments: Object.freeze(writtenDepartments),
    perDepartment: Object.freeze(perDepartment),
    stats: Object.freeze(stats),
  });
}

export function parseGeneratorArgs(argv = []) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Valeur manquante pour --${key}.`);
    args[key] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseGeneratorArgs(process.argv.slice(2));
  if (!args.input) {
    throw new Error("Usage: node scripts/generate-all-the-places-index.mjs --input <répertoire extrait> --departments 44,85 [--run-id ...]");
  }
  const departments = clean(args.departments).split(",").map(value => value.trim()).filter(Boolean);
  const result = await generateAllThePlacesIndexes({
    input: path.resolve(args.input),
    departments,
    outputDir: args.output ? path.resolve(args.output) : DEFAULT_OUTPUT_DIR,
    manifestPath: args.manifest ? path.resolve(args.manifest) : DEFAULT_MANIFEST,
    generatedAt: args["generated-at"] || new Date().toISOString(),
    runId: args["run-id"] || null,
  });
  console.log(JSON.stringify(result, null, 2));
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
