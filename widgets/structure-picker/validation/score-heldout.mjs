// Offline held-out scoring. Does not collect, modify or tune the validation set.
// Both runs MUST use the same recorded public API responses (captureSetSha256).
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function digits(value) { return String(value ?? "").replace(/[^0-9]/g, ""); }
function siret(value) {
  const normalized = digits(value);
  return normalized.length === 14 ? normalized : null;
}
function numeric(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function percentile(numbers, fraction) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}
function distribution(values) {
  const valid = values.filter(numeric);
  return { observed: valid.length, p50: percentile(valid, .50),
    p95: percentile(valid, .95), p99: percentile(valid, .99) };
}
function distanceMeters(a, b) {
  const lat1 = Number(a?.lat), lon1 = Number(a?.lon);
  const lat2 = Number(b?.latitude), lon2 = Number(b?.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite) ||
    Math.abs(lat1) > 90 || Math.abs(lat2) > 90 || Math.abs(lon1) > 180 || Math.abs(lon2) > 180)
    return null;
  const radians = n => n * Math.PI / 180;
  const dLat = radians(lat2 - lat1), dLon = radians(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) *
    Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function indexById(rows, title) {
  const map = new Map();
  for (const row of rows ?? []) {
    if (!/^H\d{3,}$/.test(row?.id ?? "") || map.has(row.id))
      throw Error(title + ": missing, malformed or duplicate case id");
    map.set(row.id, row);
  }
  return map;
}
export function scoreHeldout({ manifest, baseline, proposed, minCases = 50, minSectors = 10, maxSiteDistanceMeters = 100 }) {
  const reference = indexById(manifest, "manifest");
  if (reference.size < minCases) throw Error("Held-out corpus contains fewer than " + minCases + " distinct cases");
  const sectors = new Set([...reference.values()].map(c => c.sector));
  if (sectors.has(undefined) || sectors.size < minSectors)
    throw Error("Held-out corpus does not cover " + minSectors + " sectors");
  const old = indexById(baseline, "baseline");
  const next = indexById(proposed, "proposed");
  for (const [name, observations] of [["baseline", old], ["proposed", next]]) {
    if (observations.size !== reference.size || [...reference.keys()].some(id => !observations.has(id)))
      throw Error(name + ": observations must cover EXACTLY the frozen manifest IDs");
  }
  for (const [id, row] of reference) {
    const truth = row.truth ?? {};
    if (!["verified", "unknown", "none_proven"].includes(truth.siteSiretStatus))
      throw Error(id + ": explicit siteSiretStatus is mandatory");
    if (truth.siteSiretStatus === "verified" && (!siret(truth.siteSiret) || !row.sources?.length))
      throw Error(id + ": verified site SIRET requires a valid identifier and public sources");
    if (truth.siteSiretStatus !== "verified" && truth.siteSiret !== null)
      throw Error(id + ": unverified site SIRET must remain null");
    const first = old.get(id).captureSetSha256, second = next.get(id).captureSetSha256;
    if (!/^[a-f0-9]{64}$/.test(first ?? "") || first !== second)
      throw Error(id + ": missing or non-identical public API capture hashes");
  }
  function measure(observations) {
    const totals = {
      knownIdentityCases: 0, hitsAt5: 0, verifiedOrProbableAttributions: 0,
      knownCorrectAttributions: 0, knownWrongAttributions: 0,
      noneProvenWrongAttributions: 0, unknownAttributionsNotScorable: 0,
      abstentions: 0, knownSitePositionCases: 0, scorableSitePositions: 0,
      sitePositionWithinTolerance: 0, sitePositionOutOfTolerance: 0,
      totalRequests: 0, measuredRequestCases: 0, sourceFailures: 0, measuredFailureCases: 0,
    };
    const firstHints = [], identityTimes = [], requests = [], userActions = [];
    for (const [id, truthCase] of reference) {
      const observation = observations.get(id);
      const truth = truthCase.truth;
      const known = truth.siteSiretStatus === "verified";
      const expected = siret(truth.siteSiret);
      const discovered = (observation.candidates ?? []).slice(0, 5).some(item =>
        siret(item?.siret) && siret(item.siret) === expected);
      if (known) {
        totals.knownIdentityCases += 1;
        if (discovered) totals.hitsAt5 += 1;
      }
      const decision = observation.decision ?? {};
      const pred = decision.candidate ?? null;
      const selectedId = pred?.identityScope === "PUBLIC_SITE" ? null : siret(pred?.siret);
      const assertsIdentity = ["MATCH_VERIFIED", "MATCH_PROBABLE"].includes(decision.status);
      if (!assertsIdentity || !pred) totals.abstentions += 1;
      if (assertsIdentity && selectedId) {
        totals.verifiedOrProbableAttributions += 1;
        if (known) {
          if (selectedId === expected) totals.knownCorrectAttributions += 1;
          else totals.knownWrongAttributions += 1;
        } else if (truth.siteSiretStatus === "none_proven") totals.noneProvenWrongAttributions += 1;
        else totals.unknownAttributionsNotScorable += 1;
      }
      const truthPoint = truth.location ?? {};
      if (truthPoint.quality === "site_confirmed") {
        totals.knownSitePositionCases += 1;
        const position = pred?.position ?? {};
        if (["SITE_CONFIRMED", "SITE_CORROBORATED"].includes(position.status)) {
          const d = distanceMeters(truthPoint, position);
          if (d !== null) {
            totals.scorableSitePositions += 1;
            if (d <= maxSiteDistanceMeters) totals.sitePositionWithinTolerance += 1;
            else totals.sitePositionOutOfTolerance += 1;
          }
        }
      }
      firstHints.push(observation.firstHintMs);
      identityTimes.push(observation.verificationMs);
      if (Array.isArray(observation.requests)) {
        totals.measuredRequestCases += 1;
        totals.totalRequests += observation.requests.length;
        requests.push(observation.requests.length);
      }
      if (Array.isArray(observation.sourceEvents)) {
        totals.measuredFailureCases += 1;
        totals.sourceFailures += observation.sourceEvents.filter(e => ["error", "timeout"].includes(e?.state)).length;
      }
      userActions.push(observation.userActions);
    }
    const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
    return {
      ...totals,
      recallAt5: ratio(totals.hitsAt5, totals.knownIdentityCases),
      knownWrongAttributionRate: ratio(totals.knownWrongAttributions, totals.knownIdentityCases),
      scorablePositionPrecision: ratio(totals.sitePositionWithinTolerance, totals.scorableSitePositions),
      firstHintMs: distribution(firstHints), verificationMs: distribution(identityTimes),
      requestsPerCase: distribution(requests), userActions: distribution(userActions),
    };
  }
  return {
    caseCount: reference.size, sectorCount: sectors.size,
    baseline: measure(old), proposed: measure(next),
    caveat: "Unknown truth and missing telemetry are excluded, not imputed. No scores imply causal improvement without identical capture replay.",
  };
}

export function parseJsonl(content) {
  return content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map((line, index) => {
      try { return JSON.parse(line); }
      catch { throw Error("Invalid JSONL at line " + (index + 1)); }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [manifestPath, baselinePath, proposedPath] = process.argv.slice(2);
  if (!manifestPath || !baselinePath || !proposedPath)
    throw Error("Usage: node score-heldout.mjs heldout.jsonl baseline-observations.jsonl pr-observations.jsonl");
  const texts = await Promise.all([manifestPath, baselinePath, proposedPath].map(path => readFile(path, "utf8")));
  const report = scoreHeldout({
    manifest: parseJsonl(texts[0]), baseline: parseJsonl(texts[1]), proposed: parseJsonl(texts[2]),
  });
  report.manifestSha256 = createHash("sha256").update(texts[0]).digest("hex");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
