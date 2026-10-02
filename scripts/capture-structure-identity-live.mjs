import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildGeocodeUrl, geocodeResultsFromPayload } from "../widgets/structure-picker/geocode.js";
import { fetchOfficialRequest } from "../widgets/structure-picker/enterprise-client.js";
import { resolveEstablishmentForEnrichment } from "../widgets/structure-picker/establishment-service.js";
import { findIndexedSitePositions, findOsmSiretPositions, warmSitePositionManifest } from "../widgets/structure-picker/site-position-sources.js";
import { matchPublishedIdentityLinks } from "../widgets/structure-picker/published-identity-links.js";
import { buildOfficialIdentifierSearchRequest } from "../widgets/structure-picker/search.js";
import { findFinessIdentityLinks } from "../widgets/structure-picker/finess-identity.js";

const manifestUrl = process.env.CONTACT_INDEX_MANIFEST_URL || "https://djibian.github.io/grist-widgets/widgets/structure-picker/contact-indexes/indexed-departments.json";

const publishedPayload = JSON.parse(await readFile(
  new URL("../widgets/structure-picker/identity-links/published.json", import.meta.url),
  "utf8",
));

const cases = [
  {
    id: "super-u-machecoul",
    expectedSiret: "41091808000020",
    row: {
      NomCommercial: "Super U Machecoul",
      Adresse: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME",
      SirenSiret: "",
      RaisonSociale: "",
      Latitude: "",
      Longitude: "",
    },
  },
  {
    id: "ehpad-la-reynerie",
    expectedSiret: "26850025300011",
    row: {
      NomCommercial: "EHPAD La Reynerie Bouin 85230",
      Adresse: "8bis Rue du Pays de Retz 85230 Bouin",
      SirenSiret: "",
      RaisonSociale: "",
      Latitude: "",
      Longitude: "",
    },
  },
  {
    id: "o-pre-d-vous",
    expectedSiret: "89306104400028",
    row: {
      NomCommercial: "ô Pré d’Vous",
      Adresse: "24 rue des fosses 44270 La Marne",
      SirenSiret: "",
      RaisonSociale: "",
      Latitude: "",
      Longitude: "",
    },
  },
  {
    id: "pom-de-rainette",
    expectedSiret: "88493583400033",
    row: {
      NomCommercial: "CRECHE POM'DE RAINETTE",
      Adresse: "10 BIS RUE DES MARGOTINS 85300 SALLERTAINE",
      SirenSiret: "",
      RaisonSociale: "",
      Latitude: "",
      Longitude: "",
    },
  },
];

const capture = {
  capturedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || "local",
  note: "Capture réseau du service d’identité utilisé par le widget. Les expectedSiret sont des annotations du corpus et ne sont jamais injectés dans les requêtes de résolution.",
  publishedIdentityGeneratedAt: publishedPayload.generatedAt || null,
  cases: [],
};

async function recordingFetch(url, options = {}, network = []) {
  const startedAt = new Date().toISOString();
  const response = await fetch(url, options);
  const clone = response.clone();
  let body = null;
  const contentType = clone.headers.get("content-type") || "";
  try {
    body = contentType.includes("json") ? await clone.json() : await clone.text();
  } catch (error) {
    body = { captureError: error?.message || String(error) };
  }
  network.push({
    startedAt,
    method: options.method || "GET",
    url: String(url),
    status: response.status,
    contentType,
    body,
  });
  return response;
}

async function liveGeocode(address, options, network) {
  const url = buildGeocodeUrl(address, { limit: options?.limit ?? 3 });
  const response = await recordingFetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options?.signal,
  }, network);
  if (!response.ok) throw new Error(`Géocodage indisponible (HTTP ${response.status}).`);
  const payload = await response.json();
  return geocodeResultsFromPayload(payload, options?.limit ?? 3);
}

async function officialProbe(request, network) {
  if (!request) return null;
  try {
    const result = await fetchOfficialRequest(request, {
      cacheTtlMs: 0,
      fetchImpl: (url, fetchOptions) => recordingFetch(url, fetchOptions, network),
    });
    return {
      request: { kind: request.kind, url: request.url },
      sirets: (result.items || []).map(item => item.siret),
      coverage: result.coverage,
    };
  } catch (error) {
    return { request: { kind: request.kind, url: request.url }, error: error?.message || String(error) };
  }
}

function publishedLinksFor(row) {
  return {
    source: "published-identity",
    complete: true,
    generatedAt: publishedPayload.generatedAt || "",
    candidates: matchPublishedIdentityLinks(publishedPayload.records, row),
  };
}

// Like the browser controller, warm the shared manifest before analysis.
const manifestNetwork = [];
try {
  await warmSitePositionManifest({ manifestUrl, fetchImpl: (url, options) => recordingFetch(url, options, manifestNetwork) });
} catch (error) {
  capture.manifestError = error.message;
}
capture.manifestNetwork = manifestNetwork;

for (const scenario of cases) {
  const network = [];
  let result = null;
  let error = null;
  const controller = new AbortController();
  try {
    result = await resolveEstablishmentForEnrichment({
      row: scenario.row,
      signal: controller.signal,
      geocode: (address, options) => liveGeocode(address, options, network),
      fetchOfficial: (request, options) => fetchOfficialRequest(request, {
        ...options,
        cacheTtlMs: 0,
        fetchImpl: (url, fetchOptions) => recordingFetch(url, fetchOptions, network),
      }),
      findPublishedLinks: async ({ row }) => publishedLinksFor(row),
      findSectorLinks: options => findFinessIdentityLinks({ ...options, fetchImpl: async (url, fetchOptions) => {
        // Like published.json above, the new static asset is local until this PR
        // is published. Its upstream FINESS snapshot URL is retained in each proof.
        if (url.protocol === "file:") return Response.json(JSON.parse(await readFile(url, "utf8")));
        return recordingFetch(url, fetchOptions, network);
      } }),
      findIndexedPositions: options => findIndexedSitePositions({ ...options, manifestUrl, fetchImpl: async (url, fetchOptions) => {
        if (url.protocol === "file:") return Response.json(JSON.parse(await readFile(url, "utf8")));
        return recordingFetch(url, fetchOptions, network);
      } }),
      findOsmPositions: options => findOsmSiretPositions({ ...options, fetchImpl: (url, fetchOptions) => recordingFetch(url, fetchOptions, network) }),
    });
  } catch (caught) {
    error = { name: caught?.name || "Error", message: caught?.message || String(caught) };
  }

  const exactProbe = await officialProbe(buildOfficialIdentifierSearchRequest(scenario.expectedSiret), network);
  capture.cases.push({
    id: scenario.id,
    expectedSiret: scenario.expectedSiret,
    row: scenario.row,
    decision: result?.decision ? {
      status: result.decision.status,
      reason: result.decision.reason,
      selectedSiret: result.decision.candidate?.siret || null,
      alternatives: (result.decision.alternatives || []).map(item => item.siret),
      certificates: (result.decision.certificates || []).map(item => ({
        siret: item.siret,
        level: item.level,
        admissible: item.admissible,
        conflict: item.conflict,
        explanations: item.explanations,
      })),
    } : null,
    requests: network.map(request => ({ url: request.url, method: request.method, status: request.status })),
    diagnostics: result?.diagnostics || [],
    links: (result?.candidate?.identityLinks || []).map(link => ({
      source: link.source,
      sourceLabel: link.sourceLabel,
      sourceRecordId: link.sourceRecordId,
      sourcePublishedAt: link.sourcePublishedAt || null,
      publicNames: link.publicNames,
      siret: link.siret,
      adresse: link.adresse,
      verifiedOfficial: link.verifiedOfficial,
    })),
    candidate: result?.candidate || null,
    position: result?.candidate?.position || null,
    exactProbe,
    error,
    network,
  });
}

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/structure-picker-identity-live.json", `${JSON.stringify(capture, null, 2)}\n`);

for (const scenario of capture.cases) {
  console.log(`${scenario.id}: ${scenario.decision?.status || "ERROR"} -> ${scenario.decision?.selectedSiret || "—"} (expected ${scenario.expectedSiret})`);
  if (scenario.links.length) {
    console.log(`  links: ${scenario.links.map(link => `${link.sourceLabel}:${link.siret}:${link.verifiedOfficial ? "verified" : "unverified"}`).join(" | ")}`);
  }
  if (scenario.position) console.log(`  position: ${scenario.position.status} ${scenario.position.latitude ?? "—"}, ${scenario.position.longitude ?? "—"} (${scenario.position.source?.label || "abstention"})`);
  if (scenario.error) console.log(`  error: ${scenario.error.message}`);
  if (scenario.diagnostics?.length) console.log(`  diagnostics: ${scenario.diagnostics.join(" | ")}`);
  if (scenario.exactProbe) console.log(`  exact-probe: ${scenario.exactProbe.error || scenario.exactProbe.sirets?.join(",") || "no candidate"}`);
}
