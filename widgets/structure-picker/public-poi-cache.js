import { parseSiteAddress } from "./identity-resolution.js";
export async function findCachedPublicPois({
  candidate,
  signal,
  fetchImpl = fetch,
} = {}) {
  const address = parseSiteAddress(candidate?.adresse),
    postcode = candidate?.codePostal || address.codePostal;
  if (!/^\d{5}$/.test(postcode ?? ""))
    return { observations: [], coverage: [] };
  const observations = [],
    coverage = [];
  await Promise.all(
    [...new Set([address.number[0] || "none", "none"])].map(async (bucket) => {
      const url = new URL(
        `./site-position-indexes/public-pois/${postcode}/${bucket}.json`,
        import.meta.url,
      );
      try {
        const r = await fetchImpl(url, { signal });
        if (r.status === 404) return;
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (new TextEncoder().encode(text).length > 256 * 1024)
          throw Error("POI cache exceeds budget");
        const p = JSON.parse(text);
        if (
          p.schemaVersion !== 1 ||
          p.postcode !== postcode ||
          p.bucket !== bucket ||
          p.recordCount !== p.records?.length ||
          !p.source?.generatedAt ||
          !p.source?.sha256
        )
          throw Error("Invalid POI cache");
        if (signal?.aborted) return;
        observations.push(
          ...p.records
            .map((o) => ({
              ...o,
              source: { ...o.source, upstream: p.source.upstream },
            }))
            .filter(
              (o) =>
                o.kind === "site" &&
                o.source?.id === "overture" &&
                o.source.recordId &&
                o.source.generatedAt === p.source.generatedAt,
            ),
        );
        coverage.push({
          source: "public-poi-cache",
          status: "ok",
          generatedAt: p.source.generatedAt,
        });
      } catch (error) {
        if (!signal?.aborted)
          coverage.push({
            source: "public-poi-cache",
            status: "error",
            message: error.message,
          });
      }
    }),
  );
  return { observations, coverage };
}
