import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const generator = fileURLToPath(new URL("../../../scripts/generate-osm-finess-positions.py", import.meta.url));
const source = JSON.parse(await readFile(new URL("./fixtures/ehpad-osm.json", import.meta.url), "utf8"));
const point = source.elements[0];

async function setup(t, payload) {
  const directory = await mkdtemp(path.join(tmpdir(), "osm-finess-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, "source.json");
  const output = path.join(directory, "published");
  await writeFile(input, JSON.stringify(payload));
  const run = () => spawnSync("python3", [generator, "--input", input, "--output", output], { encoding: "utf8" });
  return { input, output, run };
}

test("the generic generator publishes the real point unchanged, indexes other departments and excludes address/area/lifecycle geometries", async t => {
  const other = { ...point, id: 101, tags: { ...point.tags, name: "Autre établissement", "ref:FR:FINESS": "440000001", "ref:FR:SIRET": "12345678900011" } };
  const { output, run } = await setup(t, { ...source, elements: [point, other,
    { ...point, id: 102, type: "way", center: { lat: point.lat, lon: point.lon } },
    { ...point, id: 103, tags: { ...point.tags, highway: "residential" } },
    { ...point, id: 104, tags: { ...point.tags, place: "village" } },
    { ...point, id: 105, tags: { ...point.tags, "disused:amenity": "social_facility" } },
    { ...point, id: 106, timestamp: undefined },
    { ...point, id: 107, tags: { ...point.tags, "ref:FR:FINESS": "850002163;invalid" } },
  ] });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(output)).sort(), ["440000.json", "850002.json"]);
  const payload = JSON.parse(await readFile(path.join(output, "850002.json"), "utf8"));
  assert.equal(payload.recordCount, 1);
  assert.equal(payload.source.generatedAt, source.osm3s.timestamp_osm_base);
  assert.doesNotMatch(payload.source.query, /Bouin|Reynerie|850002163/);
  const published = JSON.parse(await readFile(new URL("../site-position-indexes/osm-finess/850002.json", import.meta.url), "utf8"));
  assert.deepEqual(payload.records[0], published.records.find(record => record.id === point.id));
  assert.equal(payload.records[0].tags.source, point.tags.source);
  assert.equal(Object.hasOwn(payload.records[0], "user"), false);
});

test("a partial or undated upstream response cannot replace already published position evidence", async t => {
  const { input, output, run } = await setup(t, source);
  assert.equal(run().status, 0);
  const before = await readFile(path.join(output, "850002.json"), "utf8");
  for (const payload of [{ ...source, remark: "runtime error: Query timed out" }, { ...source, osm3s: {} },
    { ...source, elements: [point, point] }]) {
    await writeFile(input, JSON.stringify(payload));
    assert.notEqual(run().status, 0);
    assert.equal(await readFile(path.join(output, "850002.json"), "utf8"), before);
  }
});

test("an oversized point shard fails before publishing a partial replacement", async t => {
  const { input, output, run } = await setup(t, source);
  assert.equal(run().status, 0);
  const before = await readFile(path.join(output, "850002.json"), "utf8");
  await writeFile(input, JSON.stringify({ ...source, elements: [{ ...point, tags: { ...point.tags, note: "x".repeat(100000) } }] }));
  assert.notEqual(run().status, 0);
  assert.equal(await readFile(path.join(output, "850002.json"), "utf8"), before);
});
