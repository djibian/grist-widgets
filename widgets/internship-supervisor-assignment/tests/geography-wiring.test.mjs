import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gristSource = await readFile(new URL("../grist.js", import.meta.url), "utf8");
const mappingSource = await readFile(new URL("../mapping.js", import.meta.url), "utf8");
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

test("Affectation consumes persisted validated coordinates and never geocodes teachers", () => {
  assert.doesNotMatch(gristSource, /geocodeAddress|teacherGeocodeCache|geocodeTeacherAddress/);
  assert.match(mappingSource, /key: "teacherLatitude"/);
  assert.match(mappingSource, /key: "teacherLongitude"/);
  assert.match(mappingSource, /key: "teacherLocationValidated"/);
  assert.match(mappingSource, /Localisation_validee/);
  assert.match(gristSource, /locationValidated:\s*boolValue\(readSecondary\(row, "teacherLocationValidated"\)\)/);
});

test("Grist snapshot follows the stage to structure reference through explicit mappings", () => {
  assert.match(mappingSource, /key: "stageStructure"[\s\S]*refTarget: "Structures_de_stage"/);
  assert.match(mappingSource, /key: "structureLatitude"/);
  assert.match(mappingSource, /key: "structureLongitude"/);
  assert.match(gristSource, /const structureId = ref\(readSecondary\(row, "stageStructure"\)\)/);
  assert.match(gristSource, /latitude:\s*structure\?\.latitude \?\? null/);
  assert.match(gristSource, /longitude:\s*structure\?\.longitude \?\? null/);
});

test("geographic precheck is visible before calculation", () => {
  assert.match(appSource, /analyzeClass\(state\.snapshot, cls\.id, periods, state\.optimization\)/);
  assert.match(appSource, /enseignant\(s\) localisé\(s\) et validé\(s\)/);
  assert.match(appSource, /structure\(s\) exploitable\(s\)/);
  assert.doesNotMatch(appSource, /Géocodage des enseignants/);
});

test("proposal exposes distance magnitude and scoring trade-off", () => {
  assert.match(html, /<th>Distance<\/th>/);
  assert.match(appSource, /totalDistanceKm/);
  assert.match(appSource, /averageDistanceKm/);
  assert.match(appSource, /maxDistanceKm/);
  assert.match(appSource, /repeatEquivalentKm/);
  assert.match(appSource, /formatDistance\(row\.distanceKm\)/);
});
