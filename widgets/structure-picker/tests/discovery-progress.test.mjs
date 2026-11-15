import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DISCOVERY_HINTS, emptyDiscoveryProgress, mergeDiscoveryProgress,
  recordDiscoverySourceEvent, discoveryHints, discoverySourceLabel,
} from "../discovery-progress.js";

function hint(number, extra = {}) {
  return {
    nomCommercial: "Atelier inédit " + number,
    adresse: number + " rue des Inventeurs, 44000 Ville-Neuve",
    siret: String(10000000000000 + number),
    ...extra,
  };
}

test("successive checkpoints retain independently discovered candidates, without treating their SIRETs as verified", () => {
  let progress = emptyDiscoveryProgress();
  // Generated synthetic names are not the historical regression fixtures.
  const first = Array.from({ length: 50 }, (_, i) => hint(i + 1));
  progress = mergeDiscoveryProgress(progress, { candidates: first });
  progress = mergeDiscoveryProgress(progress, {
    candidates: [hint(1, { raisonSociale: "Exploitant différent" }), hint(51)],
  });
  assert.equal(progress.candidates.length, 51);
  assert.equal(progress.totalHintsSeen, 51);
  assert.equal(progress.candidates[0].raisonSociale, "Exploitant différent");
  assert.equal(discoveryHints(progress).length, 5);
  assert.equal(discoveryHints(progress)[0].siret, first[0].siret);
  assert.equal("verifiedOfficial" in progress.candidates[0], false);
  assert.equal("status" in discoveryHints(progress)[0], false);
});

test("a missing SIRET does not collapse distinct places into a single operator", () => {
  const progress = mergeDiscoveryProgress(emptyDiscoveryProgress(), {
    candidates: [
      { nomCommercial: "Centre des Peupliers", adresse: "1 rue A" },
      { nomCommercial: "Centre des Peupliers", adresse: "2 rue B" },
      { nomCommercial: "Centre des Peupliers", adresse: "1 rue A", raisonSociale: "Gestionnaire Z" },
      { nomCommercial: "", adresse: "" },
    ],
  });
  assert.equal(progress.candidates.length, 2);
  assert.equal(progress.candidates[0].raisonSociale, "Gestionnaire Z");
  assert.ok(discoveryHints(progress).every(item => !item.siret));
});

test("progress is bounded, without erasing the number of distinct hints seen", () => {
  const progress = mergeDiscoveryProgress(emptyDiscoveryProgress(), {
    candidates: Array.from({ length: 300 }, (_, i) => hint(i + 1)),
  });
  assert.equal(progress.candidates.length, MAX_DISCOVERY_HINTS);
  assert.equal(progress.totalHintsSeen, 300);
});

test("source states come only from real events and respect their terminal state", () => {
  let progress = emptyDiscoveryProgress();
  progress = recordDiscoverySourceEvent(progress, { source: "annuaire:text", state: "start", budgetMs: 6500 });
  assert.deepEqual(progress.activity.map(item => item.state), ["start"]);
  progress = recordDiscoverySourceEvent(progress, { source: "annuaire:text", state: "timeout", elapsedMs: 6500 });
  progress = recordDiscoverySourceEvent(progress, { source: "annuaire:text", state: "start" });
  assert.equal(progress.activity[0].state, "timeout");
  assert.equal(progress.activity[0].elapsedMs, 6500);
  progress = recordDiscoverySourceEvent(progress, { source: "ign", state: "ok", elapsedMs: 40 });
  progress = recordDiscoverySourceEvent(progress, { source: "", state: "start" });
  assert.equal(progress.activity.length, 2);
  assert.equal(discoverySourceLabel(progress.activity[0].state), "délai dépassé");
  assert.equal(discoverySourceLabel(progress.activity[1].state), "terminée");
});
