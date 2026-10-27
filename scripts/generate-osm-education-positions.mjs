import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { educationPositionFromElement } from "../widgets/structure-picker/registry-site-positions.js";
export function buildEducationPositions(payload, url) {
  if (payload.remark || !payload.osm3s?.timestamp_osm_base || !Array.isArray(payload.elements)) throw new Error("Incomplete Overpass export");
  const source = { id: "osm-education-positions", label: "OpenStreetMap — sites UAI", url, generatedAt: payload.osm3s.timestamp_osm_base, license: "ODbL 1.0" };
  const shards = new Map(); const seen = new Set();
  for (const element of payload.elements) {
    const record = Object.fromEntries(["type", "id", "lat", "lon", "nodes", "geometry", "tags", "version", "timestamp", "changeset"].filter(key => key in element).map(key => [key, element[key]]));
    const poi = educationPositionFromElement(record, source);
    if (!poi) continue;
    const key = `${record.type}:${record.id}`; if (seen.has(key)) throw new Error("Duplicate OSM object"); seen.add(key);
    for (const prefix of new Set(poi.uaiIds.map(id => id.slice(0, 6)))) {
      if (!shards.has(prefix)) shards.set(prefix, []); shards.get(prefix).push(record);
    }
  }
  if (!shards.size) throw new Error("Empty OSM UAI export");
  return new Map([...shards].map(([prefix, records]) => [prefix, { schemaVersion: 1, prefix, source, recordCount: records.length, records }]));
}
async function main() {
  const args = new Map(); for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
  const query = '[out:json][timeout:90];(nwr["ref:UAI"~"^(044|085)"];nwr["ref:FR:UAI"~"^(044|085)"];);out meta geom;';
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  const payload = args.has("--input") ? JSON.parse(await readFile(args.get("--input"), "utf8")) : await (await fetch(url, { signal: AbortSignal.timeout(95000) })).json();
  const shards = buildEducationPositions(payload, url);
  const encoded = [...shards].map(([prefix, value]) => [`${prefix}.json`, JSON.stringify(value) + "\n"]);
  if (encoded.some(([, text]) => Buffer.byteLength(text) > 96 * 1024)) throw new Error("OSM UAI shard exceeds browser budget");
  const output = args.get("--output") ?? fileURLToPath(new URL("../widgets/structure-picker/site-position-indexes/osm-education/", import.meta.url));
  await mkdir(output, { recursive: true });
  for (const file of await readdir(output)) if (file.endsWith(".json") && !encoded.some(([name]) => name === file)) await rm(path.join(output, file));
  for (const [name, text] of encoded) await writeFile(path.join(output, name), text);
  console.log(JSON.stringify({ records: [...shards.values()].reduce((n, shard) => n + shard.recordCount, 0), files: shards.size }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
