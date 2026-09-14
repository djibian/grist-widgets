import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  generateAllThePlacesIndexes,
  normalizeAllThePlacesFeature,
} from "../../../scripts/generate-all-the-places-index.mjs";

function feature({
  id,
  country = "FR",
  postcode = "44140",
  city = "Geneston",
  name = "Entreprise test",
  phone = "",
  email = "",
  website = "",
  spider = "test_fr",
  ref = "1",
  coordinates = [-1.51, 47.05],
  extra = {},
} = {}) {
  return {
    type: "Feature",
    id,
    properties: {
      "@spider": spider,
      ref,
      "addr:country": country,
      "addr:postcode": postcode,
      "addr:city": city,
      "addr:housenumber": "1",
      "addr:street": "rue du Test",
      name,
      phone,
      email,
      website,
      ...extra,
    },
    geometry: coordinates ? { type: "Point", coordinates } : null,
  };
}

test("ATP feature normalization keeps useful French contacts in requested departments", () => {
  const normalized = normalizeAllThePlacesFeature(feature({
    id: "atp-44",
    phone: "+33240123456",
    website: "https://example.test",
    extra: { "ref:FR:SIRET": "12345678900011" },
  }), ["44", "85"]);

  assert.equal(normalized.department, "44");
  assert.equal(normalized.record.recordId, "atp-44");
  assert.equal(normalized.record.siret, "12345678900011");
  assert.equal(normalized.record.address, "1 rue du Test, 44140 Geneston");
  assert.equal(normalized.record.latitude, 47.05);
  assert.equal(normalized.record.longitude, -1.51);
  assert.equal(normalized.record.telephone, "+33240123456");
  assert.equal(normalized.record.siteWeb, "https://example.test");
});

test("ATP feature normalization is conservative about geography and contact usefulness", () => {
  assert.equal(normalizeAllThePlacesFeature(feature({
    id: "de",
    country: "DE",
    phone: "+4922112345",
  }), ["44"]), null);

  assert.equal(normalizeAllThePlacesFeature(feature({
    id: "no-contact",
  }), ["44"]), null);

  assert.equal(normalizeAllThePlacesFeature(feature({
    id: "corsica",
    postcode: "20100",
    phone: "+33495123456",
  }), ["2A", "2B"]), null);
});

test("generator writes deterministic departmental indexes and updates only ATP availability", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "grist-atp-test-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });

  const input = path.join(root, "input");
  const nested = path.join(input, "nested");
  const output = path.join(root, "indexes", "all-the-places");
  const manifestPath = path.join(root, "indexes", "indexed-departments.json");
  await mkdir(nested, { recursive: true });
  await mkdir(path.dirname(manifestPath), { recursive: true });

  await writeFile(path.join(input, "a.geojson"), JSON.stringify({
    type: "FeatureCollection",
    features: [
      feature({ id: "shared", phone: "+33240123456" }),
      feature({ id: "vendée", postcode: "85000", city: "La Roche-sur-Yon", email: "contact@example.test" }),
      feature({ id: "ignored", postcode: "35000", city: "Rennes", phone: "+33299123456" }),
    ],
  }));

  await writeFile(path.join(nested, "b.geojson"), JSON.stringify({
    type: "FeatureCollection",
    features: [
      feature({ id: "shared", phone: "+33240123456", website: "https://richer.example.test" }),
      feature({ id: "foreign", country: "BE", phone: "+3221234567" }),
    ],
  }));

  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: null,
    sources: {
      "all-the-places": {
        label: "All The Places",
        pathTemplate: "all-the-places/{department}.json",
        departments: [],
      },
      overture: {
        label: "Overture Places",
        pathTemplate: "overture/{department}.json",
        departments: ["35"],
      },
    },
  }));

  const result = await generateAllThePlacesIndexes({
    input,
    departments: ["44", "85"],
    outputDir: output,
    manifestPath,
    generatedAt: "2026-09-13T20:00:00.000Z",
    runId: "test-run",
  });

  assert.deepEqual(result.writtenDepartments, ["44", "85"]);
  assert.deepEqual(result.perDepartment, { "44": 1, "85": 1 });
  assert.equal(result.stats.files, 2);
  assert.equal(result.stats.features, 5);
  assert.equal(result.stats.candidates, 3);
  assert.equal(result.stats.duplicates, 1);
  assert.equal(result.stats.indexed, 2);

  const index44 = JSON.parse(await readFile(path.join(output, "44.json"), "utf8"));
  assert.equal(index44.schemaVersion, 1);
  assert.equal(index44.source, "all-the-places");
  assert.equal(index44.department, "44");
  assert.equal(index44.recordCount, 1);
  assert.equal(index44.upstream.runId, "test-run");
  assert.equal(index44.records[0].recordId, "shared");
  assert.equal(index44.records[0].siteWeb, "https://richer.example.test");

  const index85 = JSON.parse(await readFile(path.join(output, "85.json"), "utf8"));
  assert.equal(index85.records[0].courriel, "contact@example.test");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.generatedAt, "2026-09-13T20:00:00.000Z");
  assert.deepEqual(manifest.sources["all-the-places"].departments, ["44", "85"]);
  assert.deepEqual(manifest.sources.overture.departments, ["35"]);
});
