import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTACT_MATCH_KINDS,
  contactSourceSummary,
  createContactCandidate,
  isExactSiretCandidate,
  isNearbyNameCandidate,
} from "../contact-model.js";

test("canonical contact candidate separates provenance, identity, contacts and match evidence", () => {
  const candidate = createContactCandidate({
    source: { id: "osm", label: "OpenStreetMap", recordType: "node", recordId: 42 },
    identity: {
      name: " Garage Martin ",
      siret: "12345678900011",
      address: "1 rue du Test",
      latitude: "47.1",
      longitude: -1.8,
    },
    contacts: {
      telephone: " 02 40 00 00 00 ",
      courriel: "contact@example.fr",
      siteWeb: "https://example.fr",
    },
    match: {
      kind: CONTACT_MATCH_KINDS.EXACT_SIRET,
      score: 1,
    },
  });

  assert.deepEqual(candidate.source, {
    id: "osm",
    label: "OpenStreetMap",
    recordType: "node",
    recordId: 42,
  });
  assert.equal(candidate.identity.name, "Garage Martin");
  assert.equal(candidate.identity.latitude, 47.1);
  assert.equal(candidate.contacts.telephone, "02 40 00 00 00");
  assert.equal(candidate.match.kind, CONTACT_MATCH_KINDS.EXACT_SIRET);
  assert.equal(isExactSiretCandidate(candidate), true);
  assert.equal(isNearbyNameCandidate(candidate), false);
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.source), true);
  assert.equal(Object.isFrozen(candidate.identity), true);
  assert.equal(Object.isFrozen(candidate.contacts), true);
  assert.equal(Object.isFrozen(candidate.match), true);
});

test("canonical model keeps matching evidence distinct from source provenance", () => {
  const candidate = createContactCandidate({
    source: { id: "osm", label: "OpenStreetMap", recordType: "way", recordId: 99 },
    identity: { name: "Garage Martin" },
    contacts: { courriel: "contact@example.fr" },
    match: {
      kind: CONTACT_MATCH_KINDS.NEARBY_NAME,
      score: 0.82,
      nameScore: 0.9,
      distanceMeters: 126.4,
    },
  });

  assert.equal(candidate.source.recordId, 99);
  assert.equal(candidate.match.nameScore, 0.9);
  assert.equal(candidate.match.distanceMeters, 126.4);
  assert.equal(contactSourceSummary(candidate), "OpenStreetMap · proximité + nom · 126 m");
});

test("source summary preserves the existing exact-SIRET wording", () => {
  const candidate = createContactCandidate({
    source: { id: "osm", label: "OpenStreetMap" },
    match: { kind: CONTACT_MATCH_KINDS.EXACT_SIRET },
  });
  assert.equal(contactSourceSummary(candidate), "OpenStreetMap · SIRET identique");
});
