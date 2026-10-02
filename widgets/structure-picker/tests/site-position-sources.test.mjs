import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findIndexedSitePositions, findOsmSiretPositions } from "../site-position-sources.js";

const manifest = {
  schemaVersion: 1, generatedAt: "2026-09-14T15:54:51Z", sources: {
    overture: { label: "Overture Places", shardBy: "postcode", pathTemplate: "overture/{department}/{postcode}.json", departments: ["44"] },
    "all-the-places": { label: "All The Places", shardBy: "postcode", pathTemplate: "all-the-places/{department}/{postcode}.json", departments: ["44"] },
  },
};

test("site lookup uses only published postcode shards, preserves provenance and accepts POIs without contacts", async () => {
  const calls = [];
  const original = JSON.parse(await readFile(new URL("./fixtures/overture-44270.json", import.meta.url)));
  const shard = { ...original, records: original.records.map(({ telephone, courriel, siteWeb, telephones, courriels, sitesWeb, ...record }) => record) };
  const result = await findIndexedSitePositions({
    candidate: { codePostal: "44270" }, manifestUrl: "https://example.test/contact-indexes/indexed-departments.json",
    fetchImpl: async url => {
      calls.push(String(url));
      if (calls.length === 1) return Response.json(manifest);
      if (String(url).includes("overture")) return Response.json(shard);
      return new Response("", { status: 404 });
    },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.slice(1).every(url => url.includes("/44/44270.json?v=")));
  assert.equal(result.observations.length, 2);
  assert.equal(result.observations[1].source.recordId, original.records[1].recordId);
  assert.equal(result.observations[1].source.upstream.release, "2026-08-19.0");
  assert.deepEqual(result.observations[1].source.datasets, ["meta", "Overture"]);
});

test("the optional OSM position query targets exactly the resolved SIRET and preserves geometry provenance", async () => {
  let calls = 0;
  const result = await findOsmSiretPositions({
    candidate: { siret: "41091808000020" },
    fetchImpl: async (url, options) => {
      calls += 1;
      const query = new URLSearchParams(options.body).get("data");
      assert.match(query, /nwr\["ref:FR:SIRET"="41091808000020"\]/);
      assert.doesNotMatch(query, /around|brand|operator/);
      return Response.json({ elements: [{ type: "way", id: 42, center: { lat: 47, lon: -1.8 }, tags: { name: "Test", "ref:FR:SIRET": "41091808000020" } }] });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.observations[0].source.url, "https://www.openstreetmap.org/way/42");
  assert.equal(result.observations[0].source.geometry, "center");
});
