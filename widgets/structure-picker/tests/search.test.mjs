import test from "node:test";
import assert from "node:assert/strict";
import { buildExternalSearchUrl, candidateFrom, extractLocationFromAddress, flattenExternalResults, normalize, searchLocal } from "../search.js";

test("normalize handles accents and punctuation", () => {
  assert.equal(normalize("  Lycée Saint-Martin, Machecoul ! "), "lycee saint martin machecoul");
});

test("single address field yields postal code and commune", () => {
  assert.deepEqual(extractLocationFromAddress("12 Rue des Artisans 44270 Machecoul-Saint-Même"), { codePostal: "44270", commune: "Machecoul-Saint-Même" });
});

test("local fuzzy search uses single address", () => {
  const rows = [
    { id: 1, NomCommercial: "Garage Martin", RaisonSociale: "MARTIN AUTOMOBILES", Adresse: "12 rue des Artisans 44270 Machecoul-Saint-Même", SirenSiret: "12345678900011" },
    { id: 2, NomCommercial: "Boulangerie Dupont", Adresse: "Nantes", SirenSiret: "12345678900022" },
  ];
  assert.equal(searchLocal(rows, "garag martn machecol")[0]?.id, 1);
});

test("DINUM candidate keeps coordinates", () => {
  const candidate = candidateFrom({ siren: "123456789", nom_raison_sociale: "MARTIN AUTOMOBILES" }, {
    siret: "12345678900011", etat_administratif: "A", liste_enseignes: ["GARAGE MARTIN"], adresse: "12 RUE DES ARTISANS 44270 MACHECOUL-SAINT-MEME", code_postal: "44270", libelle_commune: "MACHECOUL-SAINT-MEME", activite_principale: "45.20A", latitude: "47.1", longitude: "-1.8",
  });
  assert.equal(candidate.nomCommercial, "GARAGE MARTIN");
  assert.equal(candidate.latitude, 47.1);
  assert.equal(candidate.longitude, -1.8);
});

test("external conversion filters departments and duplicates", () => {
  const payload = { results: [{ siren: "111111111", nom_raison_sociale: "TEST", matching_etablissements: [
    { siret: "11111111100011", etat_administratif: "A", code_postal: "44000" },
    { siret: "11111111100022", etat_administratif: "A", code_postal: "35000" },
  ] }] };
  assert.deepEqual(flattenExternalResults(payload, new Set(["11111111100011"])), []);
});

test("external URL supports postal-code disambiguation", () => {
  const url = new URL(buildExternalSearchUrl("Garage Martin", { codePostal: "44270" }));
  assert.equal(url.searchParams.get("departement"), "44,85");
  assert.equal(url.searchParams.get("code_postal"), "44270");
});
