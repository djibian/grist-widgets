import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gristSource = await readFile(new URL("../grist.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("geographic criterion is available and disabled by default", () => {
  assert.match(html, /id="criterion-geography"/);
  assert.match(html, /id="priority-geography"/);
  assert.doesNotMatch(html, /Proximité géographique[\s\S]{0,120}À venir/);
  assert.match(appSource, /geography:\s*\{\s*enabled:\s*false,\s*priority:\s*"moyenne"\s*\}/);
});

test("Grist snapshot links stages to structure coordinates and teacher coordinates", () => {
  assert.match(gristSource, /fetchOptionalRawTable\("Structures_de_stage"\)/);
  assert.match(gristSource, /latitude:\s*finiteNumber\(row\.Latitude\)/);
  assert.match(gristSource, /longitude:\s*finiteNumber\(row\.Longitude\)/);
  assert.match(gristSource, /const structureId = ref\(row\.Structure\)/);
  assert.match(gristSource, /latitude:\s*structure\?\.latitude \?\? null/);
  assert.match(gristSource, /longitude:\s*structure\?\.longitude \?\? null/);
});

test("proposal exposes distance only after geographic calculation", () => {
  assert.match(html, /<th>Distance<\/th>/);
  assert.match(appSource, /averageDistanceKm/);
  assert.match(appSource, /maxDistanceKm/);
  assert.match(appSource, /formatDistance\(row\.distanceKm\)/);
});
