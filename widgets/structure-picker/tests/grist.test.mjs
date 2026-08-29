import test from "node:test";
import assert from "node:assert/strict";
import { COLUMN_DEFS, fieldsForCandidate, isFormulaColumn } from "../grist.js";

test("mapping exposes one address and latitude/longitude", () => {
  const names = COLUMN_DEFS.map(item => item.name);
  assert.equal(names.includes("AdresseNormalisee"), false);
  assert.equal(names.filter(name => name === "Adresse").length, 1);
  assert.equal(names.includes("Latitude"), true);
  assert.equal(names.includes("Longitude"), true);
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
