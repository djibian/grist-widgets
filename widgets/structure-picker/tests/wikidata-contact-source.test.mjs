import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWikidataSearchUrl,
  buildWikidataSirenQueryUrl,
  wikidataContactSource,
  wikidataItemToCandidate,
} from "../contact-sources/wikidata.js";

function statement(property, content, { rank = "normal", servicePublic = false } = {}) {
  return {
    rank,
    property: { id: property },
    value: { type: "value", content },
    references: servicePublic ? [{
      parts: [{
        property: { id: "P248" },
        value: { type: "value", content: "Q97451652" },
      }],
    }] : [],
  };
}

function item(overrides = {}) {
  return {
    id: "QTEST",
    labels: { fr: "Structure exemple" },
    statements: {
      P1329: [statement("P1329", "+33-2-40-41-90-00", { servicePublic: true })],
      P968: [statement("P968", "mailto:contact@example.fr", { servicePublic: true })],
      P856: [
        statement("P856", "https://ancien.example.fr/", { rank: "deprecated" }),
        statement("P856", "https://example.fr/"),
      ],
      P1616: [statement("P1616", "123456789")],
      P625: [statement("P625", { latitude: 47.2, longitude: -1.5 })],
      P281: [statement("P281", "44000")],
      P6375: [statement("P6375", { language: "fr", text: "1 rue du Test" })],
    },
    ...overrides,
  };
}

test("Wikidata builds exact SIREN and text-search URLs", () => {
  const siren = new URL(buildWikidataSirenQueryUrl("123 456 789"));
  assert.match(siren.searchParams.get("query"), /P1616 "123456789"/);
  const search = new URL(buildWikidataSearchUrl("Structure exemple", 4));
  assert.equal(search.searchParams.get("q"), "Structure exemple");
  assert.equal(search.searchParams.get("language"), "fr");
  assert.equal(search.searchParams.get("limit"), "4");
});

test("Wikidata keeps SIREN as evidence without inventing a SIRET", () => {
  const candidate = wikidataItemToCandidate(item(), {
    siret: "12345678900011",
    name: "Structure exemple",
  });
  assert.equal(candidate.source.id, "wikidata");
  assert.equal(candidate.identity.siret, "");
  assert.equal(candidate.identity.address, "1 rue du Test, 44000");
  assert.equal(candidate.identity.latitude, 47.2);
  assert.equal(candidate.contacts.telephone, "+33-2-40-41-90-00");
  assert.equal(candidate.contacts.courriel, "contact@example.fr");
  assert.equal(candidate.contacts.siteWeb, "https://example.fr/");
  assert.equal(candidate.match.score, 1);
});

test("Wikidata preserves DILA provenance only when selected contact statements cite Service-Public", () => {
  const candidate = wikidataItemToCandidate(item(), { name: "Structure exemple" });
  assert.deepEqual(candidate.source.provenance.map(source => source.id), ["wikidata", "dila"]);

  const independent = wikidataItemToCandidate(item({
    statements: {
      ...item().statements,
      P1329: [statement("P1329", "02 40 00 00 00")],
      P968: [],
    },
  }), { name: "Structure exemple" });
  assert.deepEqual(independent.source.provenance.map(source => source.id), ["wikidata"]);
});

test("Wikidata exact SIREN lookup fetches only resolved items", async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).startsWith("https://query.wikidata.org/")) {
      return {
        ok: true,
        async json() {
          return { results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/QTEST" } }] } };
        },
      };
    }
    if (String(url).endsWith("/entities/items/QTEST")) {
      return { ok: true, async json() { return item(); } };
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await wikidataContactSource.search({
    siret: "12345678900011",
    name: "Structure exemple",
  }, { fetchImpl });
  assert.equal(result.candidates.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].startsWith("https://query.wikidata.org/"));
  assert.ok(calls[1].endsWith("/entities/items/QTEST"));
});

test("Wikidata falls back to text search when exact SIREN finds nothing", async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).startsWith("https://query.wikidata.org/")) {
      return { ok: true, async json() { return { results: { bindings: [] } }; } };
    }
    if (String(url).includes("/search/items?")) {
      return {
        ok: true,
        async json() {
          return { results: [{ id: "QTEST", "display-label": { value: "Structure exemple" } }] };
        },
      };
    }
    if (String(url).endsWith("/entities/items/QTEST")) {
      return { ok: true, async json() { return item(); } };
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await wikidataContactSource.search({
    siret: "12345678900011",
    name: "Structure exemple",
  }, { fetchImpl });
  assert.equal(result.candidates.length, 1);
  assert.equal(calls.length, 3);
  assert.ok(calls[1].includes("/search/items?"));
});
