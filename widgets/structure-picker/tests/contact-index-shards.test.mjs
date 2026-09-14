import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildContactRuntimeShards } from "../../../scripts/build-contact-runtime-shards.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-shards-"));
  const input = path.join(root, "input");
  const output = path.join(root, "output");
  const manifestPath = path.join(root, "indexed-departments.json");
  await mkdir(input, { recursive: true });
  await mkdir(output, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-09-14T00:00:00Z",
    sources: {
      "all-the-places": {
        label: "All The Places",
        pathTemplate: "all-the-places/{department}.json",
        departments: [],
      },
      overture: {
        label: "Overture Places",
        pathTemplate: "overture/{department}.json",
        departments: [],
      },
    },
  }, null, 2)}\n`);
  return { root, input, output, manifestPath };
}

async function writeRaw(input, source, department, records) {
  await writeFile(path.join(input, `${department}.json`), `${JSON.stringify({
    schemaVersion: 1,
    source,
    department,
    generatedAt: "2026-09-14T00:00:00Z",
    upstream: { project: source },
    recordCount: records.length,
    records,
  })}\n`);
}

test("runtime sharding publishes only postcode shards belonging to the requested department", async () => {
  const item = await fixture();
  try {
    await writeRaw(item.input, "all-the-places", "44", [
      { recordId: "a", name: "A", postcode: "44140", telephone: "02 00 00 00 01" },
      { recordId: "b", name: "B", postcode: "44000", siteWeb: "https://b.example" },
      { recordId: "wrong", name: "Wrong", postcode: "85000", telephone: "02 00 00 00 02" },
    ]);

    const result = await buildContactRuntimeShards({
      source: "all-the-places",
      inputDir: item.input,
      outputDir: item.output,
      manifestPath: item.manifestPath,
      departments: ["44"],
    });

    assert.deepEqual(result.departments, ["44"]);
    assert.equal(result.totals.records, 2);
    assert.equal(result.totals.shards, 2);
    assert.equal(result.totals.skipped, 1);

    const manifest = JSON.parse(await readFile(item.manifestPath, "utf8"));
    assert.equal(manifest.sources["all-the-places"].shardBy, "postcode");
    assert.equal(manifest.sources["all-the-places"].pathTemplate, "all-the-places/{department}/{postcode}.json");
    assert.deepEqual(manifest.sources["all-the-places"].departments, ["44"]);

    const shard = JSON.parse(await readFile(path.join(item.output, "44", "44140.json"), "utf8"));
    assert.equal(shard.postcode, "44140");
    assert.equal(shard.recordCount, 1);
    assert.equal(shard.records[0].recordId, "a");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("Overture runtime shards keep alternate contacts and compact upstream lineage", async () => {
  const item = await fixture();
  try {
    await writeRaw(item.input, "overture", "85", [{
      recordId: "gers-1",
      name: "Atelier test",
      postcode: "85000",
      telephone: "02 51 00 00 00",
      telephones: ["02 51 00 00 00", "02 51 00 00 01"],
      courriel: "bonjour@example.test",
      courriels: ["bonjour@example.test"],
      siteWeb: "https://example.test",
      sitesWeb: ["https://example.test"],
      confidence: 0.91,
      sources: [
        { dataset: "meta" },
        { dataset: "AllThePlaces" },
      ],
    }]);

    await buildContactRuntimeShards({
      source: "overture",
      inputDir: item.input,
      outputDir: item.output,
      manifestPath: item.manifestPath,
      departments: ["85"],
    });

    const shard = JSON.parse(await readFile(path.join(item.output, "85", "85000.json"), "utf8"));
    const record = shard.records[0];
    assert.deepEqual(record.telephones, ["02 51 00 00 00", "02 51 00 00 01"]);
    assert.deepEqual(record.datasets, ["meta", "AllThePlaces"]);
    assert.equal(record.hasAllThePlacesLineage, true);
    assert.equal(record.confidence, 0.91);
    assert.equal(Object.hasOwn(record, "sources"), false);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
