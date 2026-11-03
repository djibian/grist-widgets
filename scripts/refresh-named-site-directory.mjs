import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateNamedSite } from "../widgets/structure-picker/named-site-directory.js";
import { plainHtml } from "../widgets/structure-picker/public-sites.js";
import { normalizeIdentity } from "../widgets/structure-picker/identity-resolution.js";
import { phoneKey } from "../widgets/structure-picker/site-context.js";
// Facts are reviewed source data. A refresh never guesses a replacement name,
// address, operator SIRET or point when the publisher changes its page.
export function verifyPublishedFacts(record, html) {
  const text = normalizeIdentity(plainHtml(html)).replace(
    /\bbd\b/g,
    "boulevard",
  );
  const tokens = new Set(text.split(" "));
  for (const key of ["name", "adresse"])
    if (
      normalizeIdentity(record[key])
        .split(" ")
        .some((token) => !tokens.has(token))
    )
      throw Error(`${record.id}: ${key} is no longer supported`);
  for (const phone of record.contacts?.phones ?? [])
    if (!html.replace(/\D/g, "").includes(phoneKey(phone)))
      throw Error(`${record.id}: contact phone is no longer supported`);
  if (record.siret && !html.replace(/\D/g, "").includes(record.siret))
    throw Error(`${record.id}: site SIRET is no longer explicit`);
  if (record.point && !html.includes(record.point.nativeUrl))
    throw Error(`${record.id}: own map target changed`);
  const refreshed = {
    ...record,
    sourceSha256: createHash("sha256").update(html).digest("hex"),
    checkedAt: new Date().toISOString(),
  };
  if (!validateNamedSite(refreshed))
    throw Error(`${record.id}: invalid directory record`);
  return refreshed;
}
if (process.argv[1]?.endsWith("refresh-named-site-directory.mjs")) {
  const file = new URL(
    "../widgets/structure-picker/identity-links/site-directory/records.json",
    import.meta.url,
  );
  const payload = JSON.parse(await readFile(file, "utf8"));
  const records = [];
  for (const record of payload.records) {
    const r = await fetch(record.url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error(`${record.id}: HTTP ${r.status}`);
    records.push(verifyPublishedFacts(record, await r.text()));
  }
  await writeFile(
    file,
    JSON.stringify({ ...payload, records }, null, 2) + "\n",
  );
}
