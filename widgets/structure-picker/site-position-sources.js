import { loadContactIndexManifest, loadContactIndexShard, resolveContactIndexShard, CONTACT_INDEX_MANIFEST_URL } from "./contact-indexes.js";
import { extractLocationFromAddress, normalizeIdentifier } from "./search.js";
import { findIndexedFinessPositions, osmSitePositionFromElement, verifiedGeographicFiness } from "./osm-site-positions.js";

const manifestCache = new Map();
const MANIFEST_CACHE_MS = 5 * 60 * 1000;

// Shared static metadata can load while the user examines the selected row.
// Candidate cancellation never makes a cached identity/position decision: only
// the manifest is shared, and all actual POI requests keep their own signal.
export function warmSitePositionManifest({ manifestUrl = CONTACT_INDEX_MANIFEST_URL, fetchImpl = globalThis.fetch } = {}) {
  const key = String(manifestUrl);
  const cached = manifestCache.get(key);
  if (cached && Date.now() - cached.at < MANIFEST_CACHE_MS) return cached.promise;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException("Manifest des lieux hors délai", "TimeoutError");
      controller.abort(error);
      reject(error);
    }, 10000);
  });
  const promise = Promise.race([loadContactIndexManifest({ url: manifestUrl, signal: controller.signal, fetchImpl }), timeout])
    .catch(error => { manifestCache.delete(key); throw error; })
    .finally(() => clearTimeout(timer));
  manifestCache.set(key, { at: Date.now(), promise });
  return promise;
}

export async function findIndexedSitePositions({ candidate, links = [], identityStatus, signal, fetchImpl = globalThis.fetch, manifestUrl = CONTACT_INDEX_MANIFEST_URL, partial = { observations: [], coverage: [] } } = {}) {
  const postcode = candidate.codePostal || extractLocationFromAddress(candidate.adresse).codePostal;
  const { observations, coverage } = partial;
  // Identifier lookup is independent of the postcode manifest. Its completed
  // evidence survives a slow optional manifest/shard and the shared deadline.
  const finessPositions = findIndexedFinessPositions({ candidate, links, identityStatus, signal, fetchImpl }).then(result => {
    if (signal?.aborted) return;
    observations.push(...result.observations);
    coverage.push(...result.coverage);
  });
  const postcodePositions = (async () => {
    let manifest;
    try { manifest = await warmSitePositionManifest({ manifestUrl, fetchImpl }); }
    catch (error) {
      if (!signal?.aborted) coverage.push({ source: "postcode-indexes", status: "error", message: error.message });
      return;
    }
    if (signal?.aborted) return;
    await Promise.all(["all-the-places", "overture"].map(async id => {
      const entry = resolveContactIndexShard(manifest, id, { postcode }, { manifestUrl });
      if (!entry) { coverage.push({ source: id, status: "not-indexed" }); return; }
      try {
        const shard = await loadContactIndexShard(entry, { signal, fetchImpl });
        if (signal?.aborted) return;
        coverage.push({ source: id, status: shard ? "ok" : "not-indexed", generatedAt: shard?.generatedAt ?? null, upstream: shard?.upstream ?? null });
        for (const record of shard?.records ?? []) {
          // Reuse the published postcode transport, not contact ranking/filtering:
          // a site position does not require a telephone or fuzzy proximity score.
          observations.push({
            kind: "site", name: record.name, siret: record.siret, adresse: record.address,
            latitude: record.latitude, longitude: record.longitude,
            source: {
              id, label: manifest.sources[id].label, recordId: record.recordId,
              url: record.sourceUri || (id === "overture" ? `https://explore.overturemaps.org/?id=${encodeURIComponent(record.recordId)}` : entry.url),
              indexUrl: entry.url, generatedAt: shard.generatedAt ?? manifest.generatedAt,
              upstream: shard.upstream, datasets: record.datasets ?? [], lineage: record.sources ?? [],
            },
          });
        }
      } catch (error) {
        if (signal?.aborted) return;
        coverage.push({ source: id, status: "error", message: error.message });
      }
    }));
  })();
  await Promise.all([finessPositions, postcodePositions]);
  return { observations, coverage };
}

export async function findOsmSiretPositions({ candidate, links = [], identityStatus, signal, fetchImpl = globalThis.fetch } = {}) {
  const siret = normalizeIdentifier(candidate?.siret);
  if (siret.length !== 14) return { observations: [], coverage: [] };
  // An exact identifier query needs no distance-based association and no
  // repeated calls to other Overpass instances when the optional source stalls.
  const finess = identityStatus === "MATCH_VERIFIED" ? verifiedGeographicFiness(candidate, links).map(link => link.sourceRecordId) : [];
  const filters = [`nwr["ref:FR:SIRET"="${siret}"];`, ...[...new Set(finess)].slice(0, 2).map(id => `nwr["ref:FR:FINESS"="${id}"];`)];
  const query = `[out:json][timeout:2];(${filters.join("")});out meta center;`;
  const response = await fetchImpl("https://overpass-api.de/api/interpreter", {
    method: "POST", body: new URLSearchParams({ data: query }).toString(),
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, signal,
  });
  if (!response.ok) throw new Error(`Position OpenStreetMap indisponible (HTTP ${response.status}).`);
  const payload = await response.json();
  if (payload.remark) throw new Error("Réponse OpenStreetMap incomplète ; positions non retenues.");
  return {
    observations: (payload.elements ?? []).map(element => osmSitePositionFromElement(element, { generatedAt: payload.osm3s?.timestamp_osm_base })).filter(Boolean),
    coverage: [{ source: "osm", status: "ok", generatedAt: payload.osm3s?.timestamp_osm_base ?? null }],
  };
}
