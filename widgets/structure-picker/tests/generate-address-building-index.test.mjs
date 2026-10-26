import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildAddressBuildingShards, captureBuildingSnapshot } from "../../../scripts/generate-address-building-index.mjs";
import { validateAddressBuildingRecord } from "../address-building-positions.js";

const snapshot = JSON.parse(await readFile(new URL("./fixtures/address-building-snapshot.json", import.meta.url), "utf8"));
const generator = fileURLToPath(new URL("../../../scripts/generate-address-building-index.mjs", import.meta.url));

test("the complete real street cohort reproduces all published proofs, including two distinct n°10 buildings", async () => {
  assert.equal(snapshot.ban.length, 20);
  const shards = buildAddressBuildingShards(snapshot);
  assert.equal([...shards.values()].reduce((sum, shard) => sum + shard.recordCount, 0), 6);
  for (const [filename, shard] of shards) {
    const published = JSON.parse(await readFile(new URL(`../site-position-indexes/address-buildings/${filename}`, import.meta.url), "utf8"));
    assert.deepEqual(shard, published);
    for (const record of published.records) assert.equal(validateAddressBuildingRecord(record).accepted, true);
  }
  const ten = shards.get("85300/10.json");
  assert.equal(ten.recordCount, 2);
  assert.deepEqual(ten.records.map(record => record.rnb.rnb_id), ["43H9GCSB54PW", "6256NPD4SRW3"]);
  assert.notDeepEqual(ten.records[0].rnb.point, ten.records[1].rnb.point);
});

function sourceFetch({ repeatPage = false, profile = "api_open_202602a_1", noCap = false } = {}) {
  const calls = [];
  const fetchImpl = async rawUrl => {
    const url = new URL(rawUrl); calls.push(url);
    if (url.hostname === "data.geopf.fr") return Response.json({ features: snapshot.ban, numberMatched: snapshot.ban.length });
    if (url.hostname === "rnb-api.beta.gouv.fr") return Response.json(snapshot.buildings.find(building => building.rnb_id === url.pathname.split("/").filter(Boolean).at(-1)));
    const table = url.pathname.split("/").at(-1);
    const rows = table === "rel_batiment_groupe_adresse" ? snapshot.relations.filter(relation => `eq.${relation.cle_interop_adr}` === url.searchParams.get("cle_interop_adr"))
      : table === "batiment_construction" ? snapshot.constructions : snapshot.groups;
    const offset = repeatPage ? 0 : Number(url.searchParams.get("offset"));
    return Response.json(rows.slice(offset, offset + 2), { headers: { "Content-Profile": profile, ...(noCap ? {} : { "X-Max-Items-Per-Call": "2" }) } });
  };
  return { calls, fetchImpl };
}

test("offline capture honours the actual public API row cap instead of silently treating a capped page as complete", async () => {
  const source = sourceFetch();
  const captured = await captureBuildingSnapshot({ streets: snapshot.source.streets, version: snapshot.source.version, fetchImpl: source.fetchImpl });
  assert.equal(captured.relations.length, snapshot.relations.length);
  assert.equal(captured.constructions.length, snapshot.constructions.length);
  assert.equal(captured.groups.length, snapshot.groups.length);
  assert.equal(captured.buildings.length, snapshot.buildings.length);
  assert.ok(source.calls.some(url => url.searchParams.get("offset") === "2"));
  assert.equal(buildAddressBuildingShards(captured).get("85300/10.json").recordCount, 2);
});

test("ignored pagination or a changed BDNB schema prevents a supposedly complete snapshot", async () => {
  for (const options of [{ repeatPage: true }, { profile: "api_open_another_version" }]) {
    await assert.rejects(captureBuildingSnapshot({ streets: snapshot.source.streets, version: snapshot.source.version, fetchImpl: sourceFetch(options).fetchImpl }), /pagination|schema/);
  }
});

test("a server omitting its page-size header must reach an empty page rather than truncate the source", async () => {
  const captured = await captureBuildingSnapshot({ streets: snapshot.source.streets, version: snapshot.source.version, fetchImpl: sourceFetch({ noCap: true }).fetchImpl });
  assert.equal(captured.relations.length, snapshot.relations.length);
  assert.equal(captured.groups.length, snapshot.groups.length);
  assert.equal(captured.buildings.length, snapshot.buildings.length);
});

test("missing completeness or duplicated primary source identifiers cannot produce an index", () => {
  assert.throws(() => buildAddressBuildingShards({ ...snapshot, complete: false }), /Incomplete/);
  assert.throws(() => buildAddressBuildingShards({ ...snapshot, ban: [...snapshot.ban, snapshot.ban[0]] }), /Duplicate/);
  assert.throws(() => buildAddressBuildingShards({ ...snapshot, relations: [...snapshot.relations, snapshot.relations[0]] }), /Duplicate/);
});

test("invalid or oversized snapshots leave the previously published data intact", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "address-building-index-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "published");
  await mkdir(path.join(output, "85300"), { recursive: true });
  const previous = path.join(output, "85300/10.json");
  await writeFile(previous, "already-published-evidence\n");
  const huge = structuredClone(snapshot);
  huge.groups.find(group => group.batiment_groupe_id === "bdnb-bg-WMTA-N6CM-TNWA").padding = "x".repeat(100000);
  for (const invalid of [{ ...snapshot, complete: false }, huge]) {
    const input = path.join(directory, "input.json");
    await writeFile(input, JSON.stringify(invalid));
    const result = spawnSync(process.execPath, [generator, "--input", input, "--output", output], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(previous, "utf8"), "already-published-evidence\n");
  }
});
