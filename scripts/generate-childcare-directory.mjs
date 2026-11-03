import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { plainHtml } from "../widgets/structure-picker/public-sites.js";
import { validateNamedSite } from "../widgets/structure-picker/named-site-directory.js";
export function parseChildcareDirectory(
  html,
  { url, publisherLabel, checkedAt = new Date().toISOString() } = {},
) {
  const records = [];
  for (const match of html.matchAll(
    /<h4\b[^>]*>((?:(?!<\/?h[1-6]\b|<p\b)[\s\S]){1,600})<\/h4>\s*<p\b[^>]*>((?:(?!<\/?p\b|<h[1-6]\b)[\s\S]){1,4000})<\/p>/gi,
  )) {
    const name = plainHtml(match[1]).replace(/^(?:&gt;|>)\s*/, ""),
      body = match[2];
    const lines = body
      .split(/<br\s*\/?>/i)
      .map(plainHtml)
      .filter(Boolean);
    const end = lines.findIndex((line) => /\b\d{5}\s+\D/.test(line));
    if (end < 0 || !name) continue;
    const postal = lines[end].match(/\b(\d{5})\s+(.+)/);
    const adresse = lines.slice(0, end + 1).join(" "),
      commune = postal[2].trim();
    const phones = [
      ...new Set(
        [...plainHtml(body).matchAll(/\b0[1-9](?:[ .-]?\d{2}){4}\b/g)].map(
          (m) => m[0],
        ),
      ),
    ];
    const emails = [
      ...new Set(
        [...body.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => m[1]),
      ),
    ];
    const record = {
      id:
        "childcare:" +
        createHash("sha256")
          .update(url + "#" + name + "#" + adresse)
          .digest("hex")
          .slice(0, 20),
      url,
      name,
      adresse,
      commune,
      postcode: postal[1],
      publisherKind: "public-authority",
      publisherLabel,
      checkedAt,
      sourceSha256: createHash("sha256").update(html).digest("hex"),
      contacts: { phones, emails, websites: [] },
      native: {
        fields: {
          name: { value: name, excerpts: [match[1]] },
          adresse: {
            value: adresse,
            excerpts: [lines.slice(0, end + 1).join(" ")],
          },
        },
        siteHtml: match[0],
      },
    };
    if (!validateNamedSite(record))
      throw Error("Unsupported childcare record: " + name);
    records.push(record);
  }
  return [
    ...new Map(records.map((r) => [r.name + "|" + r.adresse, r])).values(),
  ];
}
if (process.argv[1]?.endsWith("generate-childcare-directory.mjs")) {
  const url = "https://petiteenfance.challansgois.fr/trouver-un-accueil/";
  const html = process.argv[2]
    ? await readFile(process.argv[2], "utf8")
    : await (await fetch(url, { signal: AbortSignal.timeout(30000) })).text();
  const records = parseChildcareDirectory(html, {
    url,
    publisherLabel: "Challans Gois Communauté — Petite enfance",
  });
  if (records.length < 5) throw Error("Incomplete childcare directory");
  const file = new URL(
    "../widgets/structure-picker/identity-links/site-directory/records.json",
    import.meta.url,
  );
  const current = JSON.parse(await readFile(file, "utf8"));
  const combined = [
    ...current.records.filter((r) => r.url !== url),
    ...records,
  ];
  await writeFile(
    file,
    JSON.stringify(
      { ...current, recordCount: combined.length, records: combined },
      null,
      2,
    ) + "\n",
  );
  console.log(records.length);
}
