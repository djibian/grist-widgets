import { readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeRegistryRecords, SITE_REGISTRY_BUDGET } from "../widgets/structure-picker/official-site-registry.js";

export function buildSiteRegistry({ education, finess, source, generatedAt = new Date().toISOString() }) {
  const towns = new Map();
  const add = entry => {
    for (const record of normalizeRegistryRecords(entry, source)) {
      if (!/^\d{5}$/.test(record.codeCommune) || !/^\d{5}$/.test(record.postcode)) continue;
      if (!towns.has(record.codeCommune)) towns.set(record.codeCommune, { code: record.codeCommune, names: new Set(), postcodes: new Set(), entries: new Map() });
      const town = towns.get(record.codeCommune);
      town.names.add(record.commune); town.postcodes.add(record.postcode);
      town.entries.set(`${entry.kind}:${record.recordId}`, entry);
    }
  };
  for (const native of education) add({ kind: "education", native });
  for (const native of finess) add({ kind: "finess", native });
  const files = new Map();
  const communes = [];
  for (const town of [...towns.values()].sort((a, b) => a.code.localeCompare(b.code))) {
    let records = []; const names = [];
    const flush = () => {
      const name = `${town.code}.${names.length}.json`;
      files.set(name, { schemaVersion: 1, recordCount: records.length, records }); names.push(name); records = [];
    };
    for (const entry of town.entries.values()) {
      if (Buffer.byteLength(JSON.stringify({ schemaVersion: 1, recordCount: records.length + 1, records: [...records, entry] })) > SITE_REGISTRY_BUDGET.maxShardBytes) {
        if (!records.length) throw new Error("A registry record exceeds the browser budget");
        flush();
      }
      records.push(entry);
    }
    if (records.length) flush();
    communes.push({ code: town.code, names: [...town.names], postcodes: [...town.postcodes], files: names });
  }
  files.set("manifest.json", { schemaVersion: 1, generatedAt, source, communes });
  return files;
}

async function main() {
  const args = new Map(); for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
  const root = new URL("../widgets/structure-picker/", import.meta.url);
  const educationUrl = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/exports/json?where=code_departement%20in%20(%27044%27,%27085%27)";
  const education = args.has("--education-input") ? JSON.parse(await readFile(args.get("--education-input"), "utf8")) : await (async () => {
    const response = await fetch(educationUrl, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Education export HTTP ${response.status}`);
    const records = await response.json();
    const countUrl = educationUrl.replace("/exports/json?", "/records?append_labels=false&limit=1&");
    const countResponse = await fetch(countUrl, { signal: AbortSignal.timeout(10000) });
    if (!countResponse.ok || (await countResponse.json()).total_count !== records.length) throw new Error("Education export is incomplete");
    return records;
  })();
  if (!Array.isArray(education) || education.length < 100) throw new Error("Incomplete regional education export");
  // Retain original identifiers/name/address/type/precision, without contacts or
  // unrelated attributes. The transform has no school-name or SIRET exceptions.
  const keys = ["identifiant_de_l_etablissement", "nom_etablissement", "type_etablissement", "statut_public_prive", "adresse_1", "adresse_2", "code_postal", "code_commune", "nom_commune", "siren_siret", "etat", "latitude", "longitude", "precision_localisation", "date_maj_ligne", "code_nature", "libelle_nature"];
  const schoolRecords = education.map(record => Object.fromEntries(keys.map(key => [key, record[key] ?? null])));
  const finess = []; let finessSource;
  for (const name of (await readdir(new URL("identity-links/finess/", root))).filter(name => name.endsWith(".json"))) {
    const payload = JSON.parse(await readFile(new URL(`identity-links/finess/${name}`, root), "utf8"));
    finess.push(...payload.records); finessSource = payload.source;
  }
  const source = { education: { url: educationUrl, generatedAt: new Date().toISOString(), license: "Licence Ouverte 2.0" }, finess: finessSource };
  const files = buildSiteRegistry({ education: schoolRecords, finess, source });
  const output = args.get("--output") || fileURLToPath(new URL("identity-links/site-registry/", root));
  await mkdir(output, { recursive: true });
  const encoded = [...files].map(([name, value]) => [name, JSON.stringify(value) + "\n"]);
  if (encoded.some(([name, text]) => Buffer.byteLength(text) > (name === "manifest.json" ? 256 * 1024 : SITE_REGISTRY_BUDGET.maxShardBytes))) throw new Error("Registry shard exceeds browser budget");
  for (const name of await readdir(output)) if (name.endsWith(".json") && !files.has(name)) await rm(path.join(output, name));
  for (const [name, text] of encoded) await writeFile(path.join(output, name), text);
  console.log(JSON.stringify({ education: schoolRecords.length, finess: finess.length, communes: files.get("manifest.json").communes.length, files: files.size }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
