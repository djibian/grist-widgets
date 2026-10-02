import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExternalSearchUrl,
  buildOfficialIdentifierSearchRequest,
  buildOfficialNearbySearchRequest,
  buildOfficialTextSearchRequest,
  candidateFrom,
  extractLocationFromAddress,
  extractOfficialCandidates,
  flattenExternalResults,
  normalize,
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

test("DINUM candidate preserves every public alias and usable coordinates", () => {
  const candidate = candidateFrom({ siren: "123456789", nom_raison_sociale: "MARTIN AUTOMOBILES" }, {
    siret: "12345678900011", etat_administratif: "A", liste_enseignes: ["GARAGE MARTIN", "MARTIN SERVICE"], nom_commercial: "MARTIN AUTO", adresse: "12 RUE DES ARTISANS 44270 MACHECOUL-SAINT-MEME", code_postal: "44270", libelle_commune: "MACHECOUL-SAINT-MEME", activite_principale: "45.20A", latitude: "47.1", longitude: "-1.8",
  });
  assert.equal(candidate.nomCommercial, "GARAGE MARTIN");
  assert.equal(candidate.nomUsuelDistinct, true);
  assert.deepEqual(candidate.aliases, ["GARAGE MARTIN", "MARTIN SERVICE", "MARTIN AUTO"]);
  assert.equal(candidate.raisonSociale, "MARTIN AUTOMOBILES");
  assert.equal(candidate.latitude, 47.1);
  assert.equal(candidate.longitude, -1.8);
});

test("blank coordinates stay unknown instead of becoming zero", () => {
  const candidate = candidateFrom({ siren: "123456789", nom_raison_sociale: "TEST" }, {
    siret: "12345678900011", etat_administratif: "A", code_postal: "44000", latitude: "", longitude: null,
  });
  assert.equal(candidate.latitude, null);
  assert.equal(candidate.longitude, null);
});

test("FINESS identifiers belong only to the returned establishment, including alphanumeric IDs", () => {
  const unit = { siren: "268500253", nom_complet: "EHPAD", complements: { liste_finess: ["850002163"] } };
  const site = { siret: "26850025300011", code_postal: "85230", liste_finess: ["850002163", "850002163", "2A0000123", "invalid"] };
  assert.deepEqual(candidateFrom(unit, site).finessIds, ["850002163", "2A0000123"]);
  assert.deepEqual(candidateFrom(unit, { ...site, liste_finess: null }).finessIds, [], "no legal-unit FINESS inheritance");
});

test("legal name is only a fallback when no usual name is published", () => {
  const candidate = candidateFrom({ siren: "123456789", nom_raison_sociale: "MARTIN AUTOMOBILES SARL" }, {
    siret: "12345678900011", etat_administratif: "A", code_postal: "44000",
  });
  assert.equal(candidate.nomCommercial, "MARTIN AUTOMOBILES SARL");
  assert.equal(candidate.nomUsuelDistinct, false);
});

test("identity extraction never silently substitutes the legal-unit seat", () => {
  const payload = { results: [{
    siren: "111111111", nom_raison_sociale: "TEST",
    matching_etablissements: [],
    siege: { siret: "11111111100099", etat_administratif: "A", code_postal: "44000" },
  }] };
  assert.deepEqual(extractOfficialCandidates(payload).items, []);
  assert.equal(flattenExternalResults(payload)[0]?.siret, "11111111100099");
});

test("exact SIRET validation may use the matching seat record only for that SIRET", () => {
  const payload = { results: [{
    siren: "111111111", nom_raison_sociale: "TEST",
    matching_etablissements: [],
    siege: { siret: "11111111100099", etat_administratif: "A", code_postal: "44000" },
  }] };
  const extracted = extractOfficialCandidates(payload, { requestedSiret: "11111111100099" });
  assert.equal(extracted.items[0]?.siret, "11111111100099");
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

test("identity request builders are immutable and keep their own full context", () => {
  const text = buildOfficialTextSearchRequest("Super U", { codePostal: "44270" });
  const nearby = buildOfficialNearbySearchRequest({ latitude: 46.996561, longitude: -1.815374, radius: 0.5 });
  const id = buildOfficialIdentifierSearchRequest("41091808000020");
  assert.ok(Object.isFrozen(text));
  assert.equal(new URL(text.url).searchParams.get("per_page"), "25");
  assert.equal(new URL(text.url).searchParams.get("limite_matching_etablissements"), "100");
  assert.equal(new URL(text.url).searchParams.get("code_postal"), "44270");
  assert.equal(new URL(nearby.url).pathname, "/near_point");
  assert.equal(nearby.radius, 0.5);
  assert.equal(id.kind, "siret");
  assert.equal(id.requestedSiret, "41091808000020");
});

test("coverage exposes pagination instead of fabricating completeness", () => {
  const payload = { total_results: 51, results: [] };
  const extracted = extractOfficialCandidates(payload, { page: 1, perPage: 25 });
  assert.equal(extracted.coverage.hasNextPage, true);
  assert.equal(extracted.coverage.complete, false);
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
