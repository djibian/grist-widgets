import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gristSource = await readFile(new URL("../grist.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("geographic criterion is first, enabled by default and stronger than diversity", () => {
  const geography = html.indexOf('id="criterion-geography"');
  const diversity = html.indexOf('id="criterion-diversity"');
  assert.ok(geography >= 0 && geography < diversity);
  assert.match(html, /id="criterion-geography" type="checkbox" checked/);
  assert.match(html, /id="priority-geography"[\s\S]*?<option value="forte" selected>Forte<\/option>/);
  assert.match(html, /id="criterion-diversity" type="checkbox" checked/);
  assert.match(html, /id="priority-diversity"[\s\S]*?<option value="moyenne" selected>Moyenne<\/option>/);
  assert.match(appSource, /geography:\s*\{\s*enabled:\s*true,\s*priority:\s*"forte"\s*\}/);
  assert.match(appSource, /diversity:\s*\{\s*enabled:\s*true,\s*priority:\s*"moyenne"\s*\}/);
});

test("Grist snapshot follows the real document structure", () => {
  assert.match(gristSource, /fetchOptionalRawTable\("Structures_de_stage"\)/);
  assert.match(gristSource, /address:\s*display\(row\.Adresse, ""\)/);
  assert.match(gristSource, /geocodeAddress\(text, \{ limit: 1 \}\)/);
  assert.match(gristSource, /const structureId = ref\(row\.Structure_de_stage\)/);
  assert.match(gristSource, /latitude:\s*finiteNumber\(row\.Latitude\)/);
  assert.match(gristSource, /longitude:\s*finiteNumber\(row\.Longitude\)/);
  assert.match(gristSource, /latitude:\s*structure\?\.latitude \?\? null/);
  assert.match(gristSource, /longitude:\s*structure\?\.longitude \?\? null/);
});

test("teacher geocoding happens only for geographic calculations and is repeated before apply", () => {
  assert.match(gristSource, /fetchSnapshot\(mappings, \{ geography = false \} = \{\}\)/);
  assert.match(appSource, /fetchSnapshot\(state\.mappings, \{[\s\S]*geography: state\.optimization\?\.geography\?\.enabled === true/);
  assert.match(gristSource, /fetchSnapshot\(mappings, \{ geography: plan\.criteria\?\.geography\?\.enabled === true \}\)/);
  assert.match(appSource, /analyzeClass\(state\.snapshot, cls\.id, periods\)/);
});

test("proposal exposes distance after geographic calculation", () => {
  assert.match(html, /<th>Distance<\/th>/);
  assert.match(appSource, /averageDistanceKm/);
  assert.match(appSource, /maxDistanceKm/);
  assert.match(appSource, /formatDistance\(row\.distanceKm\)/);
});
