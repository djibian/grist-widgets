import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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

test("OSM source preserves exact-SIRET short-circuit behavior", async () => {
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

  assert.equal(result.mode, "siret");
  assert.equal(result.candidates[0]?.confidence, "siret");
  assert.equal(calls, 1);
});

test("OSM source preserves nearby fallback behavior", async () => {
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

  assert.equal(result.mode, "nearby");
  assert.equal(result.candidates[0]?.confidence, "nearby");
  assert.equal(result.candidates[0]?.courriel, "contact@example.fr");
  assert.equal(calls, 2);
});

test("contact UI depends on the source adapter, not directly on the OSM engine", async () => {
  const source = await readFile(new URL("../contacts-experiment.js", import.meta.url), "utf8");
  assert.match(source, /import \{ osmContactSource \} from "\.\/contact-sources\/osm\.js"/);
  assert.match(source, /CONTACT_SOURCE\.canSearch/);
  assert.match(source, /CONTACT_SOURCE\.search/);
  assert.doesNotMatch(source, /findOsmContacts/);
});
