import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExternalSearchUrl,
  buildNearbySearchQuery,
  candidateFrom,
  extractLocationFromAddress,
  flattenExternalResults,
  normalize,
  rankExternalCandidates,
  rankNearbyCandidates,
  scoreAddressEvidence,
  searchLocal,
} from "../search.js";
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

test("near-point query builds a compact size-sorted official geographic request", () => {
  const query = buildNearbySearchQuery({
    latitude: 46.996561,
    longitude: -1.815374,
    radius: 0.25,
    name: "Super U Machecoul",
    address: "Boulevard des Prises 44270 Machecoul-Saint-Même",
  });
  const url = new URL(buildExternalSearchUrl(query, { codePostal: "44270" }));
  assert.equal(url.pathname, "/near_point");
  assert.equal(url.searchParams.get("lat"), "46.996561");
  assert.equal(url.searchParams.get("long"), "-1.815374");
  assert.equal(url.searchParams.get("radius"), "0.25");
  assert.equal(url.searchParams.get("per_page"), "25");
  assert.equal(url.searchParams.get("sort_by_size"), "true");
  assert.equal(url.searchParams.has("q"), false);
});

test("street evidence recognizes the Super U legal address while rejecting another street", () => {
  const target = "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME";
  const sidonam = {
    adresse: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME",
    codePostal: "44270",
    commune: "MACHECOUL-SAINT-MEME",
  };
  const school = {
    adresse: "1 BD GABRIEL RELIQUET 44270 MACHECOUL-SAINT-MEME",
    codePostal: "44270",
    commune: "MACHECOUL-SAINT-MEME",
  };
  assert.ok(scoreAddressEvidence(target, sidonam) >= 0.90);
  assert.equal(scoreAddressEvidence(target, school), 0);
});

test("nearby Super U lookup does not stop on address-only legal entities", () => {
  const payload = { results: [
    {
      siren: "410918080",
      nom_raison_sociale: "SIDONAM",
      matching_etablissements: [{
        siret: "41091808000020", etat_administratif: "A",
        adresse: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME", code_postal: "44270", libelle_commune: "MACHECOUL-SAINT-MEME",
        latitude: "46.998186", longitude: "-1.815260",
      }],
    },
    {
      siren: "484616131",
      nom_raison_sociale: "NOMADIS",
      matching_etablissements: [{
        siret: "48461613100013", etat_administratif: "A",
        adresse: "ESPACE COMMERCIAL BD DES PRISES 44270 MACHECOUL-SAINT-MEME", code_postal: "44270", libelle_commune: "MACHECOUL-SAINT-MEME",
        latitude: "46.9981", longitude: "-1.8153",
      }],
    },
    {
      siren: "200056455",
      nom_raison_sociale: "COMMUNE DE MACHECOUL-SAINT-MEME",
      matching_etablissements: [{
        siret: "20005645500047", etat_administratif: "A", liste_enseignes: ["ECOLE PRIMAIRE PUBLIQUE JACQUES-YVES COUSTEAU"],
        adresse: "1 BD GABRIEL RELIQUET 44270 MACHECOUL-SAINT-MEME", code_postal: "44270", libelle_commune: "MACHECOUL-SAINT-MEME",
        latitude: "46.9965", longitude: "-1.8154",
      }],
    },
  ] };

  const query = buildNearbySearchQuery({
    latitude: 46.996561,
    longitude: -1.815374,
    radius: 0.25,
    name: "Super U",
    address: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME",
  });
  buildExternalSearchUrl(query, { codePostal: "44270" });
  assert.deepEqual(flattenExternalResults(payload), []);
});

test("Super U text fallback can recover SIDONAM after the API matched hidden trade-name/address evidence", () => {
  const payload = { results: [{
    siren: "410918080",
    nom_raison_sociale: "SIDONAM",
    matching_etablissements: [{
      siret: "41091808000020", etat_administratif: "A",
      adresse: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME", code_postal: "44270", libelle_commune: "MACHECOUL-SAINT-MEME",
    }],
  }] };
  buildExternalSearchUrl("super prises", { codePostal: "44270" });
  const candidates = flattenExternalResults(payload);
  assert.equal(candidates[0]?.siret, "41091808000020");
  assert.equal(candidates[0]?.raisonSociale, "SIDONAM");
});

test("nearby EHPAD keeps only the matching establishment and rejects unrelated Bouin addresses", () => {
  const payload = { results: [
    {
      siren: "894057140",
      nom_raison_sociale: "ASSOCIATION DES AMIS DE LA MADELEINE ET DE LA REYNERIE (ALAMAREY)",
      matching_etablissements: [{
        siret: "89405714000010", etat_administratif: "A",
        adresse: "EHPAD LA REYNERIE 8 RUE DU PAYS DE RETZ 85230 BOUIN", code_postal: "85230", libelle_commune: "BOUIN",
        latitude: "46.97414", longitude: "-1.99498",
      }],
    },
    {
      siren: "268500253",
      nom_raison_sociale: "EHPAD LA REYNERIE BOUIN",
      matching_etablissements: [
        {
          siret: "26850025300045", etat_administratif: "A", liste_enseignes: ["SOINS INFIRMIERS DOMICILE SSIDPA"],
          adresse: "14 RUE DU PAYS DE RETZ 85230 BOUIN", code_postal: "85230", libelle_commune: "BOUIN",
          latitude: "46.9745", longitude: "-1.9947",
        },
        {
          siret: "26850025300011", etat_administratif: "A", liste_enseignes: ["EHPAD"],
          adresse: "LA REYNERIE RUE DU PAYS DE RETZ 85230 BOUIN", code_postal: "85230", libelle_commune: "BOUIN",
          latitude: "46.97415", longitude: "-1.99499",
        },
      ],
    },
    {
      siren: "298503574",
      nom_raison_sociale: "ASS SYNDICALE AUTORISEE DE LA LOUIPPE",
      matching_etablissements: [{
        siret: "29850357400014", etat_administratif: "A",
        adresse: "MAIRIE PLACE DE L EGLISE 85230 BOUIN", code_postal: "85230", libelle_commune: "BOUIN",
        latitude: "46.9739", longitude: "-1.9951",
      }],
    },
    {
      siren: "103179834",
      nom_raison_sociale: "LA PARISIENNE",
      matching_etablissements: [{
        siret: "10317983400017", etat_administratif: "A",
        adresse: "19 RUE DU MARAIS DOUX 85230 BOUIN", code_postal: "85230", libelle_commune: "BOUIN",
        latitude: "46.9740", longitude: "-1.9950",
      }],
    },
  ] };

  const query = buildNearbySearchQuery({
    latitude: 46.974141,
    longitude: -1.994981,
    radius: 0.25,
    name: "EHPAD La Reynerie",
    address: "8bis Rue du Pays de Retz 85230 Bouin",
  });
  buildExternalSearchUrl(query, { codePostal: "85230" });
  const candidates = flattenExternalResults(payload);
  assert.deepEqual(candidates.map(item => item.siret), ["26850025300011"]);
});

test("nearby ranking keeps only O PRE D'VOUS and POM DE RAINETTE, not same-street neighbors", () => {
  const oPre = [
    { nomCommercial: "PH DISTRIBUTION", raisonSociale: "PH DISTRIBUTION", adresse: "LA MORTIERE 44270 SAINT-ETIENNE-DE-MER-MORTE", codePostal: "44270", commune: "SAINT-ETIENNE-DE-MER-MORTE", latitude: 46.99, longitude: -1.73, siret: "89306104400010" },
    { nomCommercial: "O PRE D'VOUS", nomUsuelDistinct: true, raisonSociale: "PH DISTRIBUTION", adresse: "24 RUE DES FOSSES 44270 LA MARNE", codePostal: "44270", commune: "LA MARNE", latitude: 46.997657, longitude: -1.736921, siret: "89306104400028" },
    { nomCommercial: "COIFF & MOI", raisonSociale: "COIFF & MOI", adresse: "26 RUE DES FOSSES 44270 LA MARNE", codePostal: "44270", commune: "LA MARNE", latitude: 46.9977, longitude: -1.7369, siret: "79825660800018" },
  ];
  assert.deepEqual(rankNearbyCandidates(oPre, {
    query: "ô Pré d’Vous", targetAddress: "24 Rue des Fosses 44270 La Marne", codePostal: "44270",
    latitude: 46.997657, longitude: -1.736921, radius: 0.25,
  }).map(item => item.siret), ["89306104400028"]);

  const rainette = [
    { nomCommercial: "PICOTI PICOTA", raisonSociale: "PICOTI PICOTA", adresse: "8 RUE DU FIEF DE LA REINE 85300 SALLERTAINE", codePostal: "85300", commune: "SALLERTAINE", latitude: 46.86, longitude: -1.95, siret: "88493583400017" },
    { nomCommercial: "POM' DE RAINETTE", nomUsuelDistinct: true, raisonSociale: "PICOTI PICOTA", adresse: "10 B RUE DES MARGOTINS 85300 SALLERTAINE", codePostal: "85300", commune: "SALLERTAINE", latitude: 46.868553, longitude: -1.94211, siret: "88493583400033" },
    { nomCommercial: "HILLEREAU PEINTURE", raisonSociale: "HILLEREAU PEINTURE", adresse: "10 RUE DES MARGOTINS 85300 SALLERTAINE", codePostal: "85300", commune: "SALLERTAINE", latitude: 46.8685, longitude: -1.9420, siret: "79342709700035" },
  ];
  assert.deepEqual(rankNearbyCandidates(rainette, {
    query: "CRECHE POM'DE RAINETTE", targetAddress: "10 bis Rue des Margotins 85300 Sallertaine", codePostal: "85300",
    latitude: 46.868553, longitude: -1.94211, radius: 0.25,
  }).map(item => item.siret), ["88493583400033"]);
});

test("O PRE D'VOUS branch is ranked before another PH DISTRIBUTION establishment in text fallback", () => {
  const payload = { results: [{
    siren: "893061044",
    nom_raison_sociale: "PH DISTRIBUTION",
    matching_etablissements: [
      { siret: "89306104400010", etat_administratif: "A", liste_enseignes: ["PH DISTRIBUTION"], adresse: "LA MORTIERE 44270 SAINT-ETIENNE-DE-MER-MORTE", code_postal: "44270", libelle_commune: "SAINT-ETIENNE-DE-MER-MORTE" },
      { siret: "89306104400028", etat_administratif: "A", liste_enseignes: ["O PRE D'VOUS"], adresse: "24 RUE DES FOSSES 44270 LA MARNE", code_postal: "44270", libelle_commune: "LA MARNE" },
    ],
  }] };
  buildExternalSearchUrl("o pre d vous", { codePostal: "44270" });
  const candidates = flattenExternalResults(payload);
  assert.equal(candidates[0].siret, "89306104400028");
});

test("POM' DE RAINETTE branch is ranked before the other PICOTI PICOTA establishments in text fallback", () => {
  const payload = { results: [{
    siren: "884935834",
    nom_raison_sociale: "PICOTI PICOTA",
    matching_etablissements: [
      { siret: "88493583400017", etat_administratif: "A", adresse: "8 RUE DU FIEF DE LA REINE 85300 SALLERTAINE", code_postal: "85300", libelle_commune: "SALLERTAINE" },
      { siret: "88493583400025", etat_administratif: "A", adresse: "IMPASSE DE LA CAILLAUDIERE 85300 SALLERTAINE", code_postal: "85300", libelle_commune: "SALLERTAINE" },
      { siret: "88493583400033", etat_administratif: "A", liste_enseignes: ["POM' DE RAINETTE"], nom_commercial: "POM' DE RAINETTE", adresse: "10 B RUE DES MARGOTINS 85300 SALLERTAINE", code_postal: "85300", libelle_commune: "SALLERTAINE" },
    ],
  }] };
  buildExternalSearchUrl("pom de rainette", { codePostal: "85300" });
  const candidates = flattenExternalResults(payload);
  assert.equal(candidates[0].siret, "88493583400033");
});

test("EHPAD identity outranks an association whose address happens to contain the EHPAD name in text fallback", () => {
  const candidates = [
    {
      nomCommercial: "ASSOCIATION DES AMIS DE LA MADELEINE ET DE LA REYNERIE (ALAMAREY)",
      raisonSociale: "ASSOCIATION DES AMIS DE LA MADELEINE ET DE LA REYNERIE (ALAMAREY)",
      adresse: "EHPAD LA REYNERIE 8 RUE DU PAYS DE RETZ 85230 BOUIN",
      codePostal: "85230",
      commune: "BOUIN",
      siret: "89405714000010",
    },
    {
      nomCommercial: "EHPAD",
      nomUsuelDistinct: true,
      raisonSociale: "EHPAD LA REYNERIE BOUIN",
      adresse: "LA REYNERIE RUE DU PAYS DE RETZ 85230 BOUIN",
      codePostal: "85230",
      commune: "BOUIN",
      siret: "26850025300011",
    },
    {
      nomCommercial: "SOINS INFIRMIERS DOMICILE SSIDPA",
      nomUsuelDistinct: true,
      raisonSociale: "EHPAD LA REYNERIE BOUIN",
      adresse: "14 RUE DU PAYS DE RETZ 85230 BOUIN",
      codePostal: "85230",
      commune: "BOUIN",
      siret: "26850025300045",
    },
  ];
  const ranked = rankExternalCandidates(candidates, "ehpad la reynerie bouin", "85230");
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
  buildExternalSearchUrl("test", { codePostal: "44000" });
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
    buildExternalSearchUrl("test", { departments: ["49"] });
    const candidates = flattenExternalResults(payload);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].departement, "49");
  } finally {
    setActiveDepartments(DEFAULT_DEPARTMENTS);
  }
});