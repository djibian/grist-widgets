import test from "node:test";
import assert from "node:assert/strict";
import { scoreHeldout, parseJsonl } from "../validation/score-heldout.mjs";

// Synthetic cases ONLY test the scoring implementation. They are not the
// independent 50+ real structures needed for the product validation verdict.
function fixture() {
  const manifest = [], baseline = [], proposed = [];
  for (let i = 1; i <= 50; i += 1) {
    const id = "H" + String(i).padStart(3, "0");
    const siret = "123456789" + String(i).padStart(5, "0");
    manifest.push({
      id, sector: "sector-" + (i % 10),
      truth: { siteSiretStatus: "verified", siteSiret: siret,
        location: { quality: "site_confirmed", lat: 47, lon: -1 } },
      sources: [{ url: "https://example.org/public-register/" + i, supports: ["siteSiret"] }],
    });
    baseline.push({
      id, captureSetSha256: "a".repeat(64), candidates: [{ siret: "99999999900000" }],
      decision: { status: "INCOMPLETE" }, firstHintMs: 120, verificationMs: null,
      requests: [1, 2, 3], sourceEvents: [{ state: "timeout" }], userActions: 3,
    });
    proposed.push({
      id, captureSetSha256: "a".repeat(64), candidates: [{ siret }],
      decision: { status: "MATCH_VERIFIED", candidate: { siret,
        position: { status: "SITE_CONFIRMED", latitude: 47, longitude: -1 } } },
      firstHintMs: 30, verificationMs: 80, requests: [1], sourceEvents: [], userActions: 1,
    });
  }
  return { manifest, baseline, proposed };
}

test("scorer compares top-five recall, dangerous identifiers, positions, percentiles and API load", () => {
  const data = fixture();
  const report = scoreHeldout(data);
  assert.equal(report.caseCount, 50);
  assert.equal(report.sectorCount, 10);
  assert.equal(report.baseline.recallAt5, 0);
  assert.equal(report.proposed.recallAt5, 1);
  assert.equal(report.proposed.knownCorrectAttributions, 50);
  assert.equal(report.proposed.knownWrongAttributions, 0);
  assert.equal(report.proposed.sitePositionWithinTolerance, 50);
  assert.equal(report.proposed.firstHintMs.p95, 30);
  assert.equal(report.baseline.totalRequests, 150);
  assert.equal(report.proposed.totalRequests, 50);
  assert.equal(report.baseline.sourceFailures, 50);
  assert.equal(report.proposed.userActions.p99, 1);
});

test("unknown truth, false attribution and non-measured metrics are never silently declared correct", () => {
  const data = fixture();
  data.manifest[0].truth.siteSiretStatus = "unknown";
  data.manifest[0].truth.siteSiret = null;
  data.proposed[0].decision.candidate.siret = "99999999900000";
  data.proposed[0].firstHintMs = null;
  data.proposed[0].requests = undefined;
  data.manifest[1].truth.siteSiretStatus = "none_proven";
  data.manifest[1].truth.siteSiret = null;
  data.proposed[1].decision.candidate.siret = "99999999900000";
  data.proposed[2].decision.candidate.siret = "99999999900000";
  const report = scoreHeldout(data);
  assert.equal(report.proposed.knownIdentityCases, 48);
  assert.equal(report.proposed.unknownAttributionsNotScorable, 1);
  assert.equal(report.proposed.noneProvenWrongAttributions, 1);
  assert.equal(report.proposed.knownWrongAttributions, 1);
  assert.equal(report.proposed.firstHintMs.observed, 49);
  assert.equal(report.proposed.measuredRequestCases, 49);
});

test("unfrozen or incomparable observations are rejected, not imputed", () => {
  const data = fixture();
  assert.throws(() => scoreHeldout({ ...data, manifest: data.manifest.slice(0, 49) }), /fewer than 50/);
  assert.throws(() => scoreHeldout({ ...data, baseline: data.baseline.slice(0, 49) }), /EXACTLY/);
  data.proposed[0].captureSetSha256 = "b".repeat(64);
  assert.throws(() => scoreHeldout(data), /non-identical/);
  assert.throws(() => parseJsonl('{"id":"H001"}\ninvalid'), /line 2/);
});
