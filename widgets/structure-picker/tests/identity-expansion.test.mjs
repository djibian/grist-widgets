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

test("a selected official operator searches its published name as text, not direct SIREN", () => {
  const row = { NomCommercial: "Le Verger", Adresse: "4 rue du Jardin 44000 Nantes" };
  const manager = { nomCommercial: "Le Verger", raisonSociale: "Gestion des Jardins",
    siren: "112233445", siret: "11223344500018",
    adresse: "1 place du Siège 75000 Paris" };
  const guidance = { selected: [{ field: "operator", key: "siret:11223344500018",
    value: "Gestion des Jardins" }], rejected: [], version: 1 };
  const plan = planIdentityExpansion(row, { guidance, discoveredCandidates: [manager] });
  assert.equal(plan[0].reason, "operator-establishments");
  assert.equal(plan[0].request.kind, "text");
  assert.equal(plan[0].request.query, "gestion des jardins");
  assert.equal(plan[0].request.codePostal, "44000", "use the internship site, not the 75000 headquarters");
  assert.ok(plan.some(entry => entry.reason === "operator-establishments" &&
    entry.request.kind === "text" && !entry.request.codePostal),
  "a second textual lookup relaxes the postcode in the configured departments");
  assert.ok(!plan.some(entry => entry.request.kind === "siren"),
    "the direct SIREN endpoint does not return matching_etablissements");
  assert.ok(plan.some(entry => entry.reason === "name-postcode"));
  assert.equal(row.SirenSiret, undefined, "no identity is written into the reference row");
  assert.equal(new Set(plan.map(item => item.request.url)).size, plan.length);
});

test("operator lookups require the exact selected published candidate and respect rejection", () => {
  const row = { NomCommercial: "Le Verger", Adresse: "4 rue du Jardin 44000 Nantes" };
  const candidate = { nomCommercial: "Le Verger", raisonSociale: "Gestion des Jardins",
    siren: "112233445", siret: "11223344500018" };
  const selection = { field: "operator", key: "siret:11223344500018",
    value: "Gestion des Jardins" };
  const plan = options => planIdentityExpansion(row,
    { discoveredCandidates: [candidate], guidance: { selected: [selection], rejected: [], ...options } });
  assert.ok(plan({}).some(item => item.reason === "operator-establishments"));
  assert.ok(!plan({ rejected: [selection.key] }).some(item => item.reason === "operator-establishments"));
  assert.ok(!plan({ selected: [{ ...selection, corrected: true }] }).some(item => item.reason === "operator-establishments"));
  assert.ok(!plan({ selected: [{ ...selection, key: "siret:99999999900019" }] }).some(item => item.reason === "operator-establishments"));
  assert.ok(!plan({ selected: [{ ...selection, value: "Exploitant différent" }] }).some(item => item.reason === "operator-establishments"));
  assert.ok(!planIdentityExpansion(row, { guidance: { selected: [selection] } })
    .some(item => item.reason === "operator-establishments"));
});

test("operator-text discovery is deduplicated and does not trust corrected or stale identities", () => {
  const row = { NomCommercial: "Site de la Dune", Adresse: "21 rue des Dunes 44000 Nantes" };
  const manager = { raisonSociale: "Association du Rivage", siren: "123123123",
    siret: "12312312300012", adresse: "2 avenue du Siège 75000 Paris" };
  const chosen = { key: "siret:12312312300012", field: "operator", value: "Association du Rivage" };
  const options = { guidance: { selected: [chosen] }, discoveredCandidates: [manager] };
  const first = planIdentityExpansion(row, options);
  assert.deepEqual(first.filter(x => x.reason === "operator-establishments")
    .map(x => x.request.codePostal), ["44000", ""]);
  assert.equal(new Set(first.map(x => x.request.url)).size, first.length);
  assert.ok(!planIdentityExpansion(row, {
    ...options, alreadyRequested: first.map(x => x.request.url),
  }).some(x => x.reason === "operator-establishments"), "previous lookups are not repeated");
  assert.ok(!planIdentityExpansion(row, {
    ...options, guidance: { selected: [{ ...chosen, corrected: true }] },
  }).some(x => x.reason === "operator-establishments"), "edited names cannot impersonate published evidence");
  assert.ok(!planIdentityExpansion(row, {
    ...options, guidance: { selected: [chosen], rejected: [chosen.key] },
  }).some(x => x.reason === "operator-establishments"), "rejected manager cannot reopen search");
  assert.equal(row.SirenSiret, undefined);
  assert.ok(!planIdentityExpansion(row, {
    guidance: { selected: [chosen] },
    discoveredCandidates: [{ ...manager, siren: "999888777" }],
  }).some(x => x.reason === "operator-establishments"),
  "conflicting SIREN and SIRET must not provide a published-manager bridge");
});


test("non-head-office SIRET relays published legal name into text discovery without certifying identity", () => {
  const row = { NomCommercial: "", Adresse: "17 chemin du Rivage 44000 Nantes", SirenSiret: "11223344500029" };
  const plan = planIdentityExpansion(row, { identifierLegalNames: [
    { siren: "112233445", legalName: "Ateliers du Littoral" },
    { siren: "998877665", legalName: "Une autre entreprise" },
  ] });
  const matches = plan.filter(item => item.reason === "identifier-legal-name");
  assert.equal(matches.length, 2);
  assert.equal(matches[0].request.query, "ateliers du littoral");
  assert.equal(matches[0].request.codePostal, "44000");
  assert.equal(matches[0].boundSiren, "112233445");
  assert.equal(matches[1].request.codePostal, "");
  assert.ok(!plan.some(item => item.request.query === "une autre entreprise"));
  assert.equal(new Set(plan.map(item => item.request.url)).size, plan.length);
  assert.deepEqual(planIdentityExpansion(row, { identifierLegalNames: [
    { siren: "112233445", legalName: "Ateliers du Littoral" },
  ], alreadyRequested: plan.map(item => item.request.url) }), []);
});

test("explicit corrections invalidate stale name, address, postal and identifier queries without altering Grist", () => {
  const row = {
    NomCommercial: "Ancienne appellation", Adresse: "4 rue du Moulin 44000 Nantes",
    SirenSiret: "12345678900012",
  };
  const guidance = { selected: [
    { field: "name", value: "Nouveau lieu", corrected: true },
    { field: "address", value: "8 quai du Parc 49000 Angers", corrected: true },
    { field: "siret", value: "98765432100019", corrected: true },
  ] };
  const requests = planIdentityExpansion(row, { guidance, maxQueries: 30 });
  assert.equal(requests[0].request.identifier, "98765432100019");
  assert.ok(!requests.some(entry => entry.request.identifier === "12345678900012"));
  assert.ok(!requests.some(entry => entry.request.query?.includes("ancienne appellation")));
  assert.ok(!requests.some(entry => entry.request.query === "4 rue du moulin"));
  assert.ok(requests.some(entry => entry.request.query === "8 quai du parc" &&
    entry.request.codePostal === "49000"));
  assert.equal(row.Adresse, "4 rue du Moulin 44000 Nantes");
  assert.equal(row.SirenSiret, "12345678900012");
});

test("corrected commune disallows the old postcode as a fallback filter", () => {
  const row = { NomCommercial: "Lieu pilote", Adresse: "3 rue du Bourg 44000 Nantes" };
  const guidance = { selected: [{ field: "commune", value: "Angers", corrected: true }] };
  const requests = planIdentityExpansion(row, { guidance, maxQueries: 30 });
  assert.ok(requests.some(q => q.reason === "name-commune-hint" && q.request.query.includes("angers")));
  assert.ok(!requests.some(q => q.request.codePostal === "44000"));
  assert.ok(!requests.some(q => q.request.query === "3 rue du bourg"),
    "old address is not pursued when the recorded commune was corrected");
});
