import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildingShardPath } from "../widgets/structure-picker/address-building-positions.js";
const groups = new Map();
for (const filename of process.argv.slice(2)) {
  const p = JSON.parse(await readFile(filename, "utf8"));
  if (
    p.schemaVersion !== 1 ||
    p.complete !== true ||
    !Array.isArray(p.ban) ||
    !p.source?.banUrl ||
    !p.source?.generatedAt
  )
    throw Error("Complete native address snapshot required");
  for (const record of p.ban) {
    const a = record.properties ?? {},
      address = [a.numero, a.rep, a.nom_voie, a.code_postal, a.nom_commune]
        .filter(Boolean)
        .join(" "),
      path = buildingShardPath(address);
    if (!path) continue;
    if (!groups.has(path))
      groups.set(path, {
        schemaVersion: 1,
        path,
        complete: true,
        source: {
          url: p.source.banUrl,
          generatedAt: p.source.generatedAt,
          nativeFeaturesSha256: createHash("sha256")
            .update(JSON.stringify(p.ban))
            .digest("hex"),
        },
        records: [],
      });
    const g = groups.get(path);
    if (!g.records.some((r) => r.properties.id === a.id))
      g.records.push(record);
  }
}
const root = new URL(
  "../widgets/structure-picker/site-position-indexes/certified-entrances/",
  import.meta.url,
);
const files = [...groups].map(([path, p]) => [
  path,
  JSON.stringify({ ...p, recordCount: p.records.length }) + "\n",
]);
if (files.some(([, s]) => Buffer.byteLength(s) > 96 * 1024))
  throw Error("Entrance shard exceeds budget");
for (const [path, text] of files) {
  await mkdir(new URL(path.split("/")[0] + "/", root), { recursive: true });
  await writeFile(new URL(path, root), text);
}
console.log("Native address shards:", files.length);
