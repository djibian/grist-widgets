import test from "node:test";
import assert from "node:assert/strict";
import { buildEnrichmentProposals, diagnoseRow, enterpriseSearchContext, selectedChanges } from "../enrichment.js";

test("empty coordinates are missing, not zero", () => {
  const diagnosis = diagnoseRow({ NomCommercial: "Garage Martin", Adresse: "12 rue X 44270 Machecoul", SirenSiret: "", Latitude: "", Longitude: "" });
  assert.equal(diagnosis.hasCoordinates, false);
  assert.equal(diagnosis.codePostal, "44270");
});

test("enterprise lookup uses identifier first and address context otherwise", () => {
  assert.deepEqual(enterpriseSearchContext({ SirenSiret: "12345678900011", NomCommercial: "X", Adresse: "44000 Nantes" }), { query: "12345678900011", codePostal: "" });
  assert.deepEqual(enterpriseSearchContext({ SirenSiret: "", NomCommercial: "Garage Martin", Adresse: "12 rue X 44270 Machecoul" }), { query: "Garage Martin Machecoul", codePostal: "44270" });
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
