import test from "node:test";
import assert from "node:assert/strict";
import { buildEnrichmentProposals, diagnoseRow, enterpriseSearchContext, selectedChanges } from "../enrichment.js";
import { IDENTITY_STATES } from "../identity-resolution.js";

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

test("enterprise lookup uses identifier first and keeps name separate from location", () => {
  assert.deepEqual(enterpriseSearchContext({ SirenSiret: "12345678900011", NomCommercial: "X", Adresse: "44000 Nantes" }), { query: "12345678900011", codePostal: "" });
  assert.deepEqual(enterpriseSearchContext({ SirenSiret: "", NomCommercial: "Garage Martin", Adresse: "12 rue X 44270 Machecoul" }), { query: "Garage Martin", codePostal: "44270" });
});

test("missing data is selected by default but address replacement is explicit", () => {
  const row = { NomCommercial: "Garage Martin", Adresse: "5 rte st meme 44270 machecoul", SirenSiret: "", RaisonSociale: "", Latitude: "", Longitude: "" };
  const enterprise = { nomCommercial: "GARAGE MARTIN", nomUsuelDistinct: true, raisonSociale: "MARTIN AUTO", siret: "12345678900011", adresse: "5 ROUTE ST MEME 44270 MACHECOUL", latitude: 47, longitude: -1.8 };
  enterprise.position = { status: "SITE_CORROBORATED", siret: enterprise.siret, latitude: 47, longitude: -1.8, source: { label: "Overture Places", recordId: "test", url: "https://example.test" }, proof: [] };
  const byField = Object.fromEntries(buildEnrichmentProposals(row, enterprise).map(item => [item.field, item]));
  assert.equal(byField.SirenSiret.selectedByDefault, true);
  assert.equal(byField.Coordinates.selectedByDefault, true);
  assert.deepEqual(byField.Coordinates.fields, ["Latitude", "Longitude"]);
  assert.equal(byField.Adresse.selectedByDefault, false);
  assert.equal(Object.prototype.hasOwnProperty.call(byField, "APE"), false);
});

test("probable identity is shown but legal identity fields are not preselected", () => {
  const row = { NomCommercial: "EHPAD La Reynerie", Adresse: "8bis rue du Pays de Retz 85230 Bouin", SirenSiret: "", RaisonSociale: "" };
  const enterprise = { nomCommercial: "EHPAD", nomUsuelDistinct: true, raisonSociale: "EHPAD LA REYNERIE BOUIN", siret: "26850025300011" };
  const byField = Object.fromEntries(buildEnrichmentProposals(row, enterprise, { identityStatus: IDENTITY_STATES.MATCH_PROBABLE }).map(item => [item.field, item]));
  assert.equal(byField.SirenSiret.selectedByDefault, false);
  assert.equal(byField.RaisonSociale.selectedByDefault, false);
});

test("verified identity may preselect missing legal fields", () => {
  const row = { NomCommercial: "ô Pré d’Vous", Adresse: "24 rue des Fosses 44270 La Marne", SirenSiret: "", RaisonSociale: "" };
  const enterprise = { nomCommercial: "O PRE D'VOUS", nomUsuelDistinct: true, raisonSociale: "PH DISTRIBUTION", siret: "89306104400028" };
  const byField = Object.fromEntries(buildEnrichmentProposals(row, enterprise, { identityStatus: IDENTITY_STATES.MATCH_VERIFIED }).map(item => [item.field, item]));
  assert.equal(byField.SirenSiret.selectedByDefault, true);
  assert.equal(byField.RaisonSociale.selectedByDefault, true);
});

test("legal-name fallback never replaces an existing usual name", () => {
  const row = { NomCommercial: "Garage Martin", Adresse: "5 rue X", SirenSiret: "", RaisonSociale: "" };
  const enterprise = { nomCommercial: "MARTIN AUTOMOBILES SARL", nomUsuelDistinct: false, raisonSociale: "MARTIN AUTOMOBILES SARL", siret: "12345678900011" };
  const proposals = buildEnrichmentProposals(row, enterprise);
  assert.equal(proposals.some(item => item.field === "NomCommercial"), false);
  assert.equal(proposals.some(item => item.field === "RaisonSociale"), true);
});

test("legal-name fallback may fill an empty usual name as a last resort", () => {
  const row = { NomCommercial: "", Adresse: "5 rue X", SirenSiret: "", RaisonSociale: "" };
  const enterprise = { nomCommercial: "MARTIN AUTOMOBILES SARL", nomUsuelDistinct: false, raisonSociale: "MARTIN AUTOMOBILES SARL", siret: "12345678900011" };
  const proposal = buildEnrichmentProposals(row, enterprise).find(item => item.field === "NomCommercial");
  assert.equal(proposal?.selectedByDefault, true);
});

test("only checked proposals are applied", () => {
  assert.deepEqual(selectedChanges([{ field: "RaisonSociale", proposed: "MARTIN AUTO" }, { field: "Latitude", proposed: 47 }], new Set(["Latitude"])), { Latitude: 47 });
});


test("only a demonstrated position bound to the same SIRET can produce coordinate proposals", () => {
  const row = { SirenSiret: "", Latitude: 0, Longitude: 0 };
  const candidate = { siret: "12345678900011", latitude: 47, longitude: -1.8 };
  assert.equal(buildEnrichmentProposals(row, candidate).some(item => item.field === "Coordinates"), false);
  candidate.position = { status: "SITE_CONFIRMED", siret: "98765432100011", latitude: 47, longitude: -1.8 };
  assert.equal(buildEnrichmentProposals(row, candidate).some(item => item.field === "Coordinates"), false);
});

test("coordinate pair and provenance cannot be selected without the matching SIRET", () => {
  const candidate = { siret: "12345678900011", position: { siret: "12345678900011", status: "SITE_CONFIRMED", latitude: 47, longitude: -1.8, source: { label: "OpenStreetMap", recordId: "node:1", url: "https://www.openstreetmap.org/node/1" }, proof: [] } };
  const proposals = buildEnrichmentProposals({ SirenSiret: "", Latitude: 0, Longitude: 0 }, candidate);
  assert.deepEqual(selectedChanges(proposals, ["Coordinates"]), {});
  const changes = selectedChanges(proposals, ["Coordinates", "SirenSiret"]);
  assert.equal(changes.Latitude, 47);
  assert.equal(changes.Longitude, -1.8);
  assert.equal(changes.SirenSiret, candidate.siret);
  assert.equal(JSON.parse(changes.PositionProof).siret, candidate.siret);
  const existing = buildEnrichmentProposals({ SirenSiret: candidate.siret }, candidate);
  assert.equal(selectedChanges(existing, ["Coordinates"]).Latitude, 47);
});
