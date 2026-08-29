import test from "node:test";
import assert from "node:assert/strict";
import { COLUMN_DEFS, fieldsForCandidate, isFormulaColumn } from "../grist.js";

test("mapping is minimal, readable and keeps map coordinates", () => {
  const names = COLUMN_DEFS.map(item => item.name);
  const titles = COLUMN_DEFS.map(item => item.title);
  assert.equal(names.includes("AdresseNormalisee"), false);
  assert.equal(names.filter(name => name === "Adresse").length, 1);
  assert.equal(names.includes("APE"), false);
  assert.equal(names.includes("Latitude"), true);
  assert.equal(names.includes("Longitude"), true);
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

test("candidate writing includes map coordinates when mapped", () => {
  const snapshot = { writableMappings: { NomCommercial: "Nom", Adresse: "Adresse", SirenSiret: "Id", Latitude: "Lat", Longitude: "Lon" } };
  const fields = fieldsForCandidate({ nomCommercial: "Garage", adresse: "A", siret: "12345678900011", latitude: 47, longitude: -1.8 }, snapshot);
  assert.deepEqual(fields, { Nom: "Garage", Adresse: "A", Id: "12345678900011", Lat: 47, Lon: -1.8 });
});
