import test from "node:test";
import assert from "node:assert/strict";
import { buildEnrichmentProposals, diagnoseRow, enterpriseSearchAttempts, enterpriseSearchContext, selectedChanges } from "../enrichment.js";

test("empty coordinates are missing, not zero", () => {
  const diagnosis = diagnoseRow({ NomCommercial: "Garage Martin", Adresse: "12 rue X 44270 Machecoul", SirenSiret: "", Latitude: "", Longitude: "" });
  assert.equal(diagnosis.hasCoordinates, false);
  assert.equal(diagnosis.codePostal, "44270");
});

test("Null Island coordinates are treated as missing", () => {
  const diagnosis = diagnoseRow({ NomCommercial: "Crèche", Adresse: "10 rue X 85300 Sallertaine", SirenSiret: "", Latitude: 0, Longitude: 0 });
  assert.equal(diagnosis.hasCoordinates, false);
  assert.equal(diagnosis.needsGeocode, true);
});

test("a single zero coordinate can still be valid", () => {
  const diagnosis = diagnoseRow({ NomCommercial: "Test", Adresse: "Adresse", SirenSiret: "", Latitude: 48, Longitude: 0 });
  assert.equal(diagnosis.hasCoordinates, true);
});

test("enterprise lookup uses identifier first and address context otherwise", () => {
  assert.deepEqual(enterpriseSearchContext({ SirenSiret: "12345678900011", NomCommercial: "X", Adresse: "44000 Nantes" }), { query: "12345678900011", codePostal: "" });
  assert.deepEqual(enterpriseSearchContext({ SirenSiret: "", NomCommercial: "Garage Martin", Adresse: "12 rue X 44270 Machecoul" }), { query: "Garage Martin", codePostal: "44270" });
});

function assertSingleNearbyFirst(attempts, postalCode) {
  assert.ok(attempts[0]?.query.startsWith("__near_point__:"));
  assert.equal(attempts[0]?.codePostal, postalCode);
  assert.equal(attempts.filter(item => item.query.startsWith("__near_point__:")).length, 1);
}

test("Super U tries nearby, then identity plus street, then address-only rescue", () => {
  const attempts = enterpriseSearchAttempts({
    SirenSiret: "",
    NomCommercial: "Super U Machecoul",
    Adresse: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME",
  }, {
    adresse: "Boulevard des Prises 44270 Machecoul-Saint-Même",
    codePostal: "44270",
    commune: "Machecoul-Saint-Même",
    latitude: 46.996561,
    longitude: -1.815374,
    score: 0.64,
  });

  assertSingleNearbyFirst(attempts, "44270");
  const nearby = attempts[0].query.split("|");
  assert.equal(Number(nearby[2]), 0.25);
  assert.equal(decodeURIComponent(nearby[3]), "super u");

  const superStreetIndex = attempts.findIndex(item => item.query === "super prises" && item.codePostal === "44270");
  const targetedIndex = attempts.findIndex(item => item.query.startsWith("__targeted_text__:"));
  assert.ok(superStreetIndex > 0);
  assert.ok(targetedIndex > superStreetIndex);

  const targeted = attempts[targetedIndex];
  const [apiQueryRaw, identityRaw] = targeted.query.slice("__targeted_text__:".length).split("|");
  assert.equal(decodeURIComponent(apiQueryRaw), "prises");
  assert.equal(decodeURIComponent(identityRaw), "super u");
});

test("Pom de Rainette keeps one fast nearby attempt and text fallbacks", () => {
  const attempts = enterpriseSearchAttempts({
    SirenSiret: "",
    NomCommercial: "CRECHE POM'DE RAINETTE ",
    Adresse: "10 BIS RUE DES MARGOTINS 85300 SALLERTAINE ",
  }, {
    adresse: "10 bis Rue des Margotins 85300 Sallertaine",
    codePostal: "85300",
    commune: "Sallertaine",
    latitude: 46.868553,
    longitude: -1.94211,
    score: 0.89,
  });

  assertSingleNearbyFirst(attempts, "85300");
  assert.ok(attempts.some(item => item.query === "pom de rainette" && item.codePostal === "85300"));
});

test("O Pre d'Vous keeps one fast nearby attempt", () => {
  const attempts = enterpriseSearchAttempts({
    SirenSiret: "",
    NomCommercial: "ô Pré d’Vous",
    Adresse: "24 rue des fosses 44270 La Marne",
  }, {
    adresse: "24 Rue des Fosses 44270 La Marne",
    codePostal: "44270",
    commune: "La Marne",
    latitude: 46.997657,
    longitude: -1.736921,
    score: 0.95,
  });
  assertSingleNearbyFirst(attempts, "44270");
  assert.ok(attempts.length <= 5);
});

test("EHPAD keeps one nearby attempt instead of widening the radius", () => {
  const attempts = enterpriseSearchAttempts({
    SirenSiret: "",
    NomCommercial: "EHPAD La Reynerie Bouin 85230",
    Adresse: "8bis Rue du Pays de Retz 85230 Bouin",
  }, {
    adresse: "8bis Rue du Pays de Retz 85230 Bouin",
    codePostal: "85230",
    commune: "Bouin",
    latitude: 46.974141,
    longitude: -1.994981,
    score: 0.96,
  });
  assertSingleNearbyFirst(attempts, "85230");
  const nearbyIdentity = decodeURIComponent(attempts[0].query.split("|")[3]);
  assert.equal(nearbyIdentity, "ehpad la reynerie");
  assert.ok(attempts.some(item => item.query === "ehpad la reynerie pays retz"));
});

test("enterprise lookup remains short and deduplicated", () => {
  const attempts = enterpriseSearchAttempts({
    SirenSiret: "",
    NomCommercial: "CRECHE POM'DE RAINETTE",
    Adresse: "Sallertaine",
  });
  assert.ok(attempts.length <= 5);
  assert.equal(new Set(attempts.map(item => `${item.query}|${item.codePostal}`)).size, attempts.length);
});

test("missing data is selected by default but address replacement is explicit", () => {
  const row = { NomCommercial: "Garage Martin", Adresse: "5 rte st meme 44270 machecoul", SirenSiret: "", RaisonSociale: "", Latitude: "", Longitude: "" };
  const enterprise = { nomCommercial: "GARAGE MARTIN", nomUsuelDistinct: true, raisonSociale: "MARTIN AUTO", siret: "12345678900011", adresse: "5 ROUTE ST MEME 44270 MACHECOUL", latitude: 47, longitude: -1.8 };
  const geocode = { adresse: "5 Route de Saint-Même 44270 Machecoul-Saint-Même", latitude: 46.99, longitude: -1.82 };
  const byField = Object.fromEntries(buildEnrichmentProposals(row, enterprise, geocode).map(item => [item.field, item]));
  assert.equal(byField.SirenSiret.selectedByDefault, true);
  assert.equal(byField.Latitude.selectedByDefault, true);
  assert.equal(byField.Longitude.selectedByDefault, true);
  assert.equal(byField.Adresse.selectedByDefault, false);
  assert.equal(Object.prototype.hasOwnProperty.call(byField, "APE"), false);
});

test("legal-name fallback never replaces an existing usual name", () => {
  const row = { NomCommercial: "Garage Martin", Adresse: "5 rue X", SirenSiret: "", RaisonSociale: "" };
  const enterprise = { nomCommercial: "MARTIN AUTOMOBILES SARL", nomUsuelDistinct: false, raisonSociale: "MARTIN AUTOMOBILES SARL", siret: "12345678900011" };
  const proposals = buildEnrichmentProposals(row, enterprise, null);
  assert.equal(proposals.some(item => item.field === "NomCommercial"), false);
  assert.equal(proposals.some(item => item.field === "RaisonSociale"), true);
});

test("legal-name fallback may fill an empty usual name as a last resort", () => {
  const row = { NomCommercial: "", Adresse: "5 rue X", SirenSiret: "", RaisonSociale: "" };
  const enterprise = { nomCommercial: "MARTIN AUTOMOBILES SARL", nomUsuelDistinct: false, raisonSociale: "MARTIN AUTOMOBILES SARL", siret: "12345678900011" };
  const proposal = buildEnrichmentProposals(row, enterprise, null).find(item => item.field === "NomCommercial");
  assert.equal(proposal?.selectedByDefault, true);
});

test("only checked proposals are applied", () => {
  assert.deepEqual(selectedChanges([{ field: "RaisonSociale", proposed: "MARTIN AUTO" }, { field: "Latitude", proposed: 47 }], new Set(["Latitude"])), { Latitude: 47 });
});