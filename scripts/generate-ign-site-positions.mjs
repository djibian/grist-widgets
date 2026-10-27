import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { ignSiteObservation } from "../widgets/structure-picker/ign-site-positions.js";
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i], process.argv[i + 1]);
const town = args.get("--commune");
if (!/^\d{5}$/.test(town ?? ""))
  throw Error("--commune requires a public INSEE code");
const query = new URLSearchParams({
  service: "WFS",
  version: "2.0.0",
  request: "GetFeature",
  typeNames: "BDTOPO_V3:zone_d_activite_ou_d_interet",
  outputFormat: "application/json",
  srsName: "urn:ogc:def:crs:OGC:1.3:CRS84",
  CQL_FILTER: `insee_commune='${town}'`,
  count: "1000",
});
const url = "https://data.geopf.fr/wfs/ows?" + query;
const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
if (!r.ok) throw Error(`IGN HTTP ${r.status}`);
const p = await r.json();
if (
  !Array.isArray(p.features) ||
  !Number.isInteger(p.numberMatched) ||
  p.numberMatched !== p.features.length
)
  throw Error("Incomplete IGN cohort");
const source = {
  url,
  generatedAt: new Date().toISOString(),
  license: "Licence Ouverte 2.0",
  cohort: { commune: town, count: p.features.length },
};
const groups = new Map();
for (const f of p.features) {
  const poi = ignSiteObservation(f, source);
  if (!poi) continue;
  for (const prefix of new Set(poi.uaiIds.map((id) => id.slice(0, 6)))) {
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(f);
  }
}
const files = [...groups].map(([prefix, records]) => [
  prefix,
  JSON.stringify({
    schemaVersion: 1,
    prefix,
    source,
    recordCount: records.length,
    records,
  }) + "\n",
]);
if (
  !files.length ||
  files.some(([, text]) => Buffer.byteLength(text) > 96 * 1024)
)
  throw Error("Empty or oversized IGN cohort");
const root = new URL(
  `../widgets/structure-picker/site-position-indexes/ign-education/${town}/`,
  import.meta.url,
);
await mkdir(root, { recursive: true });
for (const name of await readdir(root)) {
  if (
    /^\d{6}\.json$/.test(name) &&
    !files.some(([prefix]) => name === `${prefix}.json`)
  )
    await rm(new URL(name, root));
}
for (const [prefix, text] of files)
  await writeFile(new URL(`${prefix}.json`, root), text);
console.log(
  JSON.stringify({
    cohort: p.features.length,
    sites: [...groups.values()].flat().length,
    files: groups.size,
  }),
);
