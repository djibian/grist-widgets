import assert from "node:assert/strict";
import test from "node:test";
import {
  loadContactIndexShard,
  normalizeContactIndexManifest,
  resolveContactIndexShard,
} from "../contact-indexes.js";

const manifestUrl = "https://example.test/widgets/structure-picker/contact-indexes/indexed-departments.json";

function manifest() {
  return normalizeContactIndexManifest({
    schemaVersion: 1,
    generatedAt: "2026-09-13T00:00:00Z",
    sources: {
      overture: {
        label: "Overture Places",
        pathTemplate: "overture/{department}/{postcode}.json",
        shardBy: "postcode",
        departments: ["44"],
      },
    },
  });
}

test("postcode shards resolve only inside a published coherent department", () => {
  const normalized = manifest();
  const entry = resolveContactIndexShard(normalized, "overture", { postcode: "44140" }, { manifestUrl });
  assert.deepEqual(entry, {
    sourceId: "overture",
    department: "44",
    postcode: "44140",
    url: "https://example.test/widgets/structure-picker/contact-indexes/overture/44/44140.json?v=2026-09-13T00%3A00%3A00Z",
  });
  assert.equal(resolveContactIndexShard(normalized, "overture", { postcode: "85000" }, { manifestUrl }), null);
  assert.equal(resolveContactIndexShard(normalized, "overture", { department: "85", postcode: "44140" }, { manifestUrl }), null);
});

test("postcode shard loading treats 404 as empty and rejects inconsistent metadata", async () => {
  const entry = {
    sourceId: "overture",
    department: "44",
    postcode: "44140",
    url: "https://example.test/overture/44/44140.json",
  };
  assert.equal(await loadContactIndexShard(entry, {
    fetchImpl: async () => ({ ok: false, status: 404 }),
  }), null);

  const loaded = await loadContactIndexShard(entry, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          schemaVersion: 1,
          source: "overture",
          department: "44",
          postcode: "44140",
          recordCount: 1,
          records: [{ recordId: "x" }],
        };
      },
    }),
  });
  assert.equal(loaded.records.length, 1);

  await assert.rejects(
    loadContactIndexShard(entry, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            schemaVersion: 1,
            source: "overture",
            department: "85",
            postcode: "85000",
            recordCount: 0,
            records: [],
          };
        },
      }),
    }),
    /invalide ou incohérent/,
  );
});

test("a postcode path requires an explicit postcode shard contract", () => {
  const normalized = normalizeContactIndexManifest({
    schemaVersion: 1,
    sources: {
      broken: {
        label: "Broken",
        pathTemplate: "broken/{department}/{postcode}.json",
        departments: ["44"],
      },
    },
  });
  assert.deepEqual(Object.keys(normalized.sources), []);
});
