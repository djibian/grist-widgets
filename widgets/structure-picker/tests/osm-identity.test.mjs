import test from "node:test";
import assert from "node:assert/strict";
import { buildNearbyIdentityOverpassQuery, findOsmIdentityPois, rankIdentityPois } from "../osm-identity.js";

test("identity Overpass search does not require contact tags", () => {
  const query = buildNearbyIdentityOverpassQuery(46.998, -1.8155, 500);
  assert.match(query, /\["name"\]/);
  assert.match(query, /\["ref:FR:SIRET"\]/);
  assert.doesNotMatch(query, /contact:phone/);
});

test("OSM explicit SIRET POI is discovered by public name and distance", () => {
  const elements = [{
    type: "node", id: 1, lat: 46.99808, lon: -1.815576,
    tags: {
      name: "Super U Machecoul",
      "ref:FR:SIRET": "41091808000020",
      "addr:street": "Boulevard des Prises",
      "addr:postcode": "44270",
      "addr:city": "Machecoul-Saint-Même",
    },
  }, {
    type: "node", id: 2, lat: 46.9981, lon: -1.8155,
    tags: { name: "SLA", "ref:FR:SIRET": "52848646700038" },
  }];
  const result = rankIdentityPois(elements, {
    NomCommercial: "Super U Machecoul",
    Adresse: "Boulevard des Prises 44270 Machecoul-Saint-Même",
  }, { latitude: 46.996561, longitude: -1.815374, radius: 500 });
  assert.equal(result.length, 1);
  assert.equal(result[0].siret, "41091808000020");
});

test("identity lookup uses POST and falls back after a retryable 406", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return { ok: false, status: 406 };
    return {
      ok: true,
      status: 200,
      async json() {
        return { elements: [{
          type: "node", id: 1, lat: 46.99808, lon: -1.815576,
          tags: { name: "Super U Machecoul", "ref:FR:SIRET": "41091808000020" },
        }] };
      },
    };
  };

  const result = await findOsmIdentityPois({
    row: { NomCommercial: "Super U Machecoul" },
    latitude: 46.996561,
    longitude: -1.815374,
    radius: 500,
    fetchImpl,
    endpoints: ["https://primary.invalid/interpreter", "https://fallback.invalid/interpreter"],
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "POST");
  assert.match(calls[0].options.body, /^data=/);
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.equal(result.candidates[0].siret, "41091808000020");
});
