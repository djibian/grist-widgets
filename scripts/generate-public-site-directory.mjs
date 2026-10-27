import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  parsePublisherPoint,
  plainHtml,
} from "../widgets/structure-picker/public-sites.js";
import { normalizeIdentity } from "../widgets/structure-picker/identity-resolution.js";
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i], process.argv[i + 1]);
const publisher = {
  kind: "OFFICIAL_MUNICIPAL_DIRECTORY",
  url: args.get("--url"),
  authorityUrl: args.get("--authority-url"),
  commune: args.get("--commune-name"),
  code: args.get("--commune"),
  postcode: args.get("--postcode"),
  label: args.get("--label"),
  checkedAt: new Date().toISOString(),
};
if (
  !/^\d{5}$/.test(publisher.code ?? "") ||
  !/^\d{5}$/.test(publisher.postcode ?? "") ||
  !publisher.label
)
  throw Error("Publisher and commune evidence required");
const authorityId = new URL(publisher.authorityUrl).pathname
  .split("/")
  .filter(Boolean)
  .at(-1);
if (!/^[a-f0-9-]{36}$/.test(authorityId))
  throw Error("Invalid public authority identifier");
const authorityUrl =
  "https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records?" +
  new URLSearchParams({ where: `id='${authorityId}'`, limit: "1" });
const authorityResponse = await fetch(authorityUrl, {
  signal: AbortSignal.timeout(15000),
});
const authorityPayload = await authorityResponse.json();
if (!authorityResponse.ok || authorityPayload.total_count !== 1)
  throw Error("Official publisher authority not demonstrated");
publisher.authorityDatasetUrl = authorityUrl;
publisher.authorityRecord = Object.fromEntries(
  ["id", "nom", "site_internet", "pivot", "date_modification_datetime"].map(
    (key) => [key, authorityPayload.results[0][key]],
  ),
);
const api = new URL(
  "/wp-json/wp/v2/fiche-annuaire?per_page=100",
  publisher.url,
);
const rr = await fetch(api, { signal: AbortSignal.timeout(30000) });
const entries = await rr.json();
if (
  !rr.ok ||
  !Array.isArray(entries) ||
  Number(rr.headers.get("x-wp-total")) !== entries.length
)
  throw Error(
    "Incomplete municipal directory; pagination must be handled before extending this cohort",
  );
const category = args.get("--category");
const cohort = category
  ? entries.filter((post) =>
      post.class_list?.includes("directory_category-" + category),
    )
  : entries;
const cache = args.get("--cache");
if (cache) await mkdir(cache, { recursive: true });
let cursor = 0;
const records = [];
async function worker() {
  while (cursor < cohort.length) {
    const post = cohort[cursor++];
    if (
      new URL(post.link).origin !== new URL(publisher.url).origin ||
      post.status !== "publish"
    )
      throw Error("Unexpected publisher URL/status");
    let html;
    const file = cache ? `${cache}/${post.id}.html` : null;
    try {
      if (file) {
        const cached = await stat(file);
        if (
          Date.now() - cached.mtimeMs < 5 * 60 * 1000 &&
          Date.parse(post.modified_gmt + "Z") <= cached.mtimeMs
        )
          html = await readFile(file, "utf8");
      }
    } catch {}
    if (!html) {
      const r = await fetch(post.link, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw Error(`Publisher page HTTP ${r.status}: ${post.id}`);
      html = await r.text();
      if (file) await writeFile(file, html);
    }
    const markerTags = [
      ...html.matchAll(
        /<div\b[^>]*\bclass=["'][^"']*\bmarker\b[^"']*["'][^>]*>/gi,
      ),
    ];
    if (markerTags.length !== 1) continue;
    const marker = markerTags[0];
    const before = html.slice(0, marker.index);
    const addresses = [
      ...before.matchAll(
        /<a\b[^>]*href=["']https:\/\/www\.google\.(?:fr|com)\/maps\/search\/[^"']*["'][^>]*>[^<]*<\/a>/gi,
      ),
    ];
    if (!addresses.length) continue;
    const native = {
      titleHtml: post.title.rendered,
      markerHtml: marker[0],
      addressHtml: addresses.at(-1)[0],
    };
    const point = parsePublisherPoint(native);
    if (!point) continue;
    const address = point.address.replace(/,\s*France\s*$/i, "");
    const parts = address.split(",").map((s) => s.trim());
    if (
      normalizeIdentity(parts.at(-1)) !== normalizeIdentity(publisher.commune)
    )
      continue;
    parts.pop();
    const publishedAddress = point.address;
    records.push({
      id: String(post.id),
      url: post.link,
      name: point.name,
      adresse: parts.join(" ") + ` ${publisher.postcode} ${publisher.commune}`,
      publishedAddress,
      latitude: point.latitude,
      longitude: point.longitude,
      modifiedAt: post.modified_gmt + "Z",
      native,
      sourceSha256: createHash("sha256").update(html).digest("hex"),
    });
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
records.sort((a, b) => a.id.localeCompare(b.id));
if (!records.length) throw Error("No publisher site points");
const payload = {
  schemaVersion: 1,
  publisher,
  source: {
    url: String(api),
    recordCount: entries.length,
    category: category ?? null,
    selectedRecords: cohort.length,
  },
  recordCount: records.length,
  records,
};
const text = JSON.stringify(payload) + "\n";
if (Buffer.byteLength(text) > 96 * 1024)
  throw Error("Public cohort exceeds browser budget");
const root = new URL(
  "../widgets/structure-picker/identity-links/public-sites/",
  import.meta.url,
);
await mkdir(root, { recursive: true });
await writeFile(new URL(`${publisher.code}.json`, root), text);
let manifest = { schemaVersion: 1, communes: [] };
try {
  manifest = JSON.parse(await readFile(new URL("manifest.json", root)));
} catch {}
manifest.communes = manifest.communes
  .filter((x) => x.code !== publisher.code)
  .concat([
    {
      code: publisher.code,
      name: publisher.commune,
      postcode: publisher.postcode,
    },
  ]);
await writeFile(
  new URL("manifest.json", root),
  JSON.stringify(manifest) + "\n",
);
console.log(
  JSON.stringify({
    sourceRecords: entries.length,
    georeferencedLocalSites: records.length,
  }),
);
