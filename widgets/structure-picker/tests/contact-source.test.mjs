import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CONTACT_MATCH_KINDS } from "../contact-model.js";
import { osmContactSource } from "../contact-sources/osm.js";

test("OSM exposes the minimal contact-source interface", () => {
  assert.equal(osmContactSource.id, "osm");
  assert.equal(osmContactSource.label, "OpenStreetMap");
  assert.equal(typeof osmContactSource.canSearch, "function");
  assert.equal(typeof osmContactSource.search, "function");
  assert.equal(Object.isFrozen(osmContactSource), true);
});

test("OSM availability preserves the current SIRET or name-plus-coordinates rule", () => {
  assert.equal(osmContactSource.canSearch({ siret: "12345678900011" }), true);
  assert.equal(osmContactSource.canSearch({ name: "Garage Martin", latitude: 47.1, longitude: -1.8 }), true);
  assert.equal(osmContactSource.canSearch({ name: "Garage Martin" }), false);
  assert.equal(osmContactSource.canSearch({ latitude: 47.1, longitude: -1.8 }), false);
  assert.equal(osmContactSource.canSearch({ name: "Garage Martin", latitude: "", longitude: "" }), false);
});

test("OSM source preserves exact-SIRET short-circuit and maps it to the common model", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        elements: [{
          type: "node",
          id: 1,
          tags: {
            name: "Garage Martin",
            "ref:FR:SIRET": "12345678900011",
            phone: "02 40 00 00 00",
          },
        }],
      }),
    };
  };

  const result = await osmContactSource.search({
    siret: "12345678900011",
    name: "Garage Martin",
    latitude: 47.1,
    longitude: -1.8,
  }, { fetchImpl });

  assert.deepEqual(result.source, { id: "osm", label: "OpenStreetMap" });
  assert.equal(result.candidates[0]?.source.recordType, "node");
  assert.equal(result.candidates[0]?.source.recordId, 1);
  assert.equal(result.candidates[0]?.identity.siret, "12345678900011");
  assert.equal(result.candidates[0]?.contacts.telephone, "02 40 00 00 00");
  assert.equal(result.candidates[0]?.match.kind, CONTACT_MATCH_KINDS.EXACT_SIRET);
  assert.equal(calls, 1);
});

test("OSM source preserves nearby fallback and maps its evidence to the common model", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, status: 200, json: async () => ({ elements: [] }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        elements: [{
          type: "node",
          id: 2,
          lat: 47.1002,
          lon: -1.8,
          tags: { name: "Garage Martin", email: "contact@example.fr" },
        }],
      }),
    };
  };

  const result = await osmContactSource.search({
    siret: "12345678900011",
    name: "Garage Martin",
    latitude: 47.1,
    longitude: -1.8,
  }, { fetchImpl });

  assert.equal(result.candidates[0]?.match.kind, CONTACT_MATCH_KINDS.NEARBY_NAME);
  assert.equal(result.candidates[0]?.contacts.courriel, "contact@example.fr");
  assert.equal(result.candidates[0]?.identity.name, "Garage Martin");
  assert.ok(Number.isFinite(result.candidates[0]?.match.distanceMeters));
  assert.equal(calls, 2);
});

test("contact UI depends on the multi-source orchestrator and trusted presentation layer, not directly on OSM", async () => {
  const source = await readFile(new URL("../contacts-experiment.js", import.meta.url), "utf8");
  assert.match(source, /availableContactSources/);
  assert.match(source, /searchContactSources/);
  assert.match(source, /selectContactSuggestions/);
  assert.doesNotMatch(source, /contactSourceSummary/);
  assert.doesNotMatch(source, /osmContactSource/);
  assert.doesNotMatch(source, /findOsmContacts/);
  assert.doesNotMatch(source, /candidate\.confidence/);
});
