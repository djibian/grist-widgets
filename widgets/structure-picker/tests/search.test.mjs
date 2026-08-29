import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExternalSearchUrl,
  candidateFrom,
  flattenExternalResults,
  normalize,
  searchLocal,
} from "../search.js";

test("normalize handles accents and punctuation", () => {
  assert.equal(normalize("  Lycée Saint-Martin, Machecoul ! "), "lycee saint martin machecoul");
});

test("local search tolerates small spelling errors", () => {
  const rows = [
    {
      id: 1,
      Nom: "Garage Martin",
      NomCommercial: "Garage Martin",
      RaisonSociale: "MARTIN AUTOMOBILES",
      Adresse: "12 rue des Artisans 44270 Machecoul-Saint-Même",
      Commune: "Machecoul-Saint-Même",
      SIRET: "12345678900011",
    },
    {
      id: 2,
      Nom: "Boulangerie Dupont",
      Adresse: "Nantes",
      SIRET: "12345678900022",
    },
  ];

  const results = searchLocal(rows, "garag martn machecol");
  assert.equal(results[0]?.id, 1);
});

test("exact SIRET is ranked first", () => {
  const rows = [
    { id: 1, Nom: "Alpha", SIRET: "12345678900011" },
    { id: 2, Nom: "Beta", SIRET: "98765432100022" },
  ];
  assert.equal(searchLocal(rows, "98765432100022")[0]?.id, 2);
});

test("DINUM candidate keeps commercial and legal names distinct", () => {
  const candidate = candidateFrom(
    { siren: "123456789", nom_raison_sociale: "MARTIN AUTOMOBILES" },
    {
      siret: "12345678900011",
      etat_administratif: "A",
      liste_enseignes: ["GARAGE MARTIN"],
      nom_commercial: "MARTIN AUTO",
      adresse: "12 RUE DES ARTISANS 44270 MACHECOUL-SAINT-MEME",
      code_postal: "44270",
      libelle_commune: "MACHECOUL-SAINT-MEME",
      activite_principale: "45.20A",
      latitude: "47.1",
      longitude: "-1.8",
    },
  );

  assert.equal(candidate.nomCommercial, "GARAGE MARTIN");
  assert.equal(candidate.raisonSociale, "MARTIN AUTOMOBILES");
  assert.equal(candidate.siren, "123456789");
  assert.equal(candidate.siret, "12345678900011");
});

test("external conversion only keeps active establishments in 44/85 and removes local duplicates", () => {
  const payload = {
    results: [
      {
        siren: "111111111",
        nom_raison_sociale: "TEST",
        matching_etablissements: [
          { siret: "11111111100011", etat_administratif: "A", code_postal: "44000", libelle_commune: "NANTES" },
          { siret: "11111111100022", etat_administratif: "F", code_postal: "85000", libelle_commune: "LA ROCHE-SUR-YON" },
          { siret: "11111111100033", etat_administratif: "A", code_postal: "35000", libelle_commune: "RENNES" },
          { siret: "11111111100044", etat_administratif: "A", code_postal: "85000", libelle_commune: "LA ROCHE-SUR-YON" },
        ],
      },
    ],
  };

  const results = flattenExternalResults(payload, new Set(["11111111100011"]));
  assert.deepEqual(results.map(item => item.siret), ["11111111100044"]);
});

test("external URL explicitly filters departments 44 and 85", () => {
  const url = new URL(buildExternalSearchUrl("garage Machecoul"));
  assert.equal(url.searchParams.get("departement"), "44,85");
  assert.equal(url.searchParams.get("etat_administratif"), "A");
  assert.equal(url.searchParams.get("include"), "matching_etablissements,siege");
});
