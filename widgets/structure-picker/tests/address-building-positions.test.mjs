import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractOfficialCandidates } from "../search.js";
import { resolveEstablishmentForEnrichment } from "../establishment-service.js";
import { resolveSitePosition } from "../establishment-position.js";
import { findIndexedSitePositions } from "../site-position-sources.js";
import { sameNumberedSiteAddress, findIndexedAddressBuildings, validateAddressBuildingRecord, pointInsideSingleBuilding, ADDRESS_BUILDING_BUDGET } from "../address-building-positions.js";

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const payload = await fixture("pom-building");
const record = payload.records[0];
const annuaire = await fixture("pom-annuaire");
const neighbour = (await fixture("pom-neighbour-rnb")).results[0];
const candidates = extractOfficialCandidates(annuaire).items;
const candidate = candidates.find(item => item.siret === "88493583400033");
const row = { NomCommercial: "CRECHE POM'DE RAINETTE", Adresse: "10 BIS RUE DES MARGOTINS 85300 SALLERTAINE", SirenSiret: "" };
const emptyManifest = { schemaVersion: 1, sources: {} };
const lookup = overrides => findIndexedAddressBuildings({ candidate, identityStatus: "MATCH_VERIFIED", fetchImpl: async () => Response.json(payload), ...overrides });
const options = { identityStatus: "MATCH_VERIFIED", requestedAddress: row.Adresse };
const clone = () => structuredClone(record);
const settle = async () => { for (let i = 0; i < 80; i += 1) await Promise.resolve(); };

test("the real confirmed POM identity remains unlocated without a site observation", () => {
  const position = resolveSitePosition(candidate, { ...options, discovery: [{ latitude: 46.868553, longitude: -1.94211, type: "housenumber" }] });
  assert.equal(position.status, "UNRESOLVED");
  assert.equal(position.latitude, null);
});

test("real Annuaire → exact certified BAN address → unique high-reliability BDNB construction → active RNB footprint locates POM", async () => {
  const indexed = await lookup();
  assert.equal(indexed.observations.length, 1);
  const result = resolveSitePosition(candidate, { ...indexed, ...options });
  assert.equal(result.siret, "88493583400033");
  assert.equal(result.status, "SITE_CORROBORATED");
  assert.equal(result.latitude, 46.868617815626294);
  assert.equal(result.longitude, -1.942076105568997);
  assert.equal(result.source.recordId, "6256NPD4SRW3");
  assert.equal(result.source.version, "202602a_1");
  assert.equal(result.source.geometry, "building-point");
  assert.equal(new URL(result.source.bdnb.url).searchParams.get("cle_interop_adr"), "eq.85280_0250_00010_bis");
  assert.equal(new URL(result.source.ban.url).searchParams.get("CQL_FILTER"), "id='85280_0250_00010_bis'");
  assert.notEqual(result.latitude, record.ban.geometry.coordinates[1], "the certified entrance is not promoted as the building point");
  assert.equal(pointInsideSingleBuilding([result.longitude, result.latitude], record.rnb.shape), true);
  assert.deepEqual(result.proof.map(proof => proof.kind), ["OFFICIAL_SITE_ADDRESS", "CERTIFIED_BAN_ADDRESS", "UNIQUE_OFFICIAL_BUILDING", "RNB_BUILDING_FOOTPRINT"]);
  assert.equal(result.proof[2].relation.fiabilite, 17);
  assert.equal(result.proof[2].construction.rnb_id, result.source.recordId);
  assert.equal(result.proof[3].building.ext_ids[0].source_version, "2024-03-15");
});

test("the actual establishment pipeline confirms POM and returns its building without live geocoding or Overpass", async () => {
  const calls = [];
  const result = await resolveEstablishmentForEnrichment({ row,
    fetchOfficial: async () => ({ ...extractOfficialCandidates(annuaire), cached: false }),
    findPublishedLinks: async () => ({ candidates: [] }),
    geocode: async () => assert.fail("the complete identity and local address graph do not require geocoding"),
    findIndexedPositions: sourceOptions => findIndexedSitePositions({ ...sourceOptions,
      manifestUrl: "https://pom-real.test/contact-indexes/indexed-departments.json",
      fetchImpl: async url => {
        calls.push(String(url));
        return String(url).includes("address-buildings/") ? Response.json(payload) : Response.json(emptyManifest);
      },
    }),
    findOsmPositions: async () => assert.fail("a demonstrated local building must not wait for Overpass"),
  });
  assert.equal(result.decision.status, "MATCH_VERIFIED");
  assert.equal(result.candidate.raisonSociale, "PICOTI PICOTA");
  assert.equal(result.candidate.siret, "88493583400033");
  assert.equal(result.candidate.position.source.recordId, "6256NPD4SRW3");
  assert.equal(result.candidate.latitude, 46.868617815626294);
  assert.deepEqual(result.alternatives, []);
  assert.equal(calls.filter(url => url.includes("address-buildings/")).length, 1);
});

test("10, 10bis, 10ter and a missing house number are never interchangeable; SIRENE B and BIS are equivalent", async () => {
  assert.equal(sameNumberedSiteAddress(candidate.adresse, row.Adresse), true);
  for (const adresse of ["10 RUE DES MARGOTINS 85300 SALLERTAINE", "10 TER RUE DES MARGOTINS 85300 SALLERTAINE",
    "RUE DES MARGOTINS 85300 SALLERTAINE", "10 BIS RUE DES MARGOTINS 85300 CHALLANS"]) {
    assert.equal(sameNumberedSiteAddress(adresse, row.Adresse), false);
    const indexed = await lookup({ candidate: { ...candidate, adresse } });
    assert.deepEqual(indexed.observations, []);
  }
  const indexed = await lookup();
  assert.equal(resolveSitePosition(candidate, { ...indexed, ...options, requestedAddress: "10 RUE DES MARGOTINS 85300 SALLERTAINE" }).status, "UNRESOLVED");
});

test("the other Picoti Picota site cannot inherit POM coordinates through a shared operator or SIREN", async () => {
  const indexed = await lookup();
  const other = { ...candidate, siret: "88493583400025", adresse: "2 BIS IMPASSE DE LA CAILLAUDIERE 85300 SALLERTAINE" };
  const result = resolveSitePosition(other, { ...indexed, identityStatus: "MATCH_VERIFIED", requestedAddress: other.adresse });
  assert.equal(result.status, "UNRESOLVED");
  assert.equal(result.latitude, null);
});

for (const [label, change] of [
  ["street centroid", value => { value.ban.properties.type_position = "segment"; }],
  ["unspecified address point", value => { value.ban.properties.type_position = "inconnue"; }],
  ["postal delivery point", value => { value.ban.properties.type_position = "délivrance postale"; }],
  ["uncertified address", value => { value.ban.properties.certification_commune = "0"; }],
  ["weak distance-like relation", value => { value.relations[0].fiabilite = 4; }],
  ["no guaranteed fiscal/parcel evidence", value => { value.relations[0].fiabilite = 16; }],
  ["another address key", value => { value.relations[0].cle_interop_adr = "85280_0250_00010"; }],
  ["another principal address", value => { value.group.cle_interop_adr_principale_ban = "85280_0250_00010"; }],
  ["another building group", value => { value.constructions[0].batiment_groupe_id = "another-group"; }],
  ["ambiguous group relation, even when the competitor has a lower score", value => { value.relations.push({ ...value.relations[0], batiment_groupe_id: "another-group", fiabilite: 1 }); }],
  ["multiple constructions", value => { value.constructions.push({ ...value.constructions[0], batiment_construction_id: "another-construction" }); }],
  ["fictive geometry", value => { value.group.contient_fictive_geom_groupe = true; }],
  ["fictive construction", value => { value.constructions[0].fictive_geom_cstr = true; }],
  ["inactive RNB", value => { value.rnb.is_active = false; }],
  ["demolished building", value => { value.rnb.status = "demolished"; }],
  ["unknown footprint", value => { value.rnb.shape = value.rnb.point; }],
  ["a point outside the roof", value => { value.rnb.point.coordinates = value.ban.geometry.coordinates; }],
  ["the actual neighbouring n°10 RNB", value => { value.rnb = neighbour; }],
  ["a matching copied RNB ID cannot override the neighbour's n°10 address", value => { value.rnb = neighbour; value.constructions[0].rnb_id = neighbour.rnb_id; }],
  ["the neighbour's geometry without addresses still contradicts the BDNB building point", value => { value.rnb = { ...neighbour, addresses: [] }; value.constructions[0].rnb_id = neighbour.rnb_id; }],
]) {
  test(`rejects ${label} without choosing the nearest point`, () => {
    const value = clone(); change(value);
    assert.equal(validateAddressBuildingRecord(value).accepted, false);
    assert.equal(resolveSitePosition(candidate, { ...options, observations: [{ kind: "building", record: value }] }).latitude, null);
  });
}

test("probable identity never loads or attaches a building", async () => {
  assert.deepEqual((await lookup({ identityStatus: "MATCH_PROBABLE", fetchImpl: async () => assert.fail("not confirmed") })).observations, []);
  const indexed = await lookup();
  assert.equal(resolveSitePosition(candidate, { ...indexed, identityStatus: "MATCH_PROBABLE" }).status, "UNRESOLVED");
});

test("a proven building and a contradictory explicitly linked POI cause abstention instead of averaging", async () => {
  const indexed = await lookup();
  const poi = { kind: "site", siret: candidate.siret, name: candidate.aliases[0], adresse: candidate.adresse,
    latitude: 46.858, longitude: -1.898, source: { id: "osm", label: "OpenStreetMap", recordId: "node:42" } };
  const result = resolveSitePosition(candidate, { ...indexed, ...options, observations: [...indexed.observations, poi] });
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.latitude, null);
});

test("polygons with a point in a hole, on its boundary, or in separate building components cannot establish one roof", () => {
  const square = [[-2,46],[-1,46],[-1,47],[-2,47],[-2,46]];
  const hole = [[-1.8,46.2],[-1.2,46.2],[-1.2,46.8],[-1.8,46.8],[-1.8,46.2]];
  assert.equal(pointInsideSingleBuilding([-1.5,46.5], { type: "Polygon", coordinates: [square,hole] }), false);
  assert.equal(pointInsideSingleBuilding([-1.8,46.5], { type: "Polygon", coordinates: [square,hole] }), false);
  assert.equal(pointInsideSingleBuilding([-1.5,46.5], { type: "MultiPolygon", coordinates: [[square],[square]] }), false);
  assert.equal(pointInsideSingleBuilding([-1.5,46.5], { type: "Polygon", coordinates: [square,[]] }), false);
});

test("incomplete, duplicate, wrong-path and oversized index files cannot introduce a position", async () => {
  for (const invalid of [{ ...payload, complete: false }, { ...payload, path: "85300/11.json" },
    { ...payload, recordCount: 2 }, { ...payload, recordCount: 2, records: [record,record] },
    { ...payload, source: { ...payload.source, version: null } }, { ...payload, padding: "x".repeat(ADDRESS_BUILDING_BUDGET.maxShardBytes) }]) {
    const indexed = await lookup({ fetchImpl: async () => Response.json(invalid) });
    assert.equal(indexed.coverage[0].status, "error");
    assert.deepEqual(indexed.observations, []);
  }
});

test("late building index responses after abort cannot supply another Grist selection's position", async () => {
  const controller = new AbortController(); let release;
  const pending = lookup({ signal: controller.signal, fetchImpl: async () => new Promise(resolve => { release = () => resolve(Response.json(payload)); }) });
  controller.abort(); release();
  assert.deepEqual((await pending).observations, []);
});

test("the completed building proof survives an optional postcode manifest ignoring abort at its deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = resolveEstablishmentForEnrichment({ row,
    resolveIdentity: async () => ({ decision: { status: "MATCH_VERIFIED", candidate }, links: [], geocodeCandidates: [] }),
    findIndexedPositions: sourceOptions => findIndexedSitePositions({ ...sourceOptions,
      manifestUrl: "https://building-timeout.test/contact-indexes/indexed-departments.json",
      fetchImpl: async url => String(url).includes("address-buildings/") ? Response.json(payload) : new Promise(() => {}),
    }),
    findOsmPositions: async () => assert.fail("completed building evidence must survive without Overpass"),
  });
  await settle(); t.mock.timers.tick(10000); await settle();
  const result = await pending;
  assert.equal(result.candidate.latitude, 46.868617815626294);
  assert.equal(result.candidate.identityStatus, "MATCH_VERIFIED");
});
