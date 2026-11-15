import test from "node:test";
import assert from "node:assert/strict";
import { planIdentityExpansion, addressSearchPhrase } from "../identity-expansion.js";

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
  assert.ok(plan.some(x => x.request.kind === "text" && x.request.query.includes("cooperative des saules") && !x.request.codePostal));
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


test("live guidance changes the query priority and postal scope without rewriting the reference row", () => {
  const row = { NomCommercial: "Le Verger", Adresse: "4 rue du Jardin 44000 Nantes", SirenSiret: "" };
  const guidance = { selected: [
    { field: "name", value: "Les Jardins du Canal", key: "a" },
    { field: "address", value: "8 quai des Moissons 49000 Angers", key: "a" },
    { field: "siret", value: "11122233300044", key: "a" },
    { field: "operator", value: "Association du Canal", key: "a" },
  ], rejected: [], version: 4 };
  const queries = planIdentityExpansion(row, { guidance });
  assert.equal(queries[0].request.kind, "siret");
  assert.equal(queries[0].request.identifier, "11122233300044");
  assert.ok(queries.some(item => item.request.kind === "text" &&
    item.request.query.includes("jardins du canal") && item.request.codePostal === "49000"));
  assert.ok(queries.some(item => item.request.kind === "text" &&
    item.request.query.includes("association du canal") && !item.request.codePostal));
  assert.equal(row.Adresse, "4 rue du Jardin 44000 Nantes");
  assert.equal(row.SirenSiret, "");
  assert.equal(new Set(queries.map(x => x.request.url)).size, queries.length);
});

test("guidance cannot bypass quotas or duplicate requests", () => {
  const row = { NomCommercial: "Atelier Noroît", Adresse: "10 chemin des Ajoncs 44000 Nantes" };
  const guidance = { selected: [{ key: "x", field: "siret", value: "12345678900012" }], rejected: [], version: 1 };
  const first = planIdentityExpansion(row, { guidance, maxQueries: 1 });
  assert.equal(first.length, 1);
  assert.equal(first[0].request.kind, "siret");
  const next = planIdentityExpansion(row, { guidance, maxQueries: 1, alreadyRequested: [first[0].request.url] });
  assert.equal(next.length, 1);
  assert.equal(next[0].request.kind, "text");
});

test("a street is a distinct, postcode-scoped discovery query even when the establishment name is unknown", () => {
  const row = { NomCommercial: "", Adresse: "17 rue des Moissons 44000 Nantes", SirenSiret: "" };
  const plan = planIdentityExpansion(row);
  assert.ok(plan.some(entry => entry.reason === "address-postcode" &&
    entry.request.kind === "text" &&
    entry.request.query === "17 rue des moissons" &&
    entry.request.codePostal === "44000"));
  assert.ok(plan.some(entry => entry.reason === "address-department" &&
    entry.request.query === "17 rue des moissons" && !entry.request.codePostal));
  assert.equal(new Set(plan.map(entry => entry.request.url)).size, plan.length);
  assert.equal(addressSearchPhrase("44000 Nantes"), "");
  assert.equal(addressSearchPhrase("Nantes"), "");
  assert.equal(addressSearchPhrase(""), "");
});

test("a corrected address leads the street search; original street is kept as an alternative, never overwritten", () => {
  const row = { NomCommercial: "Lieu inconnu", Adresse: "4 route du Moulin 44000 Nantes" };
  const guidance = { selected: [{ field: "address", value: "8 quai des Jardins 49000 Angers" }] };
  const plan = planIdentityExpansion(row, { guidance });
  const first = plan.findIndex(entry => entry.reason === "address-postcode");
  assert.ok(first >= 0);
  assert.equal(plan[first].request.query, "8 quai des jardins");
  assert.equal(plan[first].request.codePostal, "49000");
  assert.ok(plan.some(entry => entry.reason === "address-postcode" &&
    entry.request.query === "4 route du moulin" && entry.request.codePostal === "44000"));
  assert.equal(row.Adresse, "4 route du Moulin 44000 Nantes");
  const next = planIdentityExpansion(row, { guidance, alreadyRequested: plan.map(entry => entry.request.url) });
  assert.equal(next.length, 0);
});

test("address discovery does not consume requests for a vague postal-only value", () => {
  const plan = planIdentityExpansion({ Adresse: "44000 Nantes" });
  assert.deepEqual(plan, []);
});


test("explicit commune guidance outranks an obsolete postal code without turning it into site proof", () => {
  const row = { NomCommercial: "Atelier du Héron", Adresse: "3 rue du Moulin 44000 Nantes", SirenSiret: "" };
  const guidance = { selected: [{ field: "commune", value: "Angers", key: "guide" }], version: 1 };
  const first = planIdentityExpansion(row, { guidance, maxQueries: 1 });
  assert.equal(first.length, 1);
  assert.equal(first[0].reason, "name-commune-hint");
  assert.equal(first[0].request.codePostal, "", "old postal code must not restrict the newly confirmed commune");
  assert.match(first[0].request.query, /angers/);
  const next = planIdentityExpansion(row, { guidance, alreadyRequested: [first[0].request.url] });
  assert.ok(next.some(entry => entry.reason === "name-postcode"), "old postal lookup remains a hypothesis");
  assert.equal(new Set([first[0].request.url, ...next.map(entry => entry.request.url)]).size, next.length + 1);
  assert.equal(row.Adresse, "3 rue du Moulin 44000 Nantes");
});
