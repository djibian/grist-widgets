import assert from "node:assert/strict";
import test from "node:test";
import { CONTACT_MATCH_KINDS, createContactCandidate } from "../contact-model.js";
import {
  CONTACT_CONFIDENCE,
  canonicalPhone,
  compareContactCandidates,
  contactConfidence,
  resolveContactCandidates,
  sameExactContactSet,
} from "../contact-ranking.js";

function candidate({
  source = "test",
  recordId = null,
  name = "Garage Martin",
  siret = "",
  address = "",
  latitude = null,
  longitude = null,
  telephone = "",
  courriel = "",
  siteWeb = "",
  kind = CONTACT_MATCH_KINDS.UNKNOWN,
  nameScore = null,
  distanceMeters = null,
  score = null,
} = {}) {
  return createContactCandidate({
    source: { id: source, label: source, recordType: "record", recordId },
    identity: { name, siret, address, latitude, longitude },
    contacts: { telephone, courriel, siteWeb },
    match: { kind, nameScore, distanceMeters, score },
  });
}

test("French phone canonicalization recognizes formatting variants but never prefix-only similarity", () => {
  assert.equal(canonicalPhone("02 40 12 34 56"), "+33240123456");
  assert.equal(canonicalPhone("+33 2 40 12 34 56"), "+33240123456");
  assert.equal(canonicalPhone("0033 2 40 12 34 56"), "+33240123456");
  assert.notEqual(canonicalPhone("02 40 12 34 56"), canonicalPhone("02 40 12 34 57"));
});

test("exact deduplication collapses only identical canonical contact sets and preserves provenance", () => {
  const exact = candidate({
    source: "osm",
    recordId: 1,
    siret: "12345678900011",
    telephone: "02 40 12 34 56",
    kind: CONTACT_MATCH_KINDS.EXACT_SIRET,
  });
  const duplicate = candidate({
    source: "overture",
    recordId: "abc",
    telephone: "+33 2 40 12 34 56",
    kind: CONTACT_MATCH_KINDS.NEARBY_NAME,
    nameScore: 0.95,
    distanceMeters: 20,
  });
  const similarOnly = candidate({
    source: "other-source",
    recordId: "xyz",
    telephone: "02 40 12 34 57",
    kind: CONTACT_MATCH_KINDS.NEARBY_NAME,
    nameScore: 0.95,
    distanceMeters: 20,
  });

  assert.equal(sameExactContactSet(exact, duplicate), true);
  assert.equal(sameExactContactSet(exact, similarOnly), false);

  const resolved = resolveContactCandidates([duplicate, similarOnly, exact], { siret: "12345678900011" });
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].source.id, "osm");
  assert.deepEqual(resolved[0].source.provenance.map(source => source.id), ["osm", "overture"]);
  assert.equal(resolved[0].contacts.telephone, "02 40 12 34 56");
});

test("partial contact overlap is not merged", () => {
  const phoneOnly = candidate({ telephone: "02 40 12 34 56" });
  const phoneAndEmail = candidate({ telephone: "+33 2 40 12 34 56", courriel: "contact@example.fr" });
  assert.equal(sameExactContactSet(phoneOnly, phoneAndEmail), false);
  assert.equal(resolveContactCandidates([phoneOnly, phoneAndEmail]).length, 2);
});

test("ranking follows SIRET then address then coordinates then name then postal/domain evidence", () => {
  const context = {
    siret: "12345678900011",
    name: "Garage Martin",
    address: "1 rue du Test 44140 Geneston",
    latitude: 47.055,
    longitude: -1.51,
    siteWeb: "https://garage-martin.fr",
  };
  const exactSiret = candidate({
    siret: "12345678900011",
    telephone: "01",
    kind: CONTACT_MATCH_KINDS.EXACT_SIRET,
  });
  const exactAddress = candidate({
    address: "1 rue du Test 44140 Geneston",
    telephone: "02",
    name: "Autre nom",
  });
  const coordinates = candidate({
    latitude: 47.0551,
    longitude: -1.5101,
    telephone: "03",
    name: "Garage",
  });
  const strongName = candidate({
    telephone: "04",
    name: "Garage Martin",
  });
  const postalDomain = candidate({
    address: "9 autre rue 44140 Geneston",
    telephone: "05",
    name: "Sans rapport",
    siteWeb: "https://garage-martin.fr",
  });

  const ordered = [postalDomain, strongName, coordinates, exactAddress, exactSiret]
    .sort((left, right) => compareContactCandidates(left, right, context));
  assert.deepEqual(ordered.map(item => item.contacts.telephone), ["01", "02", "03", "04", "05"]);
});

test("confidence labels are explicit and conservative", () => {
  const context = {
    siret: "12345678900011",
    name: "Garage Martin",
    latitude: 47.055,
    longitude: -1.51,
  };
  const exact = candidate({ siret: "12345678900011", telephone: "01", kind: CONTACT_MATCH_KINDS.EXACT_SIRET });
  const probable = candidate({
    name: "Garage Martin",
    latitude: 47.0551,
    longitude: -1.5101,
    telephone: "02",
  });
  const verify = candidate({ name: "Entreprise différente", telephone: "03" });

  assert.deepEqual(contactConfidence(exact, context), { level: CONTACT_CONFIDENCE.VERY_RELIABLE, label: "Très fiable" });
  assert.deepEqual(contactConfidence(probable, context), { level: CONTACT_CONFIDENCE.PROBABLE, label: "Probable" });
  assert.deepEqual(contactConfidence(verify, context), { level: CONTACT_CONFIDENCE.VERIFY, label: "À vérifier" });
});
