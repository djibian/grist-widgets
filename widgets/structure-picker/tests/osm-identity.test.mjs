import test from "node:test";
import assert from "node:assert/strict";
import { buildNearbyIdentityOverpassQuery, rankIdentityPois } from "../osm-identity.js";

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
