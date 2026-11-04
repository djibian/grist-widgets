import { extractOfficialCandidates } from "./search.js";
export const OFFICIAL_SNAPSHOT_MAX_AGE_MS = 30 * 86400000;
export async function readOfficialSnapshot(
  request,
  { fetchImpl = fetch, signal, now = Date.now() } = {},
) {
  const siret = request?.requestedSiret || request?.identifier;
  if (!/^\d{9}(?:\d{5})?$/.test(siret ?? "")) return null;
  try {
    const response = await fetchImpl(
      new URL(
        `./identity-links/official-snapshots/${siret}.json`,
        import.meta.url,
      ),
      { signal, cache: "no-cache" },
    );
    if (!response.ok) return null;
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 256 * 1024) return null;
    const p = JSON.parse(text),
      age = now - Date.parse(p.checkedAt);
    if (
      p.schemaVersion !== 1 ||
      p.siret !== siret ||
      !Number.isFinite(age) ||
      age < -300000 ||
      age > OFFICIAL_SNAPSHOT_MAX_AGE_MS ||
      !/^https:\/\/recherche-entreprises.api.gouv.fr\/search\?/.test(
        p.url ?? "",
      ) ||
      !/^[a-f0-9]{64}$/.test(p.sha256 ?? "")
    )
      return null;
    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p.body)),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== p.sha256) return null;
    const result = extractOfficialCandidates(JSON.parse(p.body), {
      requestedSiret: siret.length === 14 ? siret : "",
      allowSiegeFallback: request.allowSiegeFallback === true,
    });
    if (
      !result.items.some(
        (c) => c.siret.startsWith(siret) && c.etatAdministratif === "A",
      )
    )
      return null;
    return {
      ...result,
      cached: true,
      verifiedSnapshot: true,
      checkedAt: p.checkedAt,
      sourceUrl: p.url,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
