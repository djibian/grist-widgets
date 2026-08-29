import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNearbyOverpassQuery,
  buildSiretOverpassQuery,
  distanceMeters,
  exactSiretContacts,
  extractOsmContact,
  findOsmContacts,
  rankNearbyContacts,
} from "../osm.js";

test("exact SIRET query is bounded to the French SIRET tag", () => {
  const query = buildSiretOverpassQuery("123 456 789 00011");
  assert.match(query, /ref:FR:SIRET/);
  assert.match(query, /12345678900011/);
  assert.equal(buildSiretOverpassQuery("123456789"), "");
});

test("nearby query requires real coordinates and only asks named contact objects", () => {
  const query = buildNearbyOverpassQuery(47.1, -1.8, 300);
  assert.match(query, /around:300,47\.1,-1\.8/);
  assert.match(query, /\["name"\]\["contact:phone"\]/);
  assert.match(query, /\["name"\]\["contact:email"\]/);
  assert.match(query, /\["name"\]\["contact:website"\]/);
  assert.equal(buildNearbyOverpassQuery("", ""), "");
  assert.equal(buildNearbyOverpassQuery(null, null), "");
  assert.equal(distanceMeters(47.1, -1.8, null, null), Infinity);
});

test("OSM contact extraction accepts common and contact-prefixed tags", () => {
  const result = extractOsmContact({
    type: "node",
    id: 1,
    lat: 47.1,
    lon: -1.8,
    tags: {
      name: "Garage Martin",
      "ref:FR:SIRET": "12345678900011",
      "contact:phone": "+33 2 40 00 00 00",
      email: "contact@example.fr",
      "contact:website": "https://example.fr",
    },
  });
  assert.equal(result.siret, "12345678900011");
  assert.equal(result.telephone, "+33 2 40 00 00 00");
  assert.equal(result.courriel, "contact@example.fr");
  assert.equal(result.siteWeb, "https://example.fr");
});

test("exact SIRET contacts ignore elements without useful public contact", () => {
  const elements = [
    { type: "node", id: 1, tags: { "ref:FR:SIRET": "12345678900011", name: "Garage Martin" } },
    { type: "node", id: 2, tags: { "ref:FR:SIRET": "12345678900011", name: "Garage Martin", phone: "02 40 00 00 00" } },
  ];
  const candidates = exactSiretContacts(elements, "12345678900011");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].confidence, "siret");
});

test("nearby ranking favors a similar business name over an unrelated closer POI", () => {
  const elements = [
    { type: "node", id: 1, lat: 47.1001, lon: -1.8, tags: { name: "Boulangerie Dupont", phone: "1" } },
    { type: "node", id: 2, lat: 47.1004, lon: -1.8, tags: { name: "Garage Martin Automobiles", phone: "2" } },
  ];
  const candidates = rankNearbyContacts(elements, { name: "Garage Martin", latitude: 47.1, longitude: -1.8 });
  assert.equal(candidates[0]?.osmId, 2);
  assert.equal(candidates[0]?.confidence, "nearby");
});

test("contact lookup stops after an exact SIRET hit", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ elements: [{ type: "node", id: 1, tags: { name: "Garage Martin", "ref:FR:SIRET": "12345678900011", phone: "02 40 00 00 00" } }] }),
    };
  };
  const result = await findOsmContacts({ siret: "12345678900011", name: "Garage Martin", latitude: 47.1, longitude: -1.8, fetchImpl });
  assert.equal(result.mode, "siret");
  assert.equal(calls, 1);
});

test("contact lookup falls back to nearby name matching when exact SIRET has no contact", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, status: 200, json: async () => ({ elements: [] }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ elements: [{ type: "node", id: 2, lat: 47.1002, lon: -1.8, tags: { name: "Garage Martin", email: "contact@example.fr" } }] }),
    };
  };
  const result = await findOsmContacts({ siret: "12345678900011", name: "Garage Martin", latitude: 47.1, longitude: -1.8, fetchImpl });
  assert.equal(result.mode, "nearby");
  assert.equal(result.candidates[0]?.courriel, "contact@example.fr");
  assert.equal(calls, 2);
});
