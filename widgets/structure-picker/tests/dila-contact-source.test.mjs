import assert from "node:assert/strict";
import test from "node:test";
import { CONTACT_MATCH_KINDS } from "../contact-model.js";
import {
  buildDilaSearchUrl,
  dilaContactSource,
  dilaRecordToCandidate,
} from "../contact-sources/dila.js";

function record(overrides = {}) {
  return {
    id: "dila-nantes",
    nom: "Mairie - Nantes",
    siren: "214401093",
    siret: "21440109300015",
    telephone: JSON.stringify([{ valeur: "02 40 41 90 00", description: "" }]),
    adresse_courriel: "contact@mairie-nantes.fr;autre@example.fr",
    site_internet: JSON.stringify([
      { libelle: "", valeur: "https://metropole.nantes.fr/" },
      { libelle: "Démarches", valeur: "https://eservices.nantesmetropole.fr/" },
    ]),
    adresse: JSON.stringify([{
      type_adresse: "Adresse",
      complement1: "",
      complement2: "",
      numero_voie: "29 rue de Strasbourg",
      service_distribution: "",
      code_postal: "44000",
      nom_commune: "Nantes",
      longitude: "-1.5537651",
      latitude: "47.2186317",
    }]),
    ...overrides,
  };
}

test("DILA builds an exact SIRET query before name search", () => {
  const exact = new URL(buildDilaSearchUrl({ siret: "214 401 093 00015", name: "Mairie Nantes" }));
  assert.equal(exact.searchParams.get("where"), 'siret="21440109300015"');

  const byName = new URL(buildDilaSearchUrl({ name: 'Mairie "Nantes"' }));
  assert.equal(byName.searchParams.get("where"), 'search(nom,"Mairie \\"Nantes\\"")');
});

test("DILA parses official contacts and marks an exact SIRET as very strong evidence", () => {
  const candidate = dilaRecordToCandidate(record(), {
    siret: "21440109300015",
    name: "Mairie Nantes",
  });
  assert.equal(candidate.source.id, "dila");
  assert.equal(candidate.source.recordId, "dila-nantes");
  assert.equal(candidate.identity.siret, "21440109300015");
  assert.equal(candidate.identity.address, "29 rue de Strasbourg, 44000 Nantes");
  assert.equal(candidate.identity.latitude, 47.2186317);
  assert.equal(candidate.contacts.telephone, "02 40 41 90 00");
  assert.equal(candidate.contacts.courriel, "contact@mairie-nantes.fr");
  assert.equal(candidate.contacts.siteWeb, "https://metropole.nantes.fr/");
  assert.equal(candidate.match.kind, CONTACT_MATCH_KINDS.EXACT_SIRET);
});

test("DILA safely ignores malformed structured fields and contact-less records", () => {
  assert.equal(dilaRecordToCandidate(record({
    telephone: "not-json",
    adresse_courriel: "",
    site_internet: "also-not-json",
  }), { name: "Mairie Nantes" }), null);
});

test("DILA source forwards AbortSignal and returns canonical candidates", async () => {
  const controller = new AbortController();
  let seenSignal = null;
  const fetchImpl = async (_url, options) => {
    seenSignal = options.signal;
    return {
      ok: true,
      async json() { return { results: [record()] }; },
    };
  };
  const result = await dilaContactSource.search(
    { siret: "21440109300015", name: "Mairie Nantes" },
    { fetchImpl, signal: controller.signal },
  );
  assert.equal(seenSignal, controller.signal);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source.id, "dila");
});
