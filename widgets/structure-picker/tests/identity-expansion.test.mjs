import test from "node:test";
import assert from "node:assert/strict";
import { planIdentityExpansion } from "../identity-expansion.js";

test("general expansion searches untrusted identifier independently, then alternate names with and without postal restriction", () => {
  const row = {
    NomCommercial: "Atelier des Saules",
    RaisonSociale: "Coopérative des Saules",
    Adresse: "7 rue des Tisserands 44000 Nantes",
    SirenSiret: "12345678900019",
  };
  const plan = planIdentityExpansion(row);
  assert.equal(plan[0].request.kind, "siret");
  assert.equal(plan[0].request.identifier, "12345678900019");
  assert.ok(plan.some(x => x.request.kind === "text" && x.request.codePostal === "44000"));
  assert.ok(plan.some(x => x.request.kind === "text" && !x.request.codePostal));
  assert.ok(plan.some(x => x.request.query.includes("cooperative des saules") && !x.request.codePostal));
  assert.equal(new Set(plan.map(x => x.request.url)).size, plan.length);
});

test("no identifier => no invented identifier query; query budget and prior URLs apply", () => {
  const row = { NomCommercial: "Moulin des Marais", Adresse: "23 allée des Platanes 85000 La Roche-sur-Yon" };
  const original = planIdentityExpansion(row);
  const plan = planIdentityExpansion(row, { alreadyRequested: [original[0].request.url], maxQueries: 2 });
  assert.ok(plan.length <= 2);
  assert.ok(plan.every(x => x.request.url !== original[0].request.url));
  assert.ok(plan.every(x => x.request.kind === "text"));
  assert.deepEqual(planIdentityExpansion({}, { maxQueries: 0 }), []);
});
