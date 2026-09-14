#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  departmentFromPostalCode,
  normalizeDepartments,
} from "../widgets/structure-picker/departments.js";

const SOURCE_CONFIG = Object.freeze({
  "all-the-places": Object.freeze({ label: "All The Places" }),
  overture: Object.freeze({ label: "Overture Places" }),
});

function clean(value) {
  return String(value ?? "").trim();
}

function finiteOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanList(values) {
  const items = Array.isArray(values) ? values : [];
  return [...new Set(items.map(clean).filter(Boolean))];
}

function contactList(primary, values) {
  return cleanList([primary, ...(Array.isArray(values) ? values : [])]);
}

function normalizeDatasetToken(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function compactRecord(source, record = {}) {
  const common = {
    recordId: clean(record.recordId),
    name: clean(record.name),
    siret: clean(record.siret),
    address: clean(record.address),
    postcode: clean(record.postcode),
    city: clean(record.city),
    latitude: finiteOrNull(record.latitude),
    longitude: finiteOrNull(record.longitude),
  };

  if (source === "all-the-places") {
    return {
      ...common,
      spider: clean(record.spider),
      ref: clean(record.ref),
      sourceUri: clean(record.sourceUri),
      telephone: clean(record.telephone),
      courriel: clean(record.courriel),
      siteWeb: clean(record.siteWeb),
    };
  }

  const telephones = contactList(record.telephone, record.telephones);
  const courriels = contactList(record.courriel, record.courriels);
  const sitesWeb = contactList(record.siteWeb, record.sitesWeb);
  const datasets = cleanList((Array.isArray(record.sources) ? record.sources : []).map(item => item?.dataset));
  const hasAllThePlacesLineage = datasets.some(dataset => normalizeDatasetToken(dataset).includes("alltheplaces"));

  return {
    ...common,
    telephone: telephones[0] || "",
    courriel: courriels[0] || "",
    siteWeb: sitesWeb[0] || "",
    telephones,
    courriels,
    sitesWeb,
    confidence: finiteOrNull(record.confidence),
    datasets,
    hasAllThePlacesLineage,
  };
}

function hasContact(record) {
  return Boolean(clean(record.telephone) || clean(record.courriel) || clean(record.siteWeb));
}

function sortRecords(records) {
  return records.sort((left, right) =>
    left.recordId.localeCompare(right.recordId)
    || left.name.localeCompare(right.name, "fr"));
}

export async function buildContactRuntimeShards({
  source,
  inputDir,
  outputDir,
  manifestPath,
  departments,
} = {}) {
  const sourceConfig = SOURCE_CONFIG[source];
  if (!sourceConfig) throw new Error(`Source indexée non prise en charge : ${source ?? "absente"}.`);
  if (!inputDir || !outputDir || !manifestPath) throw new Error("inputDir, outputDir et manifestPath sont obligatoires.");

  const requested = normalizeDepartments(departments, []);
  if (!requested.length) throw new Error("Au moins un département valide est requis.");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifestSource = manifest?.sources?.[source];
  if (!manifestSource) throw new Error(`Source ${source} absente du manifest.`);

  const totals = { records: 0, shards: 0, skipped: 0 };
  const perDepartment = {};
  const publishedDepartments = [];

  for (const department of requested) {
    const inputPath = path.join(inputDir, `${department}.json`);
    const raw = JSON.parse(await readFile(inputPath, "utf8"));
    if (raw?.schemaVersion !== 1 || raw?.source !== source || raw?.department !== department || !Array.isArray(raw.records)) {
      throw new Error(`Index source invalide : ${inputPath}`);
    }

    const byPostcode = new Map();
    for (const original of raw.records) {
      const record = compactRecord(source, original);
      const postcode = record.postcode;
      if (!/^\d{5}$/.test(postcode) || departmentFromPostalCode(postcode) !== department || !record.recordId || !hasContact(record)) {
        totals.skipped += 1;
        continue;
      }
      if (!byPostcode.has(postcode)) byPostcode.set(postcode, []);
      byPostcode.get(postcode).push(record);
    }

    const departmentDir = path.join(outputDir, department);
    await mkdir(departmentDir, { recursive: true });
    let departmentRecords = 0;
    const postcodes = [...byPostcode.keys()].sort();
    for (const postcode of postcodes) {
      const records = sortRecords(byPostcode.get(postcode));
      const shard = {
        schemaVersion: 1,
        source,
        department,
        postcode,
        generatedAt: raw.generatedAt ?? manifest.generatedAt ?? null,
        upstream: raw.upstream ?? null,
        recordCount: records.length,
        records,
      };
      await writeFile(path.join(departmentDir, `${postcode}.json`), `${JSON.stringify(shard)}\n`, "utf8");
      departmentRecords += records.length;
      totals.records += records.length;
      totals.shards += 1;
    }

    perDepartment[department] = Object.freeze({ records: departmentRecords, shards: postcodes.length });
    if (postcodes.length) publishedDepartments.push(department);
  }

  manifestSource.label = clean(manifestSource.label) || sourceConfig.label;
  manifestSource.pathTemplate = `${source}/{department}/{postcode}.json`;
  manifestSource.shardBy = "postcode";
  manifestSource.departments = publishedDepartments;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return Object.freeze({
    source,
    departments: Object.freeze(publishedDepartments),
    perDepartment: Object.freeze(perDepartment),
    totals: Object.freeze(totals),
  });
}

function parseArgs(argv = []) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Valeur manquante pour ${token}.`);
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await buildContactRuntimeShards({
    source: args.source,
    inputDir: path.resolve(args.input),
    outputDir: path.resolve(args.output),
    manifestPath: path.resolve(args.manifest),
    departments: clean(args.departments).split(",").filter(Boolean),
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
