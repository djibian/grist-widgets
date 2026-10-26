import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildingShardPath, validateAddressBuildingRecord, ADDRESS_BUILDING_BUDGET } from "../widgets/structure-picker/address-building-positions.js";

const BDNB = "https://api.bdnb.io/v1/bdnb/donnees/";
const RNB = "https://rnb-api.beta.gouv.fr/api/alpha/buildings/";
const BAN = "https://data.geopf.fr/wfs/ows";
const defaultOutput = fileURLToPath(new URL("../widgets/structure-picker/site-position-indexes/address-buildings/", import.meta.url));

async function getJson(url, { fetchImpl = fetch, headers = {} } = {}) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return { data: await response.json(), profile: response.headers.get("content-profile"), maxItems: Number(response.headers.get("x-max-items-per-call")) };
}

async function bdnbRows(table, query, schema, fetchImpl) {
  const rows = [];
  let offset = 0;
  const seenPages = new Set();
  for (let page = 0; page < 1000; page += 1) {
    const url = new URL(table, BDNB);
    for (const [key, value] of Object.entries({ ...query, limit: "1000", offset: String(offset) })) url.searchParams.set(key, value);
    const { data, profile, maxItems } = await getJson(url, { fetchImpl, headers: { "Accept-Profile": schema } });
    if (profile !== schema) throw new Error(`Unexpected or missing BDNB schema ${profile}`);
    if (!Array.isArray(data)) throw new Error("Incomplete BDNB response");
    const fingerprint = JSON.stringify(data);
    if (data.length && seenPages.has(fingerprint)) throw new Error("BDNB ignored pagination");
    seenPages.add(fingerprint);
    rows.push(...data);
    if (!data.length || (maxItems > 0 && data.length < Math.min(1000, maxItems))) return rows;
    offset += data.length;
  }
  throw new Error("BDNB pagination exceeds the snapshot budget");
}

async function banRows(street, fetchImpl) {
  const features = [];
  let expected;
  let offset = 0;
  for (let page = 0; page < 1000; page += 1) {
    const url = new URL(BAN);
    url.search = new URLSearchParams({ SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAME: "BAN.DATA.GOUV:ban",
      outputFormat: "application/json", CQL_FILTER: `id_fantoir='${street}'`, count: "1000", startIndex: String(offset) });
    const { data } = await getJson(url, { fetchImpl });
    if (!Array.isArray(data.features) || !Number.isInteger(data.numberMatched)) throw new Error("Incomplete BAN WFS response");
    if (expected !== undefined && expected !== data.numberMatched) throw new Error("BAN changed during pagination");
    expected = data.numberMatched;
    features.push(...data.features);
    if (features.length === expected) return features;
    if (!data.features.length || features.length > expected) throw new Error("Truncated BAN response");
    offset += data.features.length;
  }
  throw new Error("BAN pagination exceeds the snapshot budget");
}

export async function captureBuildingSnapshot({ streets, version, fetchImpl = fetch }) {
  if (!streets?.length || streets.some(code => !/^\d{5}_[A-Za-z0-9]+$/.test(code)) || !/^\d{6}[a-z]_\d+$/.test(version || "")) throw new Error("BAN street identifiers and the current BDNB schema version are required");
  const snapshot = { schemaVersion: 1, complete: true, source: {
    id: "bdnb-rnb", version, generatedAt: new Date().toISOString(), streets,
    banUrl: BAN + "?" + new URLSearchParams({ SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAME: "BAN.DATA.GOUV:ban", outputFormat: "application/json", CQL_FILTER: `id_fantoir IN (${streets.map(code => `'${code}'`).join(",")})` }),
    bdnbUrl: BDNB + "rel_batiment_groupe_adresse", rnbUrl: RNB,
    license: "Licence Ouverte 2.0",
  }, ban: [], relations: [], groups: [], constructions: [], buildings: [] };
  const schema = `api_open_${version}`;
  for (const street of streets) {
    const ban = await banRows(street, fetchImpl);
    if (ban.some(feature => feature.properties?.id_fantoir !== street)) throw new Error("BAN ignored the requested street filter");
    const relations = [];
    // Exact primary-key lookups avoid broad LIKE scans and collation-dependent
    // ranges. Read every relation, including weak/competing ones, before judging
    // uniqueness. Extraction is offline with limited concurrency.
    for (let i = 0; i < ban.length; i += 3) {
      const batches = await Promise.all(ban.slice(i, i + 3).map(feature => bdnbRows("rel_batiment_groupe_adresse", { cle_interop_adr: `eq.${feature.properties.id}` }, schema, fetchImpl)));
      relations.push(...batches.flat());
    }
    const ids = [...new Set(relations.map(relation => relation.batiment_groupe_id))];
    if (!ids.length) throw new Error(`No BDNB address relations for ${street}`);
    if (ids.some(id => !/^bdnb-bg-[A-Z0-9-]+$/.test(id))) throw new Error("Invalid building identifier");
    const filter = `in.(${ids.join(",")})`;
    const [descriptions, geometries, constructions] = await Promise.all([
      bdnbRows("batiment_groupe_complet", { batiment_groupe_id: filter,
        select: "batiment_groupe_id,cle_interop_adr_principale_ban,libelle_adr_principale_ban,fiabilite_cr_adr_niv_1,fiabilite_cr_adr_niv_2,fiabilite_emprise_sol,l_cle_interop_adr,l_parcelle_id" }, schema, fetchImpl),
      bdnbRows("batiment_groupe", { batiment_groupe_id: filter,
        select: "batiment_groupe_id,contient_fictive_geom_groupe,geom_groupe_pos_wgs84" }, schema, fetchImpl),
      bdnbRows("batiment_construction", { batiment_groupe_id: filter,
        select: "batiment_groupe_id,batiment_construction_id,rnb_id,fictive_geom_cstr" }, schema, fetchImpl),
    ]);
    const byId = new Map(geometries.map(group => [group.batiment_groupe_id, group]));
    const rnbIds = [...new Set(constructions.map(construction => construction.rnb_id).filter(Boolean))];
    if (rnbIds.some(id => !/^[A-Z0-9]{12}$/.test(id))) throw new Error("Invalid RNB identifier");
    const buildings = [];
    // Offline extraction only, with limited concurrency. Browser resolution
    // reads one same-origin shard and never waits for these public APIs.
    for (let i = 0; i < rnbIds.length; i += 3) {
      buildings.push(...await Promise.all(rnbIds.slice(i, i + 3).map(async id => {
        const { data } = await getJson(`${RNB}${id}/?withPlots=1`, { fetchImpl });
        if (data.rnb_id !== id) throw new Error("RNB identifier changed");
        const { rnb_id, status, point, shape, addresses, ext_ids, is_active, plots } = data;
        return { rnb_id, status, point, shape, addresses, ext_ids, is_active, plots };
      })));
    }
    snapshot.ban.push(...ban); snapshot.relations.push(...relations); snapshot.constructions.push(...constructions); snapshot.buildings.push(...buildings);
    snapshot.groups.push(...descriptions.map(group => ({ ...group, ...byId.get(group.batiment_groupe_id) })));
    process.stderr.write(`Captured ${street}: ${ban.length} BAN addresses, ${relations.length} relations, ${descriptions.length} groups, ${buildings.length} RNB buildings\n`);
  }
  for (const [field, key] of [["ban", item => item.properties.id], ["relations", item => `${item.cle_interop_adr}:${item.batiment_groupe_id}`],
    ["groups", item => item.batiment_groupe_id], ["constructions", item => item.batiment_construction_id], ["buildings", item => item.rnb_id]]) {
    const records = new Map();
    for (const record of snapshot[field]) {
      const id = key(record);
      if (records.has(id) && JSON.stringify(records.get(id)) !== JSON.stringify(record)) throw new Error("Source changed between street captures");
      records.set(id, record);
    }
    snapshot[field] = [...records.values()];
  }
  return snapshot;
}

function uniqueMap(records, key) {
  const map = new Map();
  for (const record of records) {
    const id = key(record);
    if (!id || map.has(id)) throw new Error(`Duplicate or missing source identifier: ${id}`);
    map.set(id, record);
  }
  return map;
}

export function buildAddressBuildingShards(snapshot) {
  if (snapshot?.schemaVersion !== 1 || snapshot.complete !== true || snapshot.source?.id !== "bdnb-rnb"
    || !snapshot.source.version || !Number.isFinite(Date.parse(snapshot.source.generatedAt))
    || !["ban", "relations", "groups", "constructions", "buildings"].every(key => Array.isArray(snapshot[key]))) throw new Error("Incomplete building snapshot");
  const addresses = uniqueMap(snapshot.ban, feature => feature.properties?.id);
  const groups = uniqueMap(snapshot.groups, group => group.batiment_groupe_id);
  const buildings = uniqueMap(snapshot.buildings, building => building.rnb_id);
  uniqueMap(snapshot.constructions, construction => construction.batiment_construction_id);
  uniqueMap(snapshot.relations, relation => `${relation.cle_interop_adr}:${relation.batiment_groupe_id}`);
  const shards = new Map();
  for (const [id, ban] of addresses) {
    const relations = snapshot.relations.filter(relation => relation.cle_interop_adr === id);
    const group = groups.get(relations[0]?.batiment_groupe_id);
    const constructions = snapshot.constructions.filter(construction => construction.batiment_groupe_id === group?.batiment_groupe_id);
    const rnb = buildings.get(constructions[0]?.rnb_id);
    const record = { ban, relations, group, constructions, rnb };
    const checked = validateAddressBuildingRecord(record);
    if (!checked.accepted) continue;
    const filename = buildingShardPath(checked.adresse);
    if (!shards.has(filename)) shards.set(filename, { schemaVersion: 1, path: filename, complete: true, source: snapshot.source, recordCount: 0, records: [] });
    const shard = shards.get(filename); shard.records.push(record); shard.recordCount += 1;
  }
  if (!shards.size) throw new Error("No demonstrated address/building chains; existing index not replaced");
  for (const shard of shards.values()) shard.records.sort((a, b) => a.ban.properties.id.localeCompare(b.ban.properties.id));
  return shards;
}

async function main() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
  const snapshot = args.has("--input") ? JSON.parse(await readFile(args.get("--input"), "utf8"))
    : await captureBuildingSnapshot({ streets: (args.get("--streets") || "").split(",").filter(Boolean), version: args.get("--bdnb-version") });
  if (args.has("--snapshot")) await writeFile(args.get("--snapshot"), JSON.stringify(snapshot));
  const shards = buildAddressBuildingShards(snapshot);
  const encoded = [...shards].map(([filename, data]) => [filename, JSON.stringify(data) + "\n"]);
  if (encoded.some(([, text]) => Buffer.byteLength(text) > ADDRESS_BUILDING_BUDGET.maxShardBytes)) throw new Error("Building shard exceeds browser payload budget");
  const output = args.get("--output") || defaultOutput;
  const temporary = `${output}.building-tmp-${process.pid}`;
  await mkdir(temporary, { recursive: true });
  try {
    for (const [filename, text] of encoded) {
      await mkdir(path.dirname(path.join(temporary, filename)), { recursive: true });
      await writeFile(path.join(temporary, filename), text);
    }
    // Keep documentation and replace data only after the entire source and
    // payload budget have been checked, never after a partial network response.
    await mkdir(output, { recursive: true });
    for (const name of await readdir(output)) if (/^\d{5}$/.test(name)) await rm(path.join(output, name), { recursive: true });
    for (const name of await readdir(temporary)) await rename(path.join(temporary, name), path.join(output, name));
  } finally { await rm(temporary, { recursive: true, force: true }); }
  console.log(`Published ${encoded.reduce((sum, [, text]) => sum + JSON.parse(text).recordCount, 0)} building proofs in ${encoded.length} shards`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
