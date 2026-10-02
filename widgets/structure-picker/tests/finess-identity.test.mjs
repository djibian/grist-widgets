import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildFinessLookupUrl, findFinessIdentityLinks, finessIdentityLink, FINESS_BUDGET } from "../finess-identity.js";
import { extractOfficialCandidates } from "../search.js";
import { resolveStructureIdentity } from "../identity-orchestrator.js";
import { resolveIdentityForEnrichment } from "../identity-service.js";
import { resolveEstablishmentForEnrichment } from "../establishment-service.js";
import { candidateCertificate, decideIdentity } from "../identity-resolution.js";

const officialPayload = JSON.parse(await readFile(new URL("./fixtures/ehpad-annuaire.json", import.meta.url), "utf8"));
const sectorPayload = JSON.parse(await readFile(new URL("./fixtures/ehpad-finess.json", import.meta.url), "utf8"));
const candidates = extractOfficialCandidates(officialPayload).items;
const ehpad = candidates.find(item => item.siret === "26850025300011");
const ssiad = candidates.find(item => item.siret === "26850025300045");
const association = candidates.find(item => item.siret === "89405714000010");
const record = sectorPayload.records[0];
const info = record.informationsGeneralesEGE;
const source = sectorPayload.source;
const row = { NomCommercial: "EHPAD La Reynerie Bouin 85230", Adresse: "8bis Rue du Pays de Retz 85230 Bouin", SirenSiret: "" };
const geocode = async () => [{ latitude: 46.973772, longitude: -1.995070, label: row.Adresse }];
const noPublished = async () => ({ candidates: [] });
const sourceUrl = buildFinessLookupUrl(info.numFinessEge, info.siret);
const fallback = () => resolveStructureIdentity({ row, geocode, fetchOfficial: async () => ({ items: candidates, coverage: { complete: true } }) });
const lookup = options => findFinessIdentityLinks({ ...options, fetchImpl: async () => Response.json(sectorPayload) });
const fresh = async () => ({ items: [ehpad], coverage: { complete: true } });
const options = { row, geocode, findPublishedLinks: noPublished, fetchOfficial: fresh, resolveFallback: fallback, findSectorLinks: lookup };
const settle = async () => { for (let i = 0; i < 60; i += 1) await Promise.resolve(); };

test("the real Annuaire response reproduces precisely the missing public-name/address proof", async () => {
  const result = await fallback();
  assert.equal(result.decision.status, "MATCH_PROBABLE");
  assert.equal(result.decision.candidate.siret, "26850025300011");
  const proof = result.decision.certificates.find(item => item.siret === ehpad.siret);
  assert.equal(proof.address.compatible, true);
  assert.equal(proof.address.complete, false, "Annuaire omits the 8bis house number");
  assert.equal(proof.names.exactDistinctiveAlias, false, "EHPAD alone is a generic alias");
  assert.equal(proof.explicitLink, false);
  assert.deepEqual(ehpad.finessIds, ["850002163"]);
  assert.equal(result.decision.certificates.find(item => item.siret === ssiad.siret).admissible, false);
  assert.equal(result.decision.certificates.find(item => item.siret === association.siret).admissible, false);
});

test("the real geographic FINESS record completes the identity chain with fresh per-site Annuaire binding", async () => {
  const calls = [];
  const result = await resolveIdentityForEnrichment({ ...options, fetchOfficial: async (request, fetchOptions) => {
    calls.push({ request, fetchOptions });
    return fresh();
  } });
  assert.equal(result.decision.status, "MATCH_VERIFIED");
  assert.equal(result.decision.candidate.siret, "26850025300011");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.requestedSiret, ehpad.siret);
  assert.equal(calls[0].fetchOptions.cacheTtlMs, 0);
  const link = result.links[0];
  assert.equal(link.verifiedOfficial, true);
  assert.deepEqual(link.officialBinding.finessIds, ["850002163"]);
  assert.equal(link.registryEvidence.type, "EGE");
  assert.equal(link.registryEvidence.status, "A");
  assert.equal(link.registryEvidence.siret, ehpad.siret);
  assert.equal(link.registryEvidence.categoryCode, "500");
  assert.equal(link.sourcePublishedAt, source.generatedAt);
  assert.match(link.sourceUrl, /\/ege\/147262$/);
  assert.match(link.registryEvidence.snapshotUrl, /finess-structures-journalier-20261002/);
  assert.match(result.decision.certificates.find(item => item.siret === ehpad.siret).explanations.join(" "), /FINESS géographique 850002163.*SIRET 26850025300011.*revalidé/);
});

test("FINESS identity proof stays within the single candidate and never promotes its street-level coordinates", async () => {
  const result = await resolveEstablishmentForEnrichment({ ...options,
    findIndexedPositions: async () => ({ observations: [], coverage: [] }),
    findOsmPositions: async () => ({ observations: [], coverage: [] }),
  });
  assert.equal(result.candidate.identityStatus, "MATCH_VERIFIED");
  assert.equal(result.candidate.nomCommercial, "EHPAD LA REYNERIE");
  assert.equal(result.candidate.siret, ehpad.siret);
  assert.equal(result.candidate.position.status, "UNRESOLVED");
  assert.equal(result.candidate.latitude, null);
  assert.equal(result.candidate.longitude, null);
  assert.equal(result.candidate.identityLinks[0].registryEvidence.addressPosition.precision, "Précision de site non documentée");
  assert.equal(result.candidate.identityLinks[0].registryEvidence.addressPosition.latitude, "46.974887");
  assert.deepEqual(result.alternatives, []);
});

test("registry proof cannot attach the EHPAD to the neighbouring SSIAD or the co-addressed association", () => {
  assert.equal(finessIdentityLink(record, ssiad, row, source, sourceUrl), null);
  assert.equal(finessIdentityLink(record, association, row, source, sourceUrl), null);
  assert.equal(finessIdentityLink(record, ehpad, { ...row, NomCommercial: "SSIAD La Reynerie Bouin 85230" }, source, sourceUrl), null);
  // Even a manually supplied SIRET link is insufficient without the fresh FINESS binding.
  const forged = { ...finessIdentityLink(record, ehpad, row, source, sourceUrl), verifiedOfficial: true };
  assert.equal(candidateCertificate(row, ehpad, { links: [forged] }).level, "probable");
});

for (const [label, change] of [
  ["another SIRET", { info: { siret: "26850025300045" } }],
  ["SIREN only", { info: { siret: "268500253" } }],
  ["a legal entity instead of a geographic site", { legal: true }],
  ["a closed site", { state: "F", info: { dateFermeture: "2011-01-01" } }],
  ["another FINESS identifier", { info: { numFinessEge: "850006206" } }],
  ["no geographic record identifier", { info: { egeId: null } }],
  ["SSIAD public name", { info: { nomEgeCourt: "SSIAD LA REYNERIE", nomEgeLong: "SSIAD LA REYNERIE" } }],
  ["SSIAD category with the EHPAD operator's long name", { category: "354", info: { nomEgeCourt: "SSIAD LA REYNERIE" } }],
  ["USLD category with the same public name", { category: "362" }],
  ["no category for an explicitly requested EHPAD", { category: "" }],
  ["another house number", { address: { ligneQuatre: "14 RUE DU PAYS DE RETZ", numeroVoie: "14" } }],
  ["another postcode", { address: { codePostal: "85300" } }],
  ["another commune", { address: { ligneAcheminement: "SALLERTAINE" } }],
  ["another street", { address: { ligneQuatre: "RUE DES MARGOTINS" } }],
  ["no public establishment name", { info: { nomEgeCourt: null, nomEgeLong: null } }],
  ["no geographic site address", { address: { usageAdresse: "02" } }],
]) {
  test(`FINESS refuses ${label} even at the same geographic point`, () => {
    const altered = { ...record, etatObjet: change.state ?? record.etatObjet,
      categorieentiteGeographiqueExercice: change.category ?? record.categorieentiteGeographiqueExercice,
      informationsGeneralesEGE: change.legal ? undefined : { ...info, ...change.info },
      adresse: record.adresse.map(address => ({ ...address, ...change.address })),
    };
    assert.equal(finessIdentityLink(altered, ehpad, row, source, sourceUrl), null);
  });
}

test("lookup uses only the candidate's FINESS shard; duplicate or truncated geographic records do not confirm identity", async () => {
  const result = await findFinessIdentityLinks({ row, candidates: [ehpad], fetchImpl: async (url, fetchOptions) => {
    assert.match(url.pathname, /identity-links\/finess\/850002\.json$/);
    assert.equal(url.search, "");
    assert.equal(fetchOptions.headers.Accept, "application/json");
    return Response.json({ ...sectorPayload, records: [record, record], recordCount: 2 });
  } });
  assert.deepEqual(result.links, []);
  await assert.rejects(findFinessIdentityLinks({ row, candidates: [ehpad], fetchImpl: async () =>
    Response.json({ ...sectorPayload, recordCount: 3 }) }), /incomplet/);
  assert.equal(buildFinessLookupUrl("invalid", ehpad.siret), null);
});

test("a department-sized payload cannot bypass the bounded FINESS shard contract", async () => {
  const oversized = { ...sectorPayload, records: [{ ...record,
    informationsGeneralesEGE: { ...info, nomEgeLong: "x".repeat(FINESS_BUDGET.maxShardBytes) },
  }], recordCount: 1 };
  await assert.rejects(findFinessIdentityLinks({ row, candidates: [ehpad], fetchImpl: async () => Response.json(oversized) }), /trop volumineux/);
});

test("a registry link is not sufficient when fresh Annuaire omits or changes its per-site FINESS", async () => {
  for (const finessIds of [[], ["850006206"]]) {
    const result = await resolveIdentityForEnrichment({ ...options, fetchOfficial: async () => ({ items: [{ ...ehpad, finessIds }] }) });
    assert.equal(result.decision.status, "MATCH_PROBABLE");
    assert.deepEqual(result.links, []);
  }
});

test("registry proof cannot replace a newly contradicted official address or inactive SIRET", async () => {
  for (const change of [{ adresse: "14 RUE DES MARGOTINS 85300 SALLERTAINE" }, { etatAdministratif: "F" },
    { aliases: ["SOINS INFIRMIERS DOMICILE SSIDPA"], nomCommercial: "SOINS INFIRMIERS DOMICILE SSIDPA", nomUsuelDistinct: true }]) {
    const result = await resolveIdentityForEnrichment({ ...options, fetchOfficial: async () => ({ items: [{ ...ehpad, ...change }] }) });
    assert.notEqual(result.decision.status, "MATCH_VERIFIED");
  }
});

test("a FINESS copied across two official SIRETs is not resolved by proximity", async () => {
  const neighbours = [ehpad, { ...ssiad, finessIds: ["850002163"] }];
  const result = await resolveIdentityForEnrichment({ ...options,
    resolveFallback: async () => ({ ...(await fallback()), candidates: neighbours }),
    findSectorLinks: async () => { assert.fail("ambiguous binding must not be consulted"); },
  });
  assert.equal(result.decision.status, "MATCH_PROBABLE");
  assert.match(result.diagnostics.join(" "), /non unique/);
});

test("several sufficient sector proofs stay ambiguous instead of selecting one by geographic distance", async () => {
  const other = { ...ehpad, siret: "12345678900011", siren: "123456789", finessIds: ["850099999"] };
  const sites = [ehpad, other];
  const result = await resolveIdentityForEnrichment({ ...options,
    resolveFallback: async () => ({ ...(await fallback()), candidates: sites, decision: decideIdentity({ row, candidates: sites }) }),
    fetchOfficial: async request => ({ items: sites.filter(item => item.siret === request.requestedSiret) }),
    findSectorLinks: async ({ row, candidates }) => ({ links: candidates.map(candidate => finessIdentityLink({ ...record,
      informationsGeneralesEGE: { ...info, siret: candidate.siret, numFinessEge: candidate.finessIds[0] },
    }, candidate, row, source, buildFinessLookupUrl(candidate.finessIds[0], candidate.siret))) }),
  });
  assert.equal(result.decision.status, "AMBIGUOUS");
  assert.equal(result.decision.candidate, null);
});

test("an unavailable sector source preserves abstention", async () => {
  const result = await resolveIdentityForEnrichment({ ...options, findSectorLinks: async () => { throw new Error("HTTP 503"); } });
  assert.equal(result.decision.status, "MATCH_PROBABLE");
  assert.match(result.diagnostics.join(" "), /FINESS.*503/);
});

test("a fresh text response and a five-second FINESS response verify the real EHPAD without awaiting IGN or a redundant Annuaire call", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 9, 2) });
  let calls = 0;
  const pending = resolveIdentityForEnrichment({ row, findPublishedLinks: noPublished,
    geocode: async () => { assert.fail("optional street geocoding cannot consume the proof budget"); },
    fetchOfficial: async () => {
      calls += 1;
      return new Promise(resolve => setTimeout(() => resolve({ items: candidates, coverage: { complete: true }, cached: false }), 1000));
    },
    findSectorLinks: async args => {
      await new Promise(resolve => setTimeout(resolve, 5500));
      return lookup(args);
    },
  });
  await settle();
  t.mock.timers.tick(1000);
  await settle();
  t.mock.timers.tick(5500);
  const result = await pending;
  assert.equal(result.decision.status, "MATCH_VERIFIED");
  assert.equal(result.decision.candidate.siret, ehpad.siret);
  assert.equal(calls, 1, "the fresh text response already proves the exact SIRET ↔ geographic FINESS binding");
  assert.match(result.links[0].officialBinding.url, /q=ehpad/);
  assert.equal(result.links[0].officialBinding.checkedAt, "2026-10-02T00:00:01.000Z");
});

test("a cached text response must receive a fresh exact-SIRET revalidation", async () => {
  const calls = [];
  const result = await resolveIdentityForEnrichment({ row, findPublishedLinks: noPublished, findSectorLinks: lookup,
    fetchOfficial: async (request, fetchOptions) => {
      calls.push({ request, fetchOptions });
      return { items: candidates, coverage: { complete: true }, cached: request.kind === "text" };
    },
  });
  assert.equal(result.decision.status, "MATCH_VERIFIED");
  assert.deepEqual(calls.map(item => item.request.kind), ["text", "siret"]);
  assert.equal(calls[1].fetchOptions.cacheTtlMs, 0);
  assert.match(result.links[0].officialBinding.url, /q=26850025300011/);
});

test("the optional registry phase uses only the remaining global identity budget", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 9, 2) });
  const existing = await fallback();
  let sourceSignal;
  const pending = resolveIdentityForEnrichment({ ...options,
    resolveFallback: async () => {
      await new Promise(resolve => setTimeout(resolve, 10000));
      return existing;
    },
    findSectorLinks: async ({ signal }) => { sourceSignal = signal; return new Promise(() => {}); },
  });
  await settle();
  t.mock.timers.tick(10000);
  await settle();
  t.mock.timers.tick(1900);
  const result = await pending;
  assert.equal(result.decision.status, "MATCH_PROBABLE");
  assert.equal(sourceSignal.aborted, true);
});

test("a hanging FINESS request is aborted at eight seconds without losing the probable candidate", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 9, 2) });
  let sourceSignal;
  const pending = resolveIdentityForEnrichment({ ...options, findSectorLinks: async ({ signal }) => {
    sourceSignal = signal;
    return new Promise(() => {}); // the fetch deliberately ignores cancellation
  } });
  await settle();
  t.mock.timers.tick(FINESS_BUDGET.deadlineMs);
  const result = await pending;
  assert.equal(sourceSignal.aborted, true);
  assert.equal(result.decision.status, "MATCH_PROBABLE");
  assert.equal(result.decision.candidate.siret, ehpad.siret);
  assert.match(result.diagnostics.join(" "), /hors délai/);
});

test("late FINESS responses after a Grist selection abort cannot start Annuaire verification", async () => {
  const controller = new AbortController();
  let release;
  let verificationCalls = 0;
  const pending = resolveIdentityForEnrichment({ ...options, signal: controller.signal,
    findSectorLinks: async () => new Promise(resolve => { release = () => resolve({ links: [finessIdentityLink(record, ehpad, row, source, sourceUrl)] }); }),
    fetchOfficial: async () => { verificationCalls += 1; return fresh(); },
  });
  await settle();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  release();
  await settle();
  assert.equal(verificationCalls, 0);
});
