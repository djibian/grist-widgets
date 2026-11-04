import { readNamedSites, validateNamedSite } from "./named-site-directory.js";
import { siteContextEvidence, addressEvidence } from "./identity-resolution.js";
import { fetchOfficialRequest } from "./enterprise-client.js";
import { findOfficialRegistrySites } from "./official-site-registry.js";
import { buildOfficialIdentifierSearchRequest } from "./search.js";
import { boundedSource } from "./bounded-source.js";
// A municipal contact is a discovery hint only. The current address must be the
// active municipality establishment, and the school must have its own active
// SIRET, the same legal SIREN, and a matching open UAI at its physical address.
export async function resolveAdministrativeSite({
  row,
  signal,
  readSites = readNamedSites,
  findRegistrySites = findOfficialRegistrySites,
  fetchOfficial = fetchOfficialRequest,
} = {}) {
  if (!/école|ecole|scolaire/i.test(row?.NomCommercial ?? "")) return null;
  return boundedSource(
    "administrative-site",
    async (child) => {
      const records = (await readSites({ signal: child })).filter(
        (r) =>
          validateNamedSite(r) &&
          r.publisherKind === "public-authority" &&
          siteContextEvidence(row, r).name &&
          addressEvidence(row.Adresse, r.adresse).conflict,
      );
      const proven = [];
      for (const record of records.slice(0, 3)) {
        const physicalRow = { ...row, Adresse: record.adresse };
        const found = await findRegistrySites({
          row: physicalRow,
          signal: child,
        });
        for (const school of found.records ?? []) {
          if (school.kind !== "education" || !school.siret) continue;
          const schoolResult = await fetchOfficial(
            buildOfficialIdentifierSearchRequest(school.siret),
            { signal: child, cacheTtlMs: 0 },
          );
          const c = schoolResult.items.find(
            (c) =>
              c.siret === school.siret &&
              c.etatAdministratif === "A" &&
              c.uaiIds?.includes(school.recordId),
          );
          if (
            !c ||
            !/^COMMUNE\b/.test(c.raisonSociale) ||
            !addressEvidence(c.adresse, record.adresse).compatible
          )
            continue;
          const parentResult = await fetchOfficial(
            {
              ...buildOfficialIdentifierSearchRequest(c.siret.slice(0, 9)),
              allowSiegeFallback: true,
            },
            { signal: child, cacheTtlMs: 0, allowSiegeFallback: true },
          );
          const parents = parentResult.items.filter(
            (p) =>
              p.siret !== c.siret &&
              p.siret.slice(0, 9) === c.siret.slice(0, 9) &&
              p.etatAdministratif === "A" &&
              p.codeCommune === c.codeCommune &&
              p.raisonSociale === c.raisonSociale &&
              /\bMAIRIE\b/i.test(p.nomCommercial),
          );
          for (const parent of parents) {
            const a = addressEvidence(row.Adresse, parent.adresse);
            if (
              !a.compatible ||
              a.number !== "same" ||
              a.streetSimilarity !== 1
            )
              continue;
            proven.push({
              row: physicalRow,
              proof: {
                kind: "VERIFIED_ADMINISTRATIVE_INPUT",
                currentAddress: row.Adresse,
                physicalAddress: record.adresse,
                school,
                municipality: parent,
                schoolBinding: c,
                record,
              },
            });
          }
        }
      }
      return proven.length === 1 ? proven[0] : null;
    },
    { signal, timeoutMs: 3000 },
  ).catch((error) => {
    if (signal?.aborted) throw error;
    return null;
  });
}
