import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTACT_INDEX_SCHEMA_VERSION,
  indexedDepartmentAvailability,
  loadContactIndexManifest,
  normalizeContactIndexManifest,
  resolveContactIndexEntries,
} from "../contact-indexes.js";

function manifest(overrides = {}) {
  return {
    schemaVersion: CONTACT_INDEX_SCHEMA_VERSION,
    generatedAt: "2026-09-13T00:00:00Z",
    sources: {
      "all-the-places": {
        label: "All The Places",
        pathTemplate: "all-the-places/{department}.json",
        departments: ["85", "44", "44", "invalid"],
      },
    },
    ...overrides,
  };
}

test("manifest normalization keeps only valid unique departments in catalog order", () => {
  const normalized = normalizeContactIndexManifest(manifest());
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.sources["all-the-places"].label, "All The Places");
  assert.deepEqual(normalized.sources["all-the-places"].departments, ["44", "85"]);
  assert.ok(Object.isFrozen(normalized.sources["all-the-places"].departments));
});

test("manifest rejects unsupported schema versions", () => {
  assert.throws(
    () => normalizeContactIndexManifest(manifest({ schemaVersion: 2 })),
    /Version de manifest non prise en charge/,
  );
});

test("unsafe or unusable path templates are ignored", () => {
  const normalized = normalizeContactIndexManifest(manifest({
    sources: {
      external: {
        label: "External",
        pathTemplate: "https://example.test/{department}.json",
        departments: ["44"],
      },
      traversal: {
        label: "Traversal",
        pathTemplate: "../private/{department}.json",
        departments: ["44"],
      },
      missingPlaceholder: {
        label: "Missing",
        pathTemplate: "source/index.json",
        departments: ["44"],
      },
    },
  }));
  assert.deepEqual(Object.keys(normalized.sources), []);
});

test("availability intersects configured departments with the current Grist scope", () => {
  const normalized = normalizeContactIndexManifest(manifest());
  const availability = indexedDepartmentAvailability(normalized, "all-the-places", ["44", "49", "85"]);
  assert.deepEqual(availability.requested, ["44", "49", "85"]);
  assert.deepEqual(availability.available, ["44", "85"]);
  assert.deepEqual(availability.missing, ["49"]);
});

test("index entries resolve relative to the manifest and only for indexed departments", () => {
  const normalized = normalizeContactIndexManifest(manifest());
  const entries = resolveContactIndexEntries(normalized, "all-the-places", ["44", "49", "85"], {
    manifestUrl: "https://example.test/widgets/structure-picker/contact-indexes/indexed-departments.json",
  });
  assert.deepEqual(entries, [
    {
      sourceId: "all-the-places",
      department: "44",
      url: "https://example.test/widgets/structure-picker/contact-indexes/all-the-places/44.json",
    },
    {
      sourceId: "all-the-places",
      department: "85",
      url: "https://example.test/widgets/structure-picker/contact-indexes/all-the-places/85.json",
    },
  ]);
});

test("Corsican department codes remain valid index keys", () => {
  const normalized = normalizeContactIndexManifest(manifest({
    sources: {
      sample: {
        label: "Sample",
        pathTemplate: "sample/{department}.json",
        departments: ["2B", "2A"],
      },
    },
  }));
  assert.deepEqual(normalized.sources.sample.departments, ["2A", "2B"]);
});

test("manifest loading bypasses browser cache and forwards abort signal", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const loaded = await loadContactIndexManifest({
    url: "https://example.test/indexed-departments.json",
    signal,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        async json() {
          return manifest();
        },
      };
    },
  });

  assert.equal(loaded.sources["all-the-places"].departments.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.signal, signal);
});

test("manifest loading fails explicitly on HTTP errors", async () => {
  await assert.rejects(
    loadContactIndexManifest({
      url: "https://example.test/indexed-departments.json",
      fetchImpl: async () => ({ ok: false, status: 404 }),
    }),
    /indisponible \(404\)/,
  );
});
