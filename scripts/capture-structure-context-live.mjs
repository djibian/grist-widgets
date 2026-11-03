import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolveEstablishmentForEnrichment } from "../widgets/structure-picker/establishment-service.js";
import { fetchOfficialRequest } from "../widgets/structure-picker/enterprise-client.js";
import { findOfficialRegistrySites } from "../widgets/structure-picker/official-site-registry.js";
import { findOfficialPublicSites } from "../widgets/structure-picker/public-sites.js";
import { findPublishedIdentityLinks } from "../widgets/structure-picker/published-identity-links.js";
import {
  findIndexedSitePositions,
  findOsmSiretPositions,
} from "../widgets/structure-picker/site-position-sources.js";
import { findFinessIdentityLinks } from "../widgets/structure-picker/finess-identity.js";
import {
  buildGeocodeUrl,
  geocodeResultsFromPayload,
} from "../widgets/structure-picker/geocode.js";
import { establishmentConfidence } from "../widgets/structure-picker/confidence.js";
import { buildEnrichmentProposals } from "../widgets/structure-picker/enrichment.js";
const input =
  process.argv[2] ??
  new URL(
    "../widgets/structure-picker/tests/fixtures/context/input-rows.json",
    import.meta.url,
  );
const rows = JSON.parse(await readFile(input, "utf8"));
const output = process.argv[3] ?? "artifacts/structure-context-live.json";
const capture = { capturedAt: new Date().toISOString(), cases: [] };
for (const row of rows) {
  const network = [];
  async function transport(input, options = {}) {
    const u = new URL(input);
    if (u.protocol === "file:") {
      u.search = "";
      try {
        return new Response(await readFile(u, "utf8"));
      } catch {
        return new Response("", { status: 404 });
      }
    }
    const start = Date.now();
    const r = await fetch(u, options);
    const body = await r.clone().text();
    network.push({
      url: String(u),
      status: r.status,
      elapsedMs: Date.now() - start,
      body,
    });
    return r;
  }
  const started = Date.now();
  try {
    const result = await resolveEstablishmentForEnrichment({
      row,
      geocode: async (address, options) => {
        const r = await transport(buildGeocodeUrl(address), {
          signal: options.signal,
        });
        return geocodeResultsFromPayload(await r.json(), 3);
      },
      fetchOfficial: (request, options) =>
        fetchOfficialRequest(request, {
          ...options,
          cacheTtlMs: 0,
          fetchImpl: transport,
        }),
      findRegistrySites: (options) =>
        findOfficialRegistrySites({ ...options, fetchImpl: transport }),
      findPublicSites: (options) =>
        findOfficialPublicSites({ ...options, fetchImpl: transport }),
      findPublishedLinks: (options) =>
        findPublishedIdentityLinks({ ...options, fetchImpl: transport }),
      findSectorLinks: (options) =>
        findFinessIdentityLinks({ ...options, fetchImpl: transport }),
      findIndexedPositions: (options) =>
        findIndexedSitePositions({
          ...options,
          fetchImpl: transport,
          manifestUrl:
            "https://djibian.github.io/grist-widgets/widgets/structure-picker/contact-indexes/indexed-departments.json",
        }),
      findOsmPositions: (options) =>
        findOsmSiretPositions({ ...options, fetchImpl: transport }),
    });
    const item = {
      row,
      elapsedMs: Date.now() - started,
      result,
      confidence: establishmentConfidence(result.decision, result.candidate),
      proposals: buildEnrichmentProposals(row, result.candidate, {
        identityStatus: result.decision.status,
      }),
      network,
    };
    capture.cases.push(item);
    console.log(
      row.id,
      result.decision.status,
      result.candidate?.nomCommercial,
      result.candidate?.siret ?? "—",
      result.candidate?.position?.status,
      item.elapsedMs,
    );
  } catch (error) {
    capture.cases.push({ row, error: String(error), network });
    console.log(row.id, "ERROR", error.message);
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile(output, JSON.stringify(capture, null, 2) + "\n");
}
