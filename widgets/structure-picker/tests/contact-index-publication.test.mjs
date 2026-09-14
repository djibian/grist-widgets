import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeDepartments } from "../departments.js";

const CONFIG_URL = new URL("../contact-indexes/publication-config.json", import.meta.url);

async function publicationConfig() {
  return JSON.parse(await readFile(CONFIG_URL, "utf8"));
}

test("contact index publication scope is explicit and valid", async () => {
  const config = await publicationConfig();
  assert.equal(config.schemaVersion, 1);
  assert.ok(Array.isArray(config.departments));
  assert.ok(config.departments.length > 0);
  assert.deepEqual(
    normalizeDepartments(config.departments, []),
    config.departments,
    "publication departments must already be valid, unique and ordered",
  );
});

test("Overture publication bbox is a finite west,south,east,north extent", async () => {
  const config = await publicationConfig();
  assert.ok(Array.isArray(config.overtureBBox));
  assert.equal(config.overtureBBox.length, 4);
  assert.ok(config.overtureBBox.every(Number.isFinite));
  const [west, south, east, north] = config.overtureBBox;
  assert.ok(west < east);
  assert.ok(south < north);
  assert.ok(west >= -180 && east <= 180);
  assert.ok(south >= -90 && north <= 90);
});
