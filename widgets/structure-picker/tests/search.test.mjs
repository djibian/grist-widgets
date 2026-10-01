import test from "node:test";
import assert from "node:assert/strict";
import { buildExternalSearchUrl, candidateFrom, extractLocationFromAddress, flattenExternalResults, normalize, rankExternalCandidates, searchLocal } from "../search.js";
import { DEFAULT_DEPARTMENTS, setActiveDepartments } from "../departments.js";

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

test("DINUM candidate prefers a public-facing usual name and keeps coordinates", () => {
  const candidate = candidateFrom({ siren: "123456789", nom_raison_sociale: "MARTIN AUTOMOBILES" }, {
    siret: "12345678900011", etat_administratif: "A", liste_enseignes: ["GARAGE MARTIN"], adresse: "12 RUE DES ARTISANS 44270 MACHECOUL-SAINT-MEME", code_postal: "44270", libelle_commune: "MACHECOUL-SAINT-MEME", activite_principale: "45.20A", latitude: "47.1", longitude: "-1.8",
  });
  assert.equal(candidate.nomCommercial, "GARAGE MARTIN");
  assert.equal(candidate.nomUsuelDistinct, true);
  assert.equal(candidate.raisonSociale, "MARTIN AUTOMOBILES");
  assert.equal(candidate.latitude, 47.1);
  assert.equal(candidate.longitude, -1.8);
  assert.equal(Object.prototype.hasOwnProperty.call(candidate, "ape"), false);
});

test("Super U Machecoul Annuaire payload yields SIDONAM candidate", () => {
  const payload = { results: [{
    siren: "410918080",
    nom_raison_sociale: "SIDONAM",
    matching_etablissements: [{
      siret: "41091808000020",
      etat_administratif: "A",
      liste_enseignes: ["SUPER U"],
      adresse: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME",
      code_postal: "44270",
      libelle_commune: "MACHECOUL-SAINT-MEME",
      latitude: "46.996561",
      longitude: "-1.815374",
    }],
  }] };

  buildExternalSearchUrl("super u prises", { codePostal: "44270" });
  const [candidate] = flattenExternalResults(payload);
  assert.equal(candidate.nomCommercial, "SUPER U");
  assert.equal(candidate.raisonSociale, "SIDONAM");
  assert.equal(candidate.siret, "41091808000020");
  assert.equal(candidate.codePostal, "44270");
});

test("O PRE D'VOUS branch is ranked before another PH DISTRIBUTION establishment", () => {
  const payload = { results: [{
    siren: "893061044",
    nom_raison_sociale: "PH DISTRIBUTION",
    matching_etablissements: [
      { siret: "89306104400010", etat_administratif: "A", liste_enseignes: ["PH DISTRIBUTION"], adresse: "LA MORTIERE 44270 SAINT-ETIENNE-DE-MER-MORTE", code_postal: "44270", libelle_commune: "SAINT-ETIENNE-DE-MER-MORTE" },
      { siret: "89306104400028", etat_administratif: "A", liste_enseignes: ["O PRE D'VOUS"], adresse: "24 RUE DES FOSSES 44270 LA MARNE", code_postal: "44270", libelle_commune: "LA MARNE" },
    ],
  }] };
  buildExternalSearchUrl("o pre d vous fosses", { codePostal: "44270" });
  const candidates = flattenExternalResults(payload);
  assert.equal(candidates[0].siret, "89306104400028");
});

test("POM' DE RAINETTE branch is ranked before the other PICOTI PICOTA establishments", () => {
  const payload = { results: [{
    siren: "884935834",
    nom_raison_sociale: "PICOTI PICOTA",
    matching_etablissements: [
      { siret: "88493583400017", etat_administratif: "A", adresse: "8 RUE DU FIEF DE LA REINE 85300 SALLERTAINE", code_postal: "85300", libelle_commune: "SALLERTAINE" },
      { siret: "88493583400025", etat_administratif: "A", adresse: "IMPASSE DE LA CAILLAUDIERE 85300 SALLERTAINE", code_postal: "85300", libelle_commune: "SALLERTAINE" },
      { siret: "88493583400033", etat_administratif: "A", liste_enseignes: ["POM' DE RAINETTE"], nom_commercial: "POM' DE RAINETTE", adresse: "10 B RUE DES MARGOTINS 85300 SALLERTAINE", code_postal: "85300", libelle_commune: "SALLERTAINE" },
    ],
  }] };
  buildExternalSearchUrl("pom de rainette margotins", { codePostal: "85300" });
  const candidates = flattenExternalResults(payload);
  assert.equal(candidates[0].siret, "88493583400033");
});

test("EHPAD public establishment name breaks the tie between same-legal-name branches", () => {
  const candidates = [
    { nomCommercial: "SOINS INFIRMIERS DOMICILE SSIDPA", raisonSociale: "EHPAD LA REYNERIE BOUIN", adresse: "14 RUE DU PAYS DE RETZ 85230 BOUIN", codePostal: "85230", commune: "BOUIN", siret: "26850025300045" },
    { nomCommercial: "EHPAD", raisonSociale: "EHPAD LA REYNERIE BOUIN", adresse: "LA REYNERIE RUE DU PAYS DE RETZ 85230 BOUIN", codePostal: "85230", commune: "BOUIN", siret: "26850025300011" },
  ];
  const ranked = rankExternalCandidates(candidates, "ehpad la reynerie bouin pays retz", "85230");
  assert.equal(ranked[0].siret, "26850025300011");
});

test("legal name is only a fallback when no usual name is published", () => {
  const candidate = candidateFrom({ siren: "123456789", nom_raison_sociale: "MARTIN AUTOMOBILES SARL" }, {
    siret: "12345678900011", etat_administratif: "A", code_postal: "44000",
  });
  assert.equal(candidate.nomCommercial, "MARTIN AUTOMOBILES SARL");
  assert.equal(candidate.nomUsuelDistinct, false);
});

test("external conversion filters departments and duplicates", () => {
  const payload = { results: [{ siren: "111111111", nom_raison_sociale: "TEST", matching_etablissements: [
    { siret: "11111111100011", etat_administratif: "A", code_postal: "44000" },
    { siret: "11111111100022", etat_administratif: "A", code_postal: "35000" },
  ] }] };
  assert.deepEqual(flattenExternalResults(payload, new Set(["11111111100011"])), []);
});

test("external URL supports postal-code disambiguation and enough candidates for branch ranking", () => {
  const url = new URL(buildExternalSearchUrl("Garage Martin", { codePostal: "44270", perPage: 6 }));
  assert.equal(url.searchParams.get("departement"), "44,85");
  assert.equal(url.searchParams.get("code_postal"), "44270");
  assert.equal(url.searchParams.get("per_page"), "20");
});

test("DINUM search and filtering use the configured departments", () => {
  try {
    setActiveDepartments(["49"]);
    const url = new URL(buildExternalSearchUrl("Garage Martin"));
    assert.equal(url.searchParams.get("departement"), "49");

    const payload = { results: [{ siren: "222222222", nom_raison_sociale: "TEST", matching_etablissements: [
      { siret: "22222222200011", etat_administratif: "A", code_postal: "49000" },
      { siret: "22222222200022", etat_administratif: "A", code_postal: "44000" },
    ] }] };
    const candidates = flattenExternalResults(payload);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].departement, "49");
  } finally {
    setActiveDepartments(DEFAULT_DEPARTMENTS);
  }
});
