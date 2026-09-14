import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContactIndexManifest } from "../contact-indexes.js";
import { CONTACT_MATCH_KINDS } from "../contact-model.js";
import { allThePlacesContactSource } from "../contact-sources/all-the-places.js";
import { canSearchIndexedContext } from "../contact-sources/indexed.js";
import { overtureContactSource } from "../contact-sources/overture.js";

const manifestUrl = "https://example.test/widgets/structure-picker/contact-indexes/indexed-departments.json";

function manifest(sourceId) {
  return normalizeContactIndexManifest({
    schemaVersion: 1,
    generatedAt: "2026-09-14T00:00:00Z",
    sources: {
      [sourceId]: {
        label: sourceId === "overture" ? "Overture Places" : "All The Places",
        pathTemplate: `${sourceId}/{department}/{postcode}.json`,
        shardBy: "postcode",
        departments: ["44"],
      },
    },
  });
}

function context(overrides = {}) {
  return {
    siret: "12345678901234",
    name: "Boulangerie du Centre",
    address: "1 rue du Centre, 44140 Geneston",
    latitude: 47.055,
    longitude: -1.512,
    ...overrides,
  };
}

function shard(source, records) {
  return {
    schemaVersion: 1,
    source,
    department: "44",
    postcode: "44140",
    generatedAt: "2026-09-14T00:00:00Z",
    recordCount: records.length,
    records,
  };
}

test("indexed sources require a usable postcode before becoming available", () => {
  assert.equal(canSearchIndexedContext(context()), true);
  assert.equal(canSearchIndexedContext(context({ address: "Geneston" })), false);
});

test("All The Places loads only the postcode shard and preserves exact SIRET evidence", async () => {
  const calls = [];
  const result = await allThePlacesContactSource.search(context(), {
    manifest: manifest("all-the-places"),
    manifestUrl,
    fetchImpl: async url => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        async json() {
          return shard("all-the-places", [
            {
              recordId: "atp-1",
              spider: "sample",
              name: "Boulangerie du Centre",
              siret: "12345678901234",
              address: "1 rue du Centre, 44140 Geneston",
              postcode: "44140",
              latitude: 47.055,
              longitude: -1.512,
              telephone: "02 40 00 00 00",
              courriel: "",
              siteWeb: "",
            },
            {
              recordId: "atp-2",
              spider: "sample",
              name: "Garage sans rapport",
              siret: "",
              address: "99 route de Nantes, 44140 Geneston",
              postcode: "44140",
              latitude: 47.08,
              longitude: -1.55,
              telephone: "02 40 99 99 99",
              courriel: "",
              siteWeb: "",
            },
          ]);
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /all-the-places\/44\/44140\.json\?v=/);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].match.kind, CONTACT_MATCH_KINDS.EXACT_SIRET);
  assert.equal(result.candidates[0].source.label, "All The Places");
});

test("missing postcode shards are an empty source result, not a global search failure", async () => {
  const result = await allThePlacesContactSource.search(context(), {
    manifest: manifest("all-the-places"),
    manifestUrl,
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.deepEqual(result.candidates, []);
});

test("Overture exposes alternate contacts independently and records ATP lineage", async () => {
  const result = await overtureContactSource.search(context({ siret: "" }), {
    manifest: manifest("overture"),
    manifestUrl,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return shard("overture", [{
          recordId: "gers-1",
          name: "Boulangerie du Centre",
          siret: "",
          address: "1 rue du Centre, 44140 Geneston",
          postcode: "44140",
          latitude: 47.055,
          longitude: -1.512,
          telephone: "02 40 00 00 00",
          courriel: "contact@example.test",
          siteWeb: "https://example.test",
          telephones: ["02 40 00 00 00", "02 40 00 00 01"],
          courriels: ["contact@example.test", "direction@example.test"],
          sitesWeb: ["https://example.test", "https://second.example.test"],
          confidence: 0.93,
          datasets: ["meta", "AllThePlaces"],
          hasAllThePlacesLineage: true,
        }]);
      },
    }),
  });

  assert.equal(result.candidates.length, 4);
  assert.deepEqual(
    result.candidates.map(candidate => candidate.contacts),
    [
      { telephone: "02 40 00 00 00", courriel: "contact@example.test", siteWeb: "https://example.test" },
      { telephone: "02 40 00 00 01", courriel: "contact@example.test", siteWeb: "https://example.test" },
      { telephone: "02 40 00 00 00", courriel: "direction@example.test", siteWeb: "https://example.test" },
      { telephone: "02 40 00 00 00", courriel: "contact@example.test", siteWeb: "https://second.example.test" },
    ],
  );
  for (const candidate of result.candidates) {
    assert.deepEqual(
      candidate.source.provenance.map(source => source.id),
      ["overture", "all-the-places"],
    );
  }
});
