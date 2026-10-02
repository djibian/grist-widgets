import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { extractOfficialCandidates } from "../search.js";
import { findFinessIdentityLinks } from "../finess-identity.js";
import { resolveIdentityForEnrichment } from "../identity-service.js";
import { resolveSitePosition } from "../establishment-position.js";
import { resolveEstablishmentForEnrichment } from "../establishment-service.js";
import { findIndexedFinessPositions, osmSitePositionFromElement, OSM_POSITION_INDEX_BUDGET } from "../osm-site-positions.js";
import { findIndexedSitePositions, findOsmSiretPositions } from "../site-position-sources.js";

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const annuaire = await fixture("ehpad-annuaire");
const finess = await fixture("ehpad-finess");
const osm = await fixture("ehpad-osm");
const element = osm.elements[0];
const shard = JSON.parse(await readFile(new URL("../site-position-indexes/osm-finess/850002.json", import.meta.url), "utf8"));
const row = { NomCommercial: "EHPAD La Reynerie Bouin 85230", Adresse: "8bis Rue du Pays de Retz 85230 Bouin" };
const identity = await resolveIdentityForEnrichment({
  row, fetchOfficial: async () => ({ ...extractOfficialCandidates(annuaire), cached: false }),
  findPublishedLinks: async () => ({ candidates: [] }),
  findSectorLinks: options => findFinessIdentityLinks({ ...options, fetchImpl: async () => Response.json(finess) }),
  geocode: async () => [],
});
const candidate = identity.decision.candidate;
const links = identity.links;
const observation = osmSitePositionFromElement(element, { generatedAt: osm.osm3s.timestamp_osm_base });
const changedPoi = tags => osmSitePositionFromElement({ ...element, tags: { ...element.tags, ...tags } });
const lookup = overrides => findIndexedFinessPositions({
  candidate, links, identityStatus: identity.decision.status,
  fetchImpl: async () => Response.json(shard), ...overrides,
});
const manifest = { schemaVersion: 1, sources: Object.fromEntries(["all-the-places", "overture"].map(id => [id, {
  label: id, shardBy: "postcode", pathTemplate: `${id}/{department}/{postcode}.json`, departments: ["85"],
}])) };
const settle = async () => { for (let i = 0; i < 70; i += 1) await Promise.resolve(); };

test("real ANS + fresh Annuaire + the same typed OSM FINESS/SIRET demonstrate the EHPAD point and retain versioned provenance", async () => {
  assert.equal(identity.decision.status, "MATCH_VERIFIED");
  const calls = [];
  const indexed = await lookup({ fetchImpl: async url => { calls.push(String(url)); return Response.json(shard); } });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/osm-finess\/850002\.json$/);
  assert.equal(indexed.observations.length, 1, "the six other same-prefix FINESS POIs cannot enter this candidate");
  const position = resolveSitePosition(candidate, { ...indexed, links });
  assert.equal(position.status, "SITE_CONFIRMED");
  assert.equal(position.siret, "26850025300011");
  assert.equal(position.latitude, 46.9742242);
  assert.equal(position.longitude, -1.9937342);
  assert.equal(position.source.recordId, "node:9056350135");
  assert.equal(position.source.version, 4);
  assert.equal(position.source.updatedAt, "2025-11-01T15:45:18Z");
  assert.equal(position.source.generatedAt, "2026-10-02T21:57:01Z");
  assert.equal(position.source.tags.source, element.tags.source, "the original cadastre date is retained without claiming a fresh survey");
  assert.deepEqual(position.proof.map(item => item.kind), ["EXPLICIT_SIRET", "EXPLICIT_GEOGRAPHIC_FINESS", "OFFICIAL_REVALIDATION"]);
  const proof = position.proof.find(item => item.kind === "EXPLICIT_GEOGRAPHIC_FINESS");
  assert.equal(proof.finess, "850002163");
  assert.equal(proof.categoryCode, "500");
  assert.equal(proof.registryEvidence.siret, position.siret);
  assert.deepEqual(proof.officialBinding.finessIds, ["850002163"]);
});

test("the real browser service returns a single verified EHPAD candidate with its OSM position without calling live Overpass", async () => {
  const result = await resolveEstablishmentForEnrichment({ row, resolveIdentity: async () => identity,
    findIndexedPositions: options => findIndexedSitePositions({ ...options,
      manifestUrl: "https://coherent.test/contact-indexes/indexed-departments.json",
      fetchImpl: async url => String(url).includes("osm-finess/") ? Response.json(shard)
        : String(url).includes("indexed-departments") ? Response.json(manifest) : new Response("", { status: 404 }),
    }),
    findOsmPositions: async () => assert.fail("a demonstrated indexed point must not await Overpass"),
  });
  assert.equal(result.candidate.identityStatus, "MATCH_VERIFIED");
  assert.equal(result.candidate.nomCommercial, "EHPAD LA REYNERIE");
  assert.equal(result.candidate.siret, "26850025300011");
  assert.equal(result.candidate.latitude, 46.9742242);
  assert.equal(result.candidate.longitude, -1.9937342);
  assert.equal(result.candidate.position.status, "SITE_CONFIRMED");
  assert.deepEqual(result.alternatives, []);
});

test("an exact geographic FINESS reference suffices without an OSM SIRET only after current Annuaire binds that FINESS to this SIRET", () => {
  const poi = changedPoi({ "ref:FR:SIRET": undefined });
  assert.equal(resolveSitePosition(candidate, { observations: [poi], links }).status, "SITE_CONFIRMED");
  for (const invalidLinks of [[], links.map(link => ({ ...link, verifiedOfficial: false })),
    links.map(link => ({ ...link, officialBinding: { siret: candidate.siret, finessIds: [] } })),
    links.map(link => ({ ...link, registryEvidence: { ...link.registryEvidence, type: "EJ" } }))]) {
    const position = resolveSitePosition(candidate, { observations: [poi], links: invalidLinks });
    assert.equal(position.status, "UNRESOLVED");
    assert.equal(position.latitude, null);
  }
});

test("an SSIAD or neighbouring establishment never supplies EHPAD coordinates even at the identical point", () => {
  for (const poi of [
    changedPoi({ name: "SSIAD La Reynerie", "ref:FR:SIRET": "26850025300045", "ref:FR:FINESS": "850014655", "type:FR:FINESS": "354", social_facility: "outreach" }),
    changedPoi({ "ref:FR:SIRET": "26850025300045", "ref:FR:FINESS": "850014655" }),
    changedPoi({ "ref:FR:SIRET": undefined, "ref:FR:FINESS": undefined }),
  ]) {
    const position = resolveSitePosition(candidate, { observations: [poi], links });
    assert.equal(position.status, "UNRESOLVED");
    assert.equal(position.latitude, null);
    const withCorrectSite = resolveSitePosition(candidate, { observations: [observation, poi], links });
    assert.equal(withCorrectSite.status, "SITE_CONFIRMED", "an unrelated neighbour is rejected, not a contradiction of the linked site");
    assert.equal(withCorrectSite.latitude, observation.latitude);
  }
});

for (const [label, tags] of [
  ["same FINESS with another SIRET", { "ref:FR:SIRET": "26850025300045" }],
  ["same SIRET with another FINESS", { "ref:FR:FINESS": "850014655" }],
  ["mixed geographic FINESS references", { "ref:FR:FINESS": "850002163;850014655" }],
  ["SSIAD category", { "type:FR:FINESS": "354" }],
  ["home-care POI type even with copied EHPAD identifiers", { social_facility: "outreach" }],
  ["home-care type with SIRET only", { "ref:FR:FINESS": undefined, social_facility: "outreach" }],
  ["another public facility name", { name: "La Madeleine" }],
  ["SSIAD named as the same operator", { name: "SSIAD La Reynerie" }],
  ["contradictory site address", { "addr:housenumber": "7bis", "addr:street": "Rue du Pays de Retz", "addr:postcode": "85300", "addr:city": "Sallertaine" }],
  ["malformed additional identifier", { "ref:FR:SIRET": "SIRET 26850025300011 invalid" }],
]) {
  test(`a linked identity/POI contradiction (${label}) causes abstention even alongside the correct observation`, () => {
    const position = resolveSitePosition(candidate, { observations: [observation, changedPoi(tags)], links });
    assert.equal(position.status, "CONFLICT");
    assert.equal(position.latitude, null);
    assert.equal(position.longitude, null);
  });
}

test("a matching street geocode remains discovery even when it carries copied SIRET/FINESS", () => {
  const poi = changedPoi({ highway: "residential", amenity: undefined, social_facility: undefined });
  assert.equal(poi.kind, "address");
  const result = resolveSitePosition(candidate, { observations: [poi], links,
    discovery: [{ latitude: 46.974887, longitude: -1.993633, type: "street" }],
  });
  assert.equal(result.status, "UNRESOLVED");
  assert.equal(result.latitude, null);
});

test("two demonstrated points for the same FINESS separated by more than 75 m abstain instead of averaging", () => {
  const other = { ...observation, latitude: observation.latitude + 0.002, source: { ...observation.source, recordId: "node:999" } };
  assert.equal(resolveSitePosition(candidate, { observations: [observation, other], links }).status, "CONFLICT");
});

test("a neighbour's 7bis address contradicts the requested 8bis even when Annuaire omits the house number", () => {
  const poi = changedPoi({ "addr:housenumber": "7bis", "addr:street": "Rue du Pays de Retz", "addr:postcode": "85230", "addr:city": "Bouin" });
  const position = resolveSitePosition(candidate, { observations: [observation, poi], links, requestedAddress: row.Adresse });
  assert.equal(position.status, "CONFLICT");
  assert.equal(position.latitude, null);
});

test("even without POI identifiers an exact attested name/address cannot override a contradictory SSIAD type", () => {
  const poi = { ...changedPoi({ name: "EHPAD LA REYNERIE", "ref:FR:SIRET": undefined,
    "ref:FR:FINESS": undefined, "type:FR:FINESS": "354", social_facility: "outreach" }), adresse: candidate.adresse };
  for (const observations of [[poi], [observation, poi]]) {
    const position = resolveSitePosition(candidate, { observations, links });
    assert.equal(position.status, "CONFLICT");
    assert.equal(position.latitude, null);
  }
});

test("a shorter public name cannot be accepted from SIRET or name alone without matching FINESS category", () => {
  for (const poi of [changedPoi({ "ref:FR:FINESS": undefined }), changedPoi({ "type:FR:FINESS": undefined })]) {
    const result = resolveSitePosition(candidate, { observations: [poi], links });
    assert.equal(result.status, "CONFLICT");
    assert.equal(result.latitude, null);
  }
});

test("probable identity and missing/stale geographic bindings never start a FINESS position lookup", async () => {
  const noFetch = async () => assert.fail("unverified identity cannot start a position identifier lookup");
  assert.deepEqual((await lookup({ identityStatus: "MATCH_PROBABLE", fetchImpl: noFetch })).observations, []);
  assert.deepEqual((await lookup({ links: [], fetchImpl: noFetch })).observations, []);
});

test("missing, duplicate, truncated or oversized OSM index assets cannot introduce coordinates", async () => {
  for (const payload of [{ ...shard, prefix: "440000" }, { ...shard, recordCount: shard.recordCount + 1 },
    { ...shard, records: [...shard.records, shard.records[0]], recordCount: shard.recordCount + 1 },
    { ...shard, source: { ...shard.source, generatedAt: null } },
    { ...shard, padding: "x".repeat(OSM_POSITION_INDEX_BUDGET.maxShardBytes) }]) {
    const result = await lookup({ fetchImpl: async () => Response.json(payload) });
    assert.deepEqual(result.observations, []);
    assert.equal(result.coverage[0].status, "error");
  }
  assert.deepEqual((await lookup({ fetchImpl: async () => new Response("", { status: 404 }) })).observations, []);
});

test("a same-SIRET point with another FINESS in the loaded cohort remains a visible identity contradiction", async () => {
  const wrong = { ...element, tags: { ...element.tags, "ref:FR:FINESS": "850002999" } };
  const indexed = await lookup({ fetchImpl: async () => Response.json({ ...shard, recordCount: 1, records: [wrong] }) });
  assert.equal(indexed.observations.length, 1);
  assert.equal(resolveSitePosition(candidate, { ...indexed, links }).status, "CONFLICT");
});

test("a fast FINESS point survives a hanging postcode manifest at the optional position deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let manifestSignal;
  const pending = resolveEstablishmentForEnrichment({ row, resolveIdentity: async () => identity,
    findIndexedPositions: options => findIndexedSitePositions({ ...options,
      manifestUrl: "https://hanging.test/contact-indexes/indexed-departments.json",
      fetchImpl: async (url, options) => {
        if (String(url).includes("osm-finess/")) return Response.json(shard);
        manifestSignal = options.signal;
        return new Promise(() => {});
      },
    }),
    findOsmPositions: async () => assert.fail("completed exact-FINESS evidence must survive timeout without starting Overpass"),
  });
  await settle();
  t.mock.timers.tick(10000);
  await settle();
  const result = await pending;
  assert.equal(manifestSignal.aborted, true);
  assert.equal(result.candidate.position.status, "SITE_CONFIRMED");
  assert.equal(result.candidate.latitude, 46.9742242);
});

test("late identifier position responses after an aborted Grist selection cannot add evidence to the next candidate", async () => {
  const controller = new AbortController();
  let release;
  const partial = { observations: [], coverage: [] };
  const pending = findIndexedSitePositions({ candidate, links, identityStatus: "MATCH_VERIFIED", signal: controller.signal, partial,
    manifestUrl: "https://cancelled.test/contact-indexes/indexed-departments.json",
    fetchImpl: async url => String(url).includes("osm-finess/") ? new Promise(resolve => { release = () => resolve(Response.json(shard)); }) : Response.json(manifest),
  });
  await settle();
  controller.abort();
  release();
  await pending;
  assert.deepEqual(partial.observations, []);
});

test("live OSM fallback searches exact SIRET and revalidated FINESS, preserving full object metadata without proximity queries", async () => {
  const result = await findOsmSiretPositions({ candidate, links, identityStatus: "MATCH_VERIFIED", fetchImpl: async (url, options) => {
    const query = new URLSearchParams(options.body).get("data");
    assert.match(query, /ref:FR:SIRET.*26850025300011/);
    assert.match(query, /ref:FR:FINESS.*850002163/);
    assert.match(query, /out meta center/);
    assert.doesNotMatch(query, /around|name|Bouin|Reynerie/);
    return Response.json(osm);
  } });
  assert.equal(resolveSitePosition(candidate, { ...result, links }).status, "SITE_CONFIRMED");
  assert.equal(result.observations[0].source.version, 4);
});

test("published position shards cover a generic departmental cohort and preserve point provenance within the browser budget", async () => {
  const directory = new URL("../site-position-indexes/osm-finess/", import.meta.url);
  const files = (await readdir(directory)).filter(name => name.endsWith(".json"));
  assert.ok(files.length > 50, "the production index is not a single-establishment fixture");
  let count = 0;
  for (const file of files) {
    assert.ok((await stat(new URL(file, directory))).size <= OSM_POSITION_INDEX_BUDGET.maxShardBytes);
    const payload = JSON.parse(await readFile(new URL(file, directory), "utf8"));
    assert.equal(payload.recordCount, payload.records.length);
    assert.equal(payload.prefix, file.slice(0, 6));
    assert.match(payload.source.query, /nwr\["ref:FR:FINESS"/);
    assert.doesNotMatch(payload.source.query, /Reynerie|Bouin|850002163/);
    for (const record of payload.records) {
      const poi = osmSitePositionFromElement(record, payload.source);
      assert.equal(record.type, "node");
      assert.equal(poi.kind, "site");
      assert.ok(poi.finessIds.some(id => id.startsWith(payload.prefix)));
      assert.ok(record.timestamp && record.version);
      assert.equal(Object.hasOwn(record, "user"), false);
    }
    count += payload.recordCount;
  }
  assert.ok(count > 500);
});
