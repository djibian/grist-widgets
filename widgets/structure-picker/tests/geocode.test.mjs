import test from "node:test";
import assert from "node:assert/strict";
import { buildGeocodeUrl, geocodeResultsFromPayload } from "../geocode.js";

test("geocoder targets IGN address index", () => {
  const url = new URL(buildGeocodeUrl("5 route de Saint-Même 44270 Machecoul"));
  assert.equal(url.hostname, "data.geopf.fr");
  assert.equal(url.searchParams.get("index"), "address");
});

test("geocoder exposes normalized address and map coordinates", () => {
  const results = geocodeResultsFromPayload({ features: [{ geometry: { coordinates: [-1.82, 46.99] }, properties: { label: "5 Route de Saint-Même 44270 Machecoul-Saint-Même", score: 0.91, postcode: "44270", city: "Machecoul-Saint-Même" } }] });
  assert.equal(results[0].adresse, "5 Route de Saint-Même 44270 Machecoul-Saint-Même");
  assert.equal(results[0].latitude, 46.99);
  assert.equal(results[0].longitude, -1.82);
});
