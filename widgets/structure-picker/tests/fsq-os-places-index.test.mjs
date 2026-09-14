import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFsqFeature } from "../../../scripts/generate-fsq-os-places-index.mjs";

function feature(overrides = {}) {
  return {
    type: "Feature",
    properties: {
      fsq_place_id: "fsq-44",
      name: "Entreprise test",
      address: "1 rue du Test",
      locality: "Geneston",
      postcode: "44140",
      country: "FR",
      tel: "+33240123456",
      website: "example.test",
      email: "contact@example.test",
      date_closed: "",
      ...overrides,
    },
    geometry: { type: "Point", coordinates: [-1.51, 47.05] },
  };
}

test("FSQ normalization keeps useful French contacts", () => {
  const item = normalizeFsqFeature(feature(), ["44", "85"]);
  assert.equal(item.department, "44");
  assert.equal(item.record.recordId, "fsq-44");
  assert.equal(item.record.telephone, "+33240123456");
  assert.equal(item.record.courriel, "contact@example.test");
});

test("FSQ normalization is conservative", () => {
  assert.equal(normalizeFsqFeature(feature({ country: "BE" }), ["44"]), null);
  assert.equal(normalizeFsqFeature(feature({ date_closed: "2026-01-01" }), ["44"]), null);
  assert.equal(normalizeFsqFeature(feature({ tel: "", website: "", email: "" }), ["44"]), null);
  assert.equal(normalizeFsqFeature(feature({ postcode: "20100" }), ["2A", "2B"]), null);
});
