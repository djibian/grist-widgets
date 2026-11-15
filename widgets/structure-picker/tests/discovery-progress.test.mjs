import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DISCOVERY_HINTS, emptyDiscoveryProgress, mergeDiscoveryProgress,
  recordDiscoverySourceEvent, discoveryHints, discoveryHintKey, discoveryRelevance, discoverySourceLabel,
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
  assert.equal(discoveryHints(progress, 50).length, 50, "teachers can reveal more than the original first 20");
  assert.equal(discoveryHints(progress, 250).length, 51);
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
  assert.equal(discoveryHints(progress, 300).length, MAX_DISCOVERY_HINTS);
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


test("each discovery hint retains a stable key and raw candidate for reversible guidance", () => {
  const candidate = hint(71, { siret: "123 456 789 00012" });
  const progress = mergeDiscoveryProgress(emptyDiscoveryProgress(), { candidates: [candidate, hint(72)] });
  const leads = discoveryHints(progress, 5);
  assert.equal(leads[0].key, "siret:12345678900012");
  assert.equal(leads[0].siret, "12345678900012");
  assert.equal(leads[0].candidate.nomCommercial, candidate.nomCommercial);
  assert.equal(discoveryHints(progress, 5, { excluded: [leads[0].key] })[0].key, leads[1].key);
  assert.equal(progress.candidates.length, 2);
});


test("late unseen site ranks in the top five without changing the evidence store or confirming identity", () => {
  const reference = { NomCommercial: "Le Jardin des Lierres", Adresse: "14 rue des Océans 44000 Nantes", SirenSiret: "" };
  const noise = Array.from({ length: 18 }, (_, i) => ({
    nomCommercial: "Commerce distinct " + i,
    adresse: (i + 20) + " chemin des Sorbiers 85000 La Roche-sur-Yon",
    siret: String(10000000000000 + i),
  }));
  const match = { nomCommercial: "Le Jardin des Lierres",
    adresse: "14 rue des Océans 44000 Nantes", siret: "11223344500026" };
  const progress = mergeDiscoveryProgress(emptyDiscoveryProgress(), { candidates: [...noise, match] });
  assert.equal(progress.candidates[18], match, "arrival and evidence order must remain unchanged");
  const top = discoveryHints(progress, 5, { reference });
  assert.equal(top[0].candidate, match, "a late relevant clue must not stay hidden behind early results");
  assert.equal(top[0].siret, match.siret);
  assert.equal("verifiedOfficial" in top[0], false, "ranking is not legal proof");
  assert.equal(progress.candidates[0], noise[0]);
  assert.equal(discoveryHints(progress, 5)[0].candidate, noise[0], "legacy order stays available without context");
});

test("site address and postal code disambiguate homonyms without promoting a SIRET hint to proof", () => {
  const reference = { NomCommercial: "Maison du Chêne", Adresse: "3 rue des Dunes 44000 Nantes",
    SirenSiret: "12345678900010" };
  const wrongSite = { nomCommercial: "Maison du Chêne", siret: "12345678900010",
    adresse: "3 rue des Dunes 75000 Paris" };
  const localSite = { nomCommercial: "Maison du Chêne", siret: "98765432100019",
    adresse: "3 rue des Dunes 44000 Nantes" };
  const progress = mergeDiscoveryProgress(emptyDiscoveryProgress(), { candidates: [wrongSite, localSite] });
  const leads = discoveryHints(progress, 5, { reference });
  assert.equal(leads[0].candidate, localSite, "the entered identifier must not outweigh contrary location evidence");
  assert.ok(discoveryRelevance(localSite, reference) > discoveryRelevance(wrongSite, reference));
  assert.equal(leads.length, 2, "homonyms remain visible for review");
  assert.deepEqual(progress.candidates, [wrongSite, localSite], "no candidate may be discarded or rewritten");
});

test("corrected human search hints change rank without changing the source row or assuming official confirmation", () => {
  const reference = Object.freeze({ NomCommercial: "Atelier des Roses", Adresse: "10 rue du Port 44000 Nantes" });
  const original = { nomCommercial: "Atelier des Roses", adresse: "10 rue du Port 44000 Nantes", siret: "11111111100012" };
  const corrected = { nomCommercial: "Ferme du Verger", adresse: "7 route des Vergers 49000 Angers", siret: "22222222200028" };
  const progress = mergeDiscoveryProgress(emptyDiscoveryProgress(), { candidates: [original, corrected] });
  assert.equal(discoveryHints(progress, 1, { reference })[0].candidate, original);
  const guidance = { selected: [
    { field: "name", key: "corrected", value: "Ferme du Verger", corrected: true },
    { field: "address", key: "corrected", value: "7 route des Vergers 49000 Angers", corrected: true },
  ], rejected: [], version: 2 };
  assert.equal(discoveryHints(progress, 1, { reference, guidance })[0].candidate, corrected);
  assert.equal(reference.Adresse, "10 rue du Port 44000 Nantes");
  assert.equal(corrected.verifiedOfficial, undefined);
  assert.equal(discoveryHints(progress, 5, { reference, guidance, excluded: [discoveryHintKey(corrected)] }).length, 1);
});


test("late relevant site survives a full 250-hint bounded reservoir", () => {
  const reference = { NomCommercial: "Pépinière des Ombelles", Adresse: "8 rue des Myosotis 44000 Nantes" };
  const early = Array.from({ length: MAX_DISCOVERY_HINTS }, (_, i) => hint(i + 1));
  let progress = mergeDiscoveryProgress(emptyDiscoveryProgress(), { candidates: early }, { reference });
  const late = { nomCommercial: "Pépinière des Ombelles", adresse: "8 rue des Myosotis 44000 Nantes",
    siret: "31313131300022" };
  progress = mergeDiscoveryProgress(progress, { candidates: [late] }, { reference });
  assert.equal(progress.candidates.length, MAX_DISCOVERY_HINTS);
  assert.equal(progress.totalHintsSeen, MAX_DISCOVERY_HINTS + 1);
  assert.equal(discoveryHints(progress, 5, { reference })[0].candidate, late);
  assert.ok(progress.candidates.includes(late), "late matching evidence must not be discarded merely by arrival");
  assert.equal(discoveryHints(progress, 250).length, MAX_DISCOVERY_HINTS);
});
