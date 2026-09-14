#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  departmentFromPostalCode,
  normalizeDepartments,
} from "../widgets/structure-picker/departments.js";

export const OVERTURE_SOURCE_ID = "overture";
export const CONTACT_INDEX_DATA_SCHEMA_VERSION = 1;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "widgets/structure-picker/contact-indexes/overture");
const DEFAULT_MANIFEST = path.join(REPO_ROOT, "widgets/structure-picker/contact-indexes/indexed-departments.json");
const SEQUENCE_EXTENSIONS = new Set([".geojsonseq", ".jsonl", ".ndjson"]);

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function finiteOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const normalized = clean(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function coordinatesOf(feature) {
  if (feature?.geometry?.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) {
    return { latitude: null, longitude: null };
  }
  const [longitude, latitude] = feature.geometry.coordinates;
  return { latitude: finiteOrNull(latitude), longitude: finiteOrNull(longitude) };
}

function addressText(address) {
  const freeform = clean(address?.freeform);
  const locality = [clean(address?.postcode), clean(address?.locality)].filter(Boolean).join(" ");
  if (!freeform) return locality;
  if (!locality || freeform.toLocaleLowerCase("fr-FR").includes(locality.toLocaleLowerCase("fr-FR"))) {
    return freeform;
  }
  return `${freeform}, ${locality}`;
}

function requestedAddress(addresses, requestedDepartments) {
  if (!Array.isArray(addresses)) return null;
  const requested = new Set(normalizeDepartments(requestedDepartments, []));
  for (const address of addresses) {
    if (!address || typeof address !== "object") continue;
    const country = clean(address.country).toUpperCase();
    if (country && country !== "FR") continue;
    const postcode = clean(address.postcode);
    const department = departmentFromPostalCode(postcode);
    if (!department || !requested.has(department)) continue;
    return { department, address };
  }
  return null;
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") return null;
  const normalized = {
    property: clean(source.property),
    dataset: clean(source.dataset),
    provider: clean(source.provider),
    recordId: clean(source.record_id ?? source.recordId),
    license: clean(source.license),
    updateTime: clean(source.update_time ?? source.updateTime),
    resource: clean(source.resource),
    confidence: finiteOrNull(source.confidence),
  };
  if (!Object.values(normalized).some(value => value !== "" && value !== null)) return null;
  return Object.freeze(normalized);
}

function normalizedSources(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeSource).filter(Boolean);
}

function recordIdOf(feature, properties) {
  return clean(properties.id) || clean(feature?.id);
}

function richness(record) {
  return record.telephones.length + record.courriels.length + record.sitesWeb.length;
}

function preferredRecord(left, right) {
  const richnessDelta = richness(right) - richness(left);
  if (richnessDelta > 0) return right;
  if (richnessDelta < 0) return left;
  const leftConfidence = left.confidence ?? -1;
  const rightConfidence = right.confidence ?? -1;
  return rightConfidence > leftConfidence ? right : left;
}

export function normalizeOvertureFeature(feature, requestedDepartments = []) {
  if (!feature || typeof feature !== "object") return null;
  const properties = feature.properties && typeof feature.properties === "object"
    ? feature.properties
    : {};
  if (clean(properties.operating_status).toLowerCase() === "permanently_closed") return null;

  const addressMatch = requestedAddress(properties.addresses, requestedDepartments);
  if (!addressMatch) return null;

  const telephones = cleanList(properties.phones);
  const courriels = cleanList(properties.emails);
  const sitesWeb = cleanList(properties.websites);
  if (!telephones.length && !courriels.length && !sitesWeb.length) return null;

  const recordId = recordIdOf(feature, properties);
  if (!recordId) return null;
  const { latitude, longitude } = coordinatesOf(feature);
  const address = addressMatch.address;
  const sources = normalizedSources(properties.sources);

  const record = {
    recordId,
    name: clean(properties.names?.primary),
    siret: "",
    address: addressText(address),
    postcode: clean(address.postcode),
    city: clean(address.locality),
    latitude,
    longitude,
    telephone: telephones[0] || "",
    courriel: courriels[0] || "",
    siteWeb: sitesWeb[0] || "",
    telephones: Object.freeze(telephones),
    courriels: Object.freeze(courriels),
    sitesWeb: Object.freeze(sitesWeb),
    confidence: finiteOrNull(properties.confidence),
    operatingStatus: clean(properties.operating_status),
    basicCategory: clean(properties.basic_category || properties.taxonomy?.primary || properties.categories?.primary),
    version: finiteOrNull(properties.version),
    sources: Object.freeze(sources),
  };

  return Object.freeze({
    department: addressMatch.department,
    record: Object.freeze(record),
  });
}

async function* walkInputFiles(inputPath) {
  const info = await stat(inputPath);
  if (info.isFile()) {
    const extension = path.extname(inputPath).toLowerCase();
    if (extension === ".geojson" || SEQUENCE_EXTENSIONS.has(extension)) yield inputPath;
    return;
  }
  if (!info.isDirectory()) return;
  const entries = await readdir(inputPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const child = path.join(inputPath, entry.name);
    if (entry.isDirectory()) yield* walkInputFiles(child);
    else if (entry.isFile()) {
      const extension = path.extname(entry.name).toLowerCase();
      if (extension === ".geojson" || SEQUENCE_EXTENSIONS.has(extension)) yield child;
    }
  }
}

async function* readGeoJsonFeatures(file) {
  const data = JSON.parse(await readFile(file, "utf8"));
  if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
    yield* data.features;
    return;
  }
  if (data?.type === "Feature") {
    yield data;
    return;
  }
  throw new Error(`GeoJSON Overture invalide : ${file}`);
}

async function* readSequenceFeatures(file) {
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const raw of lines) {
    lineNumber += 1;
    const line = raw.trim().replace(/^\u001e/, "");
    if (!line) continue;
    const value = JSON.parse(line);
    if (value?.type !== "Feature") {
      throw new Error(`GeoJSONSeq Overture invalide : ${file}:${lineNumber}`);
    }
    yield value;
  }
}

async function* readFeatures(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".geojson") yield* readGeoJsonFeatures(file);
  else yield* readSequenceFeatures(file);
}

function sortedRecords(records) {
  return [...records.values()].sort((left, right) =>
    left.recordId.localeCompare(right.recordId)
    || left.name.localeCompare(right.name));
}

export async function generateOvertureIndexes({
  input,
  departments,
  outputDir = DEFAULT_OUTPUT_DIR,
  manifestPath = DEFAULT_MANIFEST,
  generatedAt = new Date().toISOString(),
  release = null,
  schemaVersion = null,
} = {}) {
  if (!input) throw new Error("Le chemin vers l'export Overture est obligatoire.");
  const requested = normalizeDepartments(departments, []);
  if (!requested.length) throw new Error("Au moins un département valide est requis.");

  const byDepartment = new Map(requested.map(code => [code, new Map()]));
  const stats = { files: 0, features: 0, candidates: 0, indexed: 0, duplicates: 0 };

  for await (const file of walkInputFiles(input)) {
    stats.files += 1;
    for await (const feature of readFeatures(file)) {
      stats.features += 1;
      const item = normalizeOvertureFeature(feature, requested);
      if (!item) continue;
      stats.candidates += 1;
      const records = byDepartment.get(item.department);
      const previous = records.get(item.record.recordId);
      if (previous) stats.duplicates += 1;
      records.set(item.record.recordId, previous ? preferredRecord(previous, item.record) : item.record);
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
      source: OVERTURE_SOURCE_ID,
      department,
      generatedAt,
      upstream: {
        project: "Overture Maps",
        release: clean(release) || null,
        schemaVersion: clean(schemaVersion) || null,
      },
      recordCount: records.length,
      records,
    };
    await writeFile(path.join(outputDir, `${department}.json`), `${JSON.stringify(index)}\n`, "utf8");
    writtenDepartments.push(department);
    stats.indexed += records.length;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.sources?.[OVERTURE_SOURCE_ID]) {
    throw new Error("La source overture est absente du manifest des index.");
  }
  manifest.generatedAt = generatedAt;
  manifest.sources[OVERTURE_SOURCE_ID].departments = writtenDepartments;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return Object.freeze({
    source: OVERTURE_SOURCE_ID,
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
    throw new Error("Usage: node scripts/generate-overture-index.mjs --input <export.geojsonseq> --departments 44,85 [--release ...]");
  }
  const departments = clean(args.departments).split(",").map(value => value.trim()).filter(Boolean);
  const result = await generateOvertureIndexes({
    input: path.resolve(args.input),
    departments,
    outputDir: args.output ? path.resolve(args.output) : DEFAULT_OUTPUT_DIR,
    manifestPath: args.manifest ? path.resolve(args.manifest) : DEFAULT_MANIFEST,
    generatedAt: args["generated-at"] || new Date().toISOString(),
    release: args.release || null,
    schemaVersion: args["schema-version"] || null,
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
