import test from "node:test";
import assert from "node:assert/strict";
import { COLUMN_DEFS, fieldsForCandidate, isFormulaColumn } from "../grist.js";

test("mapping is minimal, readable and keeps map coordinates", () => {
  const names = COLUMN_DEFS.map(item => item.name);
  const titles = COLUMN_DEFS.map(item => item.title);
  const byName = Object.fromEntries(COLUMN_DEFS.map(item => [item.name, item]));
  assert.equal(names.includes("AdresseNormalisee"), false);
  assert.equal(names.filter(name => name === "Adresse").length, 1);
  assert.equal(names.includes("APE"), false);
  assert.equal(names.includes("Latitude"), true);
  assert.equal(names.includes("Longitude"), true);
  assert.equal(byName.NomCommercial.title, "Nom usuel");
  assert.equal(titles.some(title => title.includes("—")), false);
});

test("optional contact mappings are exposed without making them mandatory", () => {
  const byName = Object.fromEntries(COLUMN_DEFS.map(item => [item.name, item]));
  assert.equal(byName.Telephone.title, "Téléphone");
  assert.equal(byName.Courriel.title, "Courriel");
  assert.equal(byName.SiteWeb.title, "Site web");
  assert.equal(byName.Telephone.optional, true);
  assert.equal(byName.Courriel.optional, true);
  assert.equal(byName.SiteWeb.optional, true);
});

test("formula detection blocks only actual formulas", () => {
  assert.equal(isFormulaColumn({ isFormula: true, formula: "$A" }), true);
  assert.equal(isFormulaColumn({ isFormula: true, formula: "" }), false);
});

test("candidate writing includes only a demonstrated site position when both coordinates are mapped", () => {
  const snapshot = { writableMappings: { NomCommercial: "Nom", Adresse: "Adresse", SirenSiret: "Id", Latitude: "Lat", Longitude: "Lon" } };
  const fields = fieldsForCandidate({ nomCommercial: "Garage", adresse: "A", siret: "12345678900011", position: { status: "SITE_CONFIRMED", siret: "12345678900011", latitude: 47, longitude: -1.8, source: { label: "OSM", recordId: "node:1" }, proof: [] } }, snapshot);
  assert.deepEqual(fields, { Nom: "Garage", Adresse: "A", Id: "12345678900011", Lat: 47, Lon: -1.8 });
});


test("adding a raw Annuaire result cannot write its administrative coordinates as the final site position", () => {
  const snapshot = { writableMappings: { SirenSiret: "Id", Latitude: "Lat", Longitude: "Lon" } };
  assert.deepEqual(fieldsForCandidate({ siret: "12345678900011", latitude: 47, longitude: -1.8 }, snapshot), { Id: "12345678900011" });
});

test('unmapped optional site URLs use an unambiguous physical column alias', async t => {
  const {fetchFullSnapshot}=await import('../grist.js');const previous=globalThis.grist;
  globalThis.grist={selectedTable:{async getTableId(){return'Structures_de_stage';}},docApi:{async fetchTable(table){
    if(table==='Structures_de_stage')return{id:[1],Nom_usuel:['École'],Adresse:['7 rue'],Numero_d_immatriculation:[''],Site_web:['https://example.org/'],Courriel:['contact@example.org']};
    if(table==='_grist_Tables')return{id:[1],tableId:['Structures_de_stage']};return{};
  }}};t.after(()=>{globalThis.grist=previous;});
  const result=await fetchFullSnapshot({});assert.deepEqual(result.missing,[]);assert.equal(result.rows[0].SiteWeb,'https://example.org/');assert.equal(result.resolvedMappings.SiteWeb,'Site_web');
});
