import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExternalSearchUrl,
  candidateFrom,
  candidateMatchesIdentifier,
  extractLocationFromNormalizedAddress,
  flattenExternalResults,
  normalize,
  searchLocal,
} from "../search.js";

test("normalize handles accents and punctuation", () => {
  assert.equal(normalize("  Lycée Saint-Martin, Machecoul ! "), "lycee saint martin machecoul");
});

test("postal code and commune are extracted from an IGN normalized address", () => {
  assert.deepEqual(
    extractLocationFromNormalizedAddress("12 Rue des Artisans 44270 Machecoul-Saint-Même"),
    { codePostal: "44270", commune: "Machecoul-Saint-Même" },
  );
  assert.deepEqual(
    extractLocationFromNormalizedAddress("1 Place du Commerce, 44000 Nantes, France"),
    { codePostal: "44000", commune: "Nantes" },
  );
});

test("local search tolerates small spelling errors and uses derived location", () => {
  const rows = [
    {
      id: 1,
      NomCommercial: "Garage Martin",
      RaisonSociale: "MARTIN AUTOMOBILES",
      Adresse: "12 rue des Artisans",
      AdresseNormalisee: "12 Rue des Artisans 44270 Machecoul-Saint-Même",
      CodePostal: "44270",
      Commune: "Machecoul-Saint-Même",
      SirenSiret: "12345678900011",
    },
    {
      id: 2,
      NomCommercial: "Boulangerie Dupont",
      Adresse: "Nantes",
      SirenSiret: "12345678900022",
    },
  ];

  assert.equal(searchLocal(rows, "garag martn machecol")[0]?.id, 1);
  assert.equal(searchLocal(rows, "44270")[0]?.id, 1);
});

test("exact SIRET and SIREN are ranked first with one mixed identifier field", () => {
  const rows = [
    { id: 1, NomCommercial: "Alpha", SirenSiret: "12345678900011" },
    { id: 2, NomCommercial: "Beta", SirenSiret: "98765432100022" },
  ];
  assert.equal(searchLocal(rows, "98765432100022")[0]?.id, 2);
  assert.equal(searchLocal(rows, "987654321")[0]?.id, 2);
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

test("legal name is used as display name when the establishment has no commercial name", () => {
  const candidate = candidateFrom(
    { siren: "123456789", nom_raison_sociale: "SOCIETE SANS ENSEIGNE" },
    {
      siret: "12345678900011",
      etat_administratif: "A",
      code_postal: "44000",
      adresse: "1 RUE TEST 44000 NANTES",
    },
  );
  assert.equal(candidate.nomCommercial, "SOCIETE SANS ENSEIGNE");
});

test("mixed SIREN/SIRET field prevents duplicates conservatively", () => {
  const candidate = { siren: "111111111", siret: "11111111100044" };
  assert.equal(candidateMatchesIdentifier(candidate, "11111111100044"), true);
  assert.equal(candidateMatchesIdentifier(candidate, "111111111"), true);
  assert.equal(candidateMatchesIdentifier(candidate, "222222222"), false);
});

test("external conversion only keeps active establishments in 44/85 and removes local duplicates", () => {
  const payload = {
    results: [
      {
        siren: "111111111",
        nom_raison_sociale: "TEST",
        matching_etablissements: [
          { siret: "11111111100011", etat_administratif: "A", code_postal: "44000", libelle_commune: "NANTES" },
          { siret: "22222222200022", etat_administratif: "F", code_postal: "85000", libelle_commune: "LA ROCHE-SUR-YON" },
          { siret: "33333333300033", etat_administratif: "A", code_postal: "35000", libelle_commune: "RENNES" },
          { siret: "44444444400044", etat_administratif: "A", code_postal: "85000", libelle_commune: "LA ROCHE-SUR-YON" },
        ],
      },
    ],
  };

  const results = flattenExternalResults(payload, new Set(["11111111100011"]));
  assert.deepEqual(results.map(item => item.siret), ["44444444400044"]);
});

test("external URL explicitly filters departments 44 and 85", () => {
  const url = new URL(buildExternalSearchUrl("garage Machecoul"));
  assert.equal(url.searchParams.get("departement"), "44,85");
  assert.equal(url.searchParams.get("etat_administratif"), "A");
  assert.equal(url.searchParams.get("include"), "matching_etablissements,siege");
});
