import { mkdir, writeFile } from "node:fs/promises";
import { buildGeocodeUrl, geocodeResultsFromPayload } from "../widgets/structure-picker/geocode.js";
import { fetchOfficialRequest } from "../widgets/structure-picker/enterprise-client.js";
import { resolveStructureIdentity } from "../widgets/structure-picker/identity-orchestrator.js";
import { findOsmIdentityPois } from "../widgets/structure-picker/osm-identity.js";
import { buildOfficialIdentifierSearchRequest, buildOfficialNearbySearchRequest, buildOfficialTextSearchRequest } from "../widgets/structure-picker/search.js";

const cases = [
  {
    id: "super-u-machecoul",
    expectedSiret: "41091808000020",
    knownPoi: { latitude: 46.99808, longitude: -1.815576, source: "Overture review fixture" },
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
  note: "Capture réseau expérimentale. Les expectedSiret et knownPoi sont des annotations diagnostiques du corpus : ils ne sont jamais injectés dans le résolveur runtime.",
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
  const response = await recordingFetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: options?.signal }, network);
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
      candidates: (result.items || []).map(item => ({
        siret: item.siret,
        siren: item.siren,
        nomCommercial: item.nomCommercial,
        aliases: item.aliases,
        raisonSociale: item.raisonSociale,
        adresse: item.adresse,
        latitude: item.latitude,
        longitude: item.longitude,
      })),
      coverage: result.coverage,
    };
  } catch (error) {
    return { request: { kind: request.kind, url: request.url }, error: error?.message || String(error) };
  }
}

async function nominatimProbe(row, network) {
  try {
    const search = new URL("https://nominatim.openstreetmap.org/search");
    search.searchParams.set("format", "jsonv2");
    search.searchParams.set("q", `${row.NomCommercial} ${row.Adresse}`);
    search.searchParams.set("limit", "5");
    search.searchParams.set("addressdetails", "1");
    search.searchParams.set("extratags", "1");
    const response = await recordingFetch(search.toString(), {
      headers: { Accept: "application/json", "Accept-Language": "fr" },
    }, network);
    if (!response.ok) return { error: `Nominatim HTTP ${response.status}` };
    const results = await response.json();
    const objects = [];
    for (const result of Array.isArray(results) ? results.slice(0, 3) : []) {
      const type = result.osm_type === "node" ? "node" : result.osm_type === "way" ? "way" : result.osm_type === "relation" ? "relation" : "";
      if (!type || !result.osm_id) continue;
      const url = `https://api.openstreetmap.org/api/0.6/${type}/${result.osm_id}.json`;
      const raw = await recordingFetch(url, { headers: { Accept: "application/json" } }, network);
      const payload = raw.ok ? await raw.json() : null;
      const element = payload?.elements?.[0] ?? null;
      objects.push({
        search: {
          osmType: result.osm_type,
          osmId: result.osm_id,
          displayName: result.display_name,
          lat: result.lat,
          lon: result.lon,
          extratags: result.extratags ?? null,
        },
        status: raw.status,
        tags: element?.tags ?? null,
      });
    }
    return { count: Array.isArray(results) ? results.length : 0, objects };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

for (const scenario of cases) {
  const network = [];
  let result = null;
  let error = null;
  const controller = new AbortController();
  try {
    result = await resolveStructureIdentity({
      row: scenario.row,
      signal: controller.signal,
      geocode: (address, options) => liveGeocode(address, options, network),
      fetchOfficial: (request, options) => fetchOfficialRequest(request, {
        ...options,
        cacheTtlMs: 0,
        fetchImpl: (url, fetchOptions) => recordingFetch(url, fetchOptions, network),
      }),
      findPoiLinks: options => findOsmIdentityPois({
        ...options,
        fetchImpl: (url, fetchOptions) => recordingFetch(url, fetchOptions, network),
      }),
    });
  } catch (caught) {
    error = { name: caught?.name || "Error", message: caught?.message || String(caught) };
  }

  const diagnosticProbes = {};
  diagnosticProbes.expectedSiret = await officialProbe(buildOfficialIdentifierSearchRequest(scenario.expectedSiret), network);
  if (scenario.id === "super-u-machecoul") {
    diagnosticProbes.legalName = await officialProbe(buildOfficialTextSearchRequest("SIDONAM", { codePostal: "44270" }), network);
    diagnosticProbes.knownPoiNearby = await officialProbe(buildOfficialNearbySearchRequest({
      latitude: scenario.knownPoi.latitude,
      longitude: scenario.knownPoi.longitude,
      radius: 0.1,
    }), network);
    diagnosticProbes.nominatim = await nominatimProbe(scenario.row, network);
  }

  capture.cases.push({
    id: scenario.id,
    expectedSiret: scenario.expectedSiret,
    knownPoi: scenario.knownPoi || null,
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
    requests: result?.requests || [],
    diagnostics: result?.diagnostics || [],
    links: (result?.links || []).map(link => ({
      source: link.source,
      sourceRecordId: link.sourceRecordId,
      publicNames: link.publicNames,
      siret: link.siret,
      adresse: link.adresse,
      latitude: link.latitude,
      longitude: link.longitude,
      verifiedOfficial: link.verifiedOfficial,
    })),
    geocodeCandidates: result?.geocodeCandidates || [],
    diagnosticProbes,
    error,
    network,
  });
}

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/structure-picker-identity-live.json", JSON.stringify(capture, null, 2));

for (const scenario of capture.cases) {
  console.log(`${scenario.id}: ${scenario.decision?.status || "ERROR"} -> ${scenario.decision?.selectedSiret || "—"} (expected ${scenario.expectedSiret})`);
  if (scenario.error) console.log(`  error: ${scenario.error.message}`);
  if (scenario.diagnostics?.length) console.log(`  diagnostics: ${scenario.diagnostics.join(" | ")}`);
  const exact = scenario.diagnosticProbes?.expectedSiret;
  if (exact) console.log(`  exact-probe: ${exact.error || exact.sirets?.join(",") || "no candidate"}`);
  if (scenario.diagnosticProbes?.nominatim) console.log(`  nominatim: ${JSON.stringify(scenario.diagnosticProbes.nominatim)}`);
}
