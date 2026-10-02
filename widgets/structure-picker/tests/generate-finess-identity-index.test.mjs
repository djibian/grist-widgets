import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const generator = fileURLToPath(new URL("../../../scripts/generate-finess-identity-index.py", import.meta.url));
const fixture = JSON.parse(await readFile(new URL("./fixtures/ehpad-finess-source.json", import.meta.url), "utf8"));
const published = JSON.parse(await readFile(new URL("../identity-links/finess/85.json", import.meta.url), "utf8"));

async function run(t, document, compressed = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "finess-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, compressed ? "source.json.gz" : "source.json");
  const output = path.join(directory, "index");
  const bytes = Buffer.from(JSON.stringify(document));
  await writeFile(input, compressed ? gzipSync(bytes) : bytes);
  const result = spawnSync("python3", [generator, "--input", input, "--output", output,
    "--source-url", published.source.url, "--departments", "44,85"], { encoding: "utf8" });
  return { ...result, output };
}

test("the real FINESS Structures source generates the published geographic EHPAD record, excluding the legal entity and closed USLD", async t => {
  const result = await run(t, fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(result.output), ["85.json"]);
  const shard = JSON.parse(await readFile(path.join(result.output, "85.json"), "utf8"));
  assert.equal(shard.recordCount, 1);
  assert.deepEqual(shard.records[0], published.records.find(site => site.informationsGeneralesEGE.numFinessEge === "850002163"));
  assert.equal(shard.source.generatedAt, fixture.generatedAt);
  assert.equal(shard.source.url, published.source.url);
  assert.equal(shard.records[0].informationsGeneralesEGE.siret, "26850025300011");
  assert.doesNotMatch(JSON.stringify(shard.records), /850000373|850006206|26850025300037/);
  const gzipped = await run(t, fixture, true);
  assert.equal(gzipped.status, 0, gzipped.stderr);
  assert.equal(await readFile(path.join(gzipped.output, "85.json"), "utf8"), await readFile(path.join(result.output, "85.json"), "utf8"));
});

test("the generator never inherits a legal entity's identifiers when geographic SIRET is missing", async t => {
  const altered = structuredClone(fixture);
  delete altered.pmej[0].ege[0].informationsGeneralesEGE.siret;
  altered.pmej[0].informationsGeneralesPMEJ.siret = "26850025300011";
  const result = await run(t, altered);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No active geographic FINESS/);
});

test("duplicate geographic identifiers and unsupported upstream schemas fail publication", async t => {
  const duplicate = structuredClone(fixture);
  duplicate.pmej[0].ege.push(duplicate.pmej[0].ege[0]);
  const result = await run(t, duplicate);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate geographic FINESS/);
  const unsupported = await run(t, { ...fixture, schemaVersion: "v2.0.0" });
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /Unsupported FINESS/);
});

test("published FINESS shards contain the complete configured cohort, unique active geographic IDs and upstream provenance", async () => {
  const ids = new Set();
  for (const prefix of ["44", "85"]) {
    const shard = JSON.parse(await readFile(new URL(`../identity-links/finess/${prefix}.json`, import.meta.url), "utf8"));
    assert.equal(shard.recordCount, shard.records.length);
    assert.equal(shard.source.id, "finess-ans");
    assert.match(shard.source.url, /static\.data\.gouv\.fr\/resources\/finess-structures-1/);
    for (const site of shard.records) {
      const info = site.informationsGeneralesEGE;
      assert.equal(site.etatObjet, "A");
      assert.ok(!info.dateFermeture);
      assert.match(info.siret, /^\d{14}$/);
      assert.match(info.numFinessEge, /^[A-Z0-9]{9}$/);
      assert.equal(ids.has(info.numFinessEge), false);
      ids.add(info.numFinessEge);
    }
  }
  assert.equal(ids.size, 2906);
});
