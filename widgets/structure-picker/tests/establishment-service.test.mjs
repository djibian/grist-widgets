import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
import { resolveEstablishmentForEnrichment } from "../establishment-service.js";

test("failed optional position sources preserve a verified identity and cannot substitute administrative coordinates", async () => {
  const candidate = { siret: "12345678900011", raisonSociale: "TEST", adresse: "1 RUE A 44000 NANTES", latitude: 47, longitude: -1.8 };
  const result = await resolveEstablishmentForEnrichment({
    row: { NomCommercial: "Test public" },
    resolveIdentity: async () => ({ decision: { status: "MATCH_VERIFIED", candidate }, links: [], geocodeCandidates: [{ latitude: 47.1, longitude: -1.9 }] }),
    findIndexedPositions: async () => { throw new Error("index unavailable"); },
    findOsmPositions: async () => { throw new Error("OSM unavailable"); },
  });
  assert.equal(result.decision.status, "MATCH_VERIFIED");
  assert.equal(result.candidate.siret, candidate.siret);
  assert.equal(result.candidate.latitude, null);
  assert.equal(result.candidate.position.status, "UNRESOLVED");
  assert.equal(result.candidate.position.coverage.filter(item => item.status === "error").length, 2);
  assert.equal(result.candidate.position.evidence.find(item => item.kind === "administrative").latitude, 47);
});

test("ambiguous identities cannot start position lookup or expose unqualified coordinates on their alternatives", async () => {
  let calls = 0;
  const result = await resolveEstablishmentForEnrichment({
    row: {}, resolveIdentity: async () => ({ decision: { status: "AMBIGUOUS", alternatives: [{ siret: "12345678900011", latitude: 47, longitude: -1.8 }] } }),
    findIndexedPositions: async () => { calls += 1; }, findOsmPositions: async () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(result.candidate, null);
  assert.equal(result.alternatives[0].latitude, null);
  assert.equal(result.alternatives[0].position.status, "UNRESOLVED");
});

test("both optional sources ignoring AbortSignal still finish within the position budget", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = () => new Promise(() => {});
  const operation = resolveEstablishmentForEnrichment({
    row: {}, resolveIdentity: async () => ({ decision: { status: "MATCH_VERIFIED", candidate: { siret: "12345678900011" } } }),
    findIndexedPositions: pending, findOsmPositions: pending,
  });
  await settle();
  t.mock.timers.tick(10000);
  await settle();
  t.mock.timers.tick(1500);
  const result = await operation;
  assert.equal(result.decision.status, "MATCH_VERIFIED");
  assert.equal(result.candidate.position.status, "UNRESOLVED");
  assert.equal(result.candidate.position.coverage.filter(item => item.status === "timeout").length, 2);
});

test("an already cancelled Grist selection starts no source and rejects cleanly", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(resolveEstablishmentForEnrichment({ row: {}, signal: controller.signal, resolveIdentity: async () => { assert.fail("must not start identity lookup"); } }), { name: "AbortError" });
});
