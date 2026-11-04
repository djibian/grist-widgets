// Refresh previously captured exact identifiers, or an explicit bounded list. No Grist row IDs or expected decisions.
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildOfficialIdentifierSearchRequest } from "../widgets/structure-picker/search.js";
const root = new URL(
  "../widgets/structure-picker/identity-links/",
  import.meta.url,
);
const requested = process.argv.slice(2);
const selected = requested.length
  ? requested
  : (await readdir(new URL("official-snapshots/", root)))
      .filter((f) => /^\d{9}(?:\d{5})?\.json$/.test(f))
      .map((f) => f.slice(0, -5));
if (
  selected.length > 100 ||
  selected.some((id) => !/^\d{9}(?:\d{5})?$/.test(id))
)
  throw Error("At most 100 exact SIREN/SIRET identifiers required");
await mkdir(new URL("official-snapshots/", root), { recursive: true });
for (const siret of selected) {
  const request = buildOfficialIdentifierSearchRequest(siret);
  const r = await fetch(request.url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok)
    throw Error(`${siret}: HTTP ${r.status}; existing snapshot retained`);
  const body = await r.text();
  JSON.parse(body);
  await writeFile(
    new URL(`official-snapshots/${siret}.json`, root),
    JSON.stringify({
      schemaVersion: 1,
      siret,
      url: request.url,
      checkedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(body).digest("hex"),
      body,
    }) + "\n",
  );
  console.log("Captured", siret);
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
