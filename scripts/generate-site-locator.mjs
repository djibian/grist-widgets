import { readFile, readdir, writeFile } from "node:fs/promises";
import { addressEvidence } from "../widgets/structure-picker/identity-resolution.js";
import { normalizeRegistryRecords } from "../widgets/structure-picker/official-site-registry.js";
export async function buildLocator(root, education = []) {
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", root), "utf8"),
  );
  const schools = new Map(
    education.map((r) => [r.identifiant_de_l_etablissement, r]),
  );
  const records = [];
  for (const file of (await readdir(root))
    .filter((f) => /^\d{5}\.\d+\.json$/.test(f))
    .sort()) {
    const payload = JSON.parse(await readFile(new URL(file, root), "utf8"));
    for (const entry of payload.records)
      for (const r of normalizeRegistryRecords(entry, manifest.source)) {
        const fresh = schools.get(r.recordId);
        const address =
          fresh &&
          addressEvidence(
            r.adresse,
            [
              fresh.adresse_1,
              fresh.adresse_2,
              fresh.code_postal,
              fresh.nom_commune,
            ]
              .filter(Boolean)
              .join(" "),
          );
        const compatible =
          fresh &&
          fresh.etat === "OUVERT" &&
          String(fresh.siren_siret ?? "") === r.siret &&
          address.compatible &&
          address.postal === "same" &&
          address.commune === "same";
        const n = fresh ? (compatible ? fresh : {}) : entry.native;
        records.push({
          file,
          kind: r.kind,
          recordId: r.recordId,
          name: r.name,
          publicNames: r.publicNames,
          adresse: r.adresse,
          commune: r.commune,
          categoryCode: r.categoryCode,
          siteType: r.siteType,
          contacts: {
            phones: [n.telephone].filter(Boolean),
            emails: [n.mail].filter(Boolean),
            websites: [n.web].filter(Boolean),
          },
          contactEvidence:
            n.telephone || n.mail || n.web
              ? {
                  recordId: r.recordId,
                  siret: n.siren_siret,
                  adresse: n.adresse_1,
                  updatedAt: n.date_maj_ligne,
                  url: manifest.source.education.url,
                }
              : null,
        });
      }
  }
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: manifest.source,
    recordCount: records.length,
    records,
  };
  await writeFile(
    new URL("locator.json", root),
    JSON.stringify(payload) + "\n",
  );
  return records.length;
}
if (process.argv[1]?.endsWith("generate-site-locator.mjs")) {
  const education = process.argv[2]
    ? JSON.parse(await readFile(process.argv[2], "utf8"))
    : [];
  console.log(
    await buildLocator(
      new URL(
        "../widgets/structure-picker/identity-links/site-registry/",
        import.meta.url,
      ),
      education,
    ),
  );
}
