import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  generateOvertureIndexes,
  normalizeOvertureFeature,
} from "../../../scripts/generate-overture-index.mjs";

function feature({
  id = "overture-1",
  postcode = "44140",
  city = "Geneston",
  country = "FR",
  name = "Entreprise test",
  phones = [],
  emails = [],
  websites = [],
  confidence = 0.92,
  operatingStatus = "open",
  coordinates = [-1.51, 47.05],
  sources = [
    {
      property: "phones",
      dataset: "meta",
      record_id: "meta-1",
      license: "CDLA-Permissive-2.0",
      confidence: 0.9,
    },
  ],
  addresses,
} = {}) {
  return {
    type: "Feature",
    geometry: coordinates ? { type: "Point", coordinates } : null,
    properties: {
      id,
      version: 3,
      names: { primary: name },
      basic_category: "company",
      confidence,
      operating_status: operatingStatus,
      phones,
      emails,
      websites,
      addresses: addresses || [
        {
          freeform: "1 rue du Test",
          locality: city,
          postcode,
          country,
        },
      ],
      sources,
    },
  };
}

test("Overture normalization preserves useful contacts and source lineage", () => {
  const normalized = normalizeOvertureFeature(feature({
    phones: ["+33240123456", "+33240999999"],
    emails: ["contact@example.test"],
    websites: ["https://example.test"],
    sources: [
      {
        property: "phones",
        dataset: "AllThePlaces",
        record_id: "atp-1",
        license: "CC0-1.0",
      },
      {
        property: "names",
        dataset: "meta",
        record_id: "meta-1",
        license: "CDLA-Permissive-2.0",
      },
    ],
  }), ["44", "85"]);

  assert.equal(normalized.department, "44");
  assert.equal(normalized.record.recordId, "overture-1");
  assert.equal(normalized.record.address, "1 rue du Test, 44140 Geneston");
  assert.equal(normalized.record.latitude, 47.05);
  assert.equal(normalized.record.longitude, -1.51);
  assert.equal(normalized.record.telephone, "+33240123456");
  assert.deepEqual(normalized.record.telephones, ["+33240123456", "+33240999999"]);
  assert.equal(normalized.record.courriel, "contact@example.test");
  assert.equal(normalized.record.siteWeb, "https://example.test");
  assert.equal(normalized.record.confidence, 0.92);
  assert.equal(normalized.record.sources.length, 2);
  assert.equal(normalized.record.sources[0].dataset, "AllThePlaces");
  assert.equal(normalized.record.sources[0].property, "phones");
});

test("Overture normalization is conservative about geography, status and contact usefulness", () => {
  assert.equal(normalizeOvertureFeature(feature({
    postcode: "35000",
    phones: ["+33299123456"],
  }), ["44"]), null);

  assert.equal(normalizeOvertureFeature(feature({
    country: "BE",
    phones: ["+3221234567"],
  }), ["44"]), null);

  assert.equal(normalizeOvertureFeature(feature({
    operatingStatus: "permanently_closed",
    phones: ["+33240123456"],
  }), ["44"]), null);

  assert.equal(normalizeOvertureFeature(feature(), ["44"]), null);

  assert.equal(normalizeOvertureFeature(feature({
    postcode: "20100",
    phones: ["+33495123456"],
  }), ["2A", "2B"]), null);
});

test("Overture selects the address that belongs to the requested department", () => {
  const normalized = normalizeOvertureFeature(feature({
    phones: ["+33240123456"],
    addresses: [
      { freeform: "1 rue Bretonne", locality: "Rennes", postcode: "35000", country: "FR" },
      { freeform: "2 rue Nantaise", locality: "Nantes", postcode: "44000", country: "FR" },
    ],
  }), ["44"]);

  assert.equal(normalized.department, "44");
  assert.equal(normalized.record.postcode, "44000");
  assert.equal(normalized.record.address, "2 rue Nantaise, 44000 Nantes");
});

test("generator consumes GeoJSONSeq, deduplicates GERS ids and updates only Overture availability", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "grist-overture-test-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });

  const input = path.join(root, "places.geojsonseq");
  const output = path.join(root, "indexes", "overture");
  const manifestPath = path.join(root, "indexes", "indexed-departments.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });

  const rows = [
    feature({ id: "shared", phones: ["+33240123456"], confidence: 0.7 }),
    feature({ id: "shared", phones: ["+33240123456"], websites: ["https://richer.example.test"], confidence: 0.8 }),
    feature({ id: "vendee", postcode: "85000", city: "La Roche-sur-Yon", emails: ["contact@example.test"] }),
    feature({ id: "ignored", postcode: "35000", city: "Rennes", phones: ["+33299123456"] }),
  ];
  await writeFile(input, rows.map(row => JSON.stringify(row)).join("\n") + "\n");

  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: null,
    sources: {
      "all-the-places": {
        label: "All The Places",
        pathTemplate: "all-the-places/{department}.json",
        departments: ["35"],
      },
      overture: {
        label: "Overture Places",
        pathTemplate: "overture/{department}.json",
        departments: [],
      },
    },
  }));

  const result = await generateOvertureIndexes({
    input,
    departments: ["44", "85"],
    outputDir: output,
    manifestPath,
    generatedAt: "2026-09-14T12:00:00.000Z",
    release: "2026-08-19.0",
    schemaVersion: "v1.18.0",
  });

  assert.deepEqual(result.writtenDepartments, ["44", "85"]);
  assert.deepEqual(result.perDepartment, { "44": 1, "85": 1 });
  assert.equal(result.stats.files, 1);
  assert.equal(result.stats.features, 4);
  assert.equal(result.stats.candidates, 3);
  assert.equal(result.stats.duplicates, 1);
  assert.equal(result.stats.indexed, 2);

  const index44 = JSON.parse(await readFile(path.join(output, "44.json"), "utf8"));
  assert.equal(index44.source, "overture");
  assert.equal(index44.upstream.release, "2026-08-19.0");
  assert.equal(index44.upstream.schemaVersion, "v1.18.0");
  assert.equal(index44.recordCount, 1);
  assert.equal(index44.records[0].recordId, "shared");
  assert.equal(index44.records[0].siteWeb, "https://richer.example.test");
  assert.equal(index44.records[0].confidence, 0.8);

  const index85 = JSON.parse(await readFile(path.join(output, "85.json"), "utf8"));
  assert.equal(index85.records[0].courriel, "contact@example.test");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.generatedAt, "2026-09-14T12:00:00.000Z");
  assert.deepEqual(manifest.sources.overture.departments, ["44", "85"]);
  assert.deepEqual(manifest.sources["all-the-places"].departments, ["35"]);
});
