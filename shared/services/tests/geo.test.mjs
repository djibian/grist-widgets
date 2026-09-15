import test from "node:test";
import assert from "node:assert/strict";
import {
  EARTH_MEAN_RADIUS_KM,
  haversineDistanceKm,
  validCoordinates,
} from "../geo.js";

test("shared coordinate validation accepts only finite in-range numbers", () => {
  assert.equal(validCoordinates(47.1, -1.5), true);
  assert.equal(validCoordinates(NaN, -1.5), false);
  assert.equal(validCoordinates(91, -1.5), false);
  assert.equal(validCoordinates(47.1, 181), false);
  assert.equal(validCoordinates("47.1", -1.5), false);
});

test("shared Haversine distance stays realistic and symmetric", () => {
  const aToB = haversineDistanceKm(47.061, -1.51, 47.218, -1.553);
  const bToA = haversineDistanceKm(47.218, -1.553, 47.061, -1.51);
  assert.ok(aToB > 17 && aToB < 19);
  assert.ok(Math.abs(aToB - bToA) < 1e-12);
  assert.equal(haversineDistanceKm(null, -1.51, 47.218, -1.553), null);
  assert.ok(EARTH_MEAN_RADIUS_KM > 6370 && EARTH_MEAN_RADIUS_KM < 6372);
});
