import assert from "node:assert/strict";
import test from "node:test";
import { CONTACT_MATCH_KINDS, createContactCandidate } from "../contact-model.js";
import { selectContactSuggestions } from "../contact-presentation.js";

function candidate({
  source,
  label = source,
  telephone = "",
  courriel = "",
  siteWeb = "",
  siret = "",
  address = "",
  name = "Garage Martin",
  kind = CONTACT_MATCH_KINDS.UNKNOWN,
  nameScore = null,
  distanceMeters = null,
} = {}) {
  return createContactCandidate({
    source: { id: source, label, recordType: "record", recordId: source },
    identity: { name, siret, address },
    contacts: { telephone, courriel, siteWeb },
    match: { kind, nameScore, distanceMeters },
  });
}

test("excludes verify-quality candidates and keeps at most one value per field", () => {
  const context = { name: "Garage Martin", address: "1 rue du Test 44140 Geneston" };
  const verify = candidate({ source: "weak", telephone: "01 02 03 04 05", name: "Autre société" });
  const probable = candidate({ source: "good", telephone: "02 40 12 34 56", address: context.address });
  const alternative = candidate({ source: "other", telephone: "02 40 99 99 99", address: context.address });

  const suggestions = selectContactSuggestions([verify, alternative, probable], context);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].key, "telephone");
  assert.notEqual(suggestions[0].value, "01 02 03 04 05");
  assert.equal(suggestions[0].confidence.label, "Probable");
});

test("selects independently one phone, one email and one website", () => {
  const context = { siret: "12345678900011", name: "Garage Martin" };
  const exact = candidate({
    source: "dila",
    siret: context.siret,
    telephone: "02 40 12 34 56",
    kind: CONTACT_MATCH_KINDS.EXACT_SIRET,
  });
  const probable = candidate({
    source: "overture",
    courriel: "contact@example.fr",
    siteWeb: "https://example.fr",
    nameScore: 0.95,
    distanceMeters: 30,
  });

  const suggestions = selectContactSuggestions([probable, exact], context);
  assert.deepEqual(suggestions.map(item => item.key), ["telephone", "courriel", "siteWeb"]);
  assert.equal(suggestions[0].confidence.label, "Très fiable");
  assert.equal(suggestions[1].confidence.label, "Probable");
});

test("aggregates sources that publish the exact same retained value", () => {
  const context = { address: "1 rue du Test 44140 Geneston" };
  const dila = candidate({ source: "dila", label: "Service-Public.fr", telephone: "02 40 12 34 56", address: context.address });
  const osm = candidate({ source: "osm", label: "OpenStreetMap", telephone: "+33 2 40 12 34 56", address: context.address });

  const [suggestion] = selectContactSuggestions([osm, dila], context);
  assert.equal(suggestion.key, "telephone");
  assert.deepEqual(new Set(suggestion.provenance.map(source => source.label)), new Set(["Service-Public.fr", "OpenStreetMap"]));
});
