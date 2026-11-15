import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyDiscoveryGuidance, chooseDiscoveryGuidance, correctDiscoveryGuidance, isRejectedGuidance,
  guidanceFieldValue,
} from "../discovery-guidance.js";

const a = { nomCommercial: "La Cascade", adresse: "2 rue du Parc 44000 Nantes", commune: "Nantes", siret: "123 456 789 00012", raisonSociale: "Gestion A" };
const b = { ...a, siret: "12345678900020", nomCommercial: "La Cascade Bis" };

test("search selections are distinct from official verification and can be replaced", () => {
  const guidance = emptyDiscoveryGuidance();
  assert.equal(chooseDiscoveryGuidance(guidance, a, "name"), true);
  assert.equal(chooseDiscoveryGuidance(guidance, a, "address"), true);
  assert.equal(chooseDiscoveryGuidance(guidance, a, "siret"), true);
  assert.deepEqual(guidance.selected.map(entry => entry.field), ["name", "address", "siret"]);
  assert.equal(guidance.selected[2].value, "12345678900012");
  assert.equal("verifiedOfficial" in guidance, false);
  chooseDiscoveryGuidance(guidance, b, "name");
  assert.equal(guidance.selected.find(entry => entry.field === "name").value, "La Cascade Bis");
  chooseDiscoveryGuidance(guidance, b, "name");
  assert.equal(guidance.selected.some(entry => entry.field === "name"), false);
});

test("exclusion is reversible and never rewrites the official candidate", () => {
  const guidance = emptyDiscoveryGuidance();
  chooseDiscoveryGuidance(guidance, a, "siret");
  chooseDiscoveryGuidance(guidance, a, "", "reject");
  assert.ok(isRejectedGuidance(guidance, a));
  assert.equal(guidance.selected.length, 0);
  assert.equal(isRejectedGuidance(guidance, b), false);
  chooseDiscoveryGuidance(guidance, a, "", "reject");
  assert.equal(isRejectedGuidance(guidance, a), false);
  assert.equal(a.siret, "123 456 789 00012");
});

test("malformed or absent hints cannot generate an identifier lookup", () => {
  const guidance = emptyDiscoveryGuidance();
  assert.equal(chooseDiscoveryGuidance(guidance, { ...a, siret: "123" }, "siret"), false);
  assert.equal(chooseDiscoveryGuidance(guidance, null, "siret"), false);
  assert.equal(chooseDiscoveryGuidance(guidance, a, "__proto__"), false);
  assert.equal(guidanceFieldValue(a, "siret"), "12345678900012");
  assert.equal(guidance.version, 0);
});


test("user-entered corrected clues are separate, idempotent and never mutate official evidence", () => {
  const guidance = emptyDiscoveryGuidance();
  const original = structuredClone(a);
  assert.equal(correctDiscoveryGuidance(guidance, a, "address", " 9 quai de la Gare 49000 Angers "), true);
  assert.deepEqual(guidance.selected, [{ key: "siret:12345678900012", field: "address",
    value: "9 quai de la Gare 49000 Angers", corrected: true }]);
  assert.equal(correctDiscoveryGuidance(guidance, a, "address", "9 quai de la Gare 49000 Angers"), false);
  assert.equal(guidance.version, 1, "no unnecessary replan for unchanged text");
  assert.equal(correctDiscoveryGuidance(guidance, a, "siret", "987 654 321 00019"), true);
  assert.equal(guidance.selected.find(item => item.field === "siret").value, "98765432100019");
  assert.equal(guidance.verifiedOfficial, undefined);
  assert.deepEqual(a, original, "candidate official observation remains unchanged");
  assert.equal(correctDiscoveryGuidance(guidance, a, "siret", "9876543210"), false);
  assert.equal(correctDiscoveryGuidance(guidance, a, "siret", "fake 98765432100019"), false);
  assert.equal(correctDiscoveryGuidance(guidance, a, "siret", "98765432100019<script>"), false);
  assert.equal(correctDiscoveryGuidance(guidance, a, "name", "x".repeat(251)), false);
  assert.equal(correctDiscoveryGuidance(guidance, a, "__proto__", "X"), false);
  assert.equal(correctDiscoveryGuidance(guidance, null, "name", "Test"), false);
  assert.equal(guidance.version, 2, "invalid corrections cannot mutate guidance");
  chooseDiscoveryGuidance(guidance, a, "", "reject");
  assert.ok(isRejectedGuidance(guidance, a));
  assert.deepEqual(guidance.selected, []);
  assert.equal(correctDiscoveryGuidance(guidance, a, "commune", "Angers"), true);
  assert.equal(isRejectedGuidance(guidance, a), false, "a new correction restores the candidate for discovery");
});
