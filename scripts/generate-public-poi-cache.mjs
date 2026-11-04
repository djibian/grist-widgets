// Derive small geometry-only shards from complete, dated public postcode captures.
import {
  readFile,
  mkdir,
  writeFile,
  mkdtemp,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  parseSiteAddress,
  usableCoordinates,
} from "../widgets/structure-picker/identity-resolution.js";
const root = new URL(
  "../widgets/structure-picker/site-position-indexes/public-pois/",
  import.meta.url,
);
const encoded = [];
for (const filename of process.argv.slice(2)) {
  const body = await readFile(filename, "utf8"),
    p = JSON.parse(body);
  if (
    !Array.isArray(p.records) ||
    p.recordCount !== p.records.length ||
    !p.generatedAt
  )
    throw Error("Complete dated source shard required");
  const postcode = filename.match(/(\d{5})\.json$/)?.[1];
  if (!postcode) throw Error("Postcode required");
  const groups = new Map();
  for (const r of p.records) {
    if (!r.name || !r.address || !usableCoordinates(r.latitude, r.longitude))
      continue;
    const bucket = parseSiteAddress(r.address).number[0] || "none";
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups
      .get(bucket)
      .push({
        kind: "site",
        name: r.name,
        siret: r.siret || "",
        adresse: r.address,
        latitude: r.latitude,
        longitude: r.longitude,
        source: {
          id: "overture",
          label: "Overture Places",
          recordId: r.recordId,
          url:
            r.sourceUri ||
            `https://explore.overturemaps.org/?id=${encodeURIComponent(r.recordId)}`,
          indexUrl: `https://djibian.github.io/grist-widgets/widgets/structure-picker/contact-indexes/overture/${postcode.slice(0, 2)}/${postcode}.json`,
          generatedAt: p.generatedAt,
        },
      });
  }
  for (const [bucket, records] of groups) {
    const payload = {
      schemaVersion: 1,
      postcode,
      bucket,
      recordCount: records.length,
      source: {
        url: `https://djibian.github.io/grist-widgets/widgets/structure-picker/contact-indexes/overture/${postcode.slice(0, 2)}/${postcode}.json`,
        sha256: createHash("sha256").update(body).digest("hex"),
        generatedAt: p.generatedAt,
        capturedAt: new Date().toISOString(),
        sourceRecordCount: p.recordCount,
        upstream: p.upstream,
      },
      records,
    };
    const text = JSON.stringify(payload) + "\n";
    if (Buffer.byteLength(text) > 256 * 1024)
      throw Error(
        `POI cache exceeds budget ${postcode}/${bucket}: ${Buffer.byteLength(text)}`,
      );
    encoded.push({ postcode, bucket, text });
  }
  console.log(
    postcode,
    [...groups.values()].reduce((n, a) => n + a.length, 0),
  );
}

if (!encoded.length) throw Error("No complete postcode capture provided");
await mkdir(root, { recursive: true });
const temp = await mkdtemp(new URL("../.public-pois-tmp-", root));
try {
  for (const { postcode, bucket, text } of encoded) {
    await mkdir(`${temp}/${postcode}`, { recursive: true });
    await writeFile(`${temp}/${postcode}/${bucket}.json`, text);
  }
  for (const postcode of await readdir(temp)) {
    await rm(new URL(postcode, root), { recursive: true, force: true });
    await rename(`${temp}/${postcode}`, new URL(postcode, root));
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
