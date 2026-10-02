import test from "node:test";
import assert from "node:assert/strict";
import { resolveIdentityForEnrichment } from "../identity-service.js";
import { IDENTITY_STATES } from "../identity-resolution.js";

function candidate(overrides = {}) {
  return {
    nomCommercial: "",
    aliases: [],
    nomUsuelDistinct: false,
    raisonSociale: "",
    siren: "",
    siret: "",
    adresse: "",
    codePostal: "",
    commune: "",
    latitude: null,
    longitude: null,
    etatAdministratif: "A",
    ...overrides,
  };
}

function superULink() {
  return {
    source: "published-identity",
    sourceLabel: "Magasins U",
    sourceRecordId: "PL00660",
    publicNames: ["Super U Machecoul", "Super U"],
    legalName: "SIDONAM",
    siret: "41091808000020",
    adresse: "BOULEVARD DES PRISES 44270 MACHECOUL ST MEME",
    postcode: "44270",
    latitude: null,
    longitude: null,
  };
}

function sidonamCandidate() {
  return candidate({
    nomCommercial: "SIDONAM",
    raisonSociale: "SIDONAM",
    siren: "410918080",
    siret: "41091808000020",
    adresse: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME",
    codePostal: "44270",
    commune: "MACHECOUL-SAINT-MEME",
    latitude: 46.998041,
    longitude: -1.815667,
  });
}

const row = {
  NomCommercial: "Super U Machecoul",
  Adresse: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME",
  SirenSiret: "",
};

test("Super U is verified from an operator-published local SIRET then current Annuaire revalidation", async () => {
  let fallbackCalled = false;
  let verificationOptions = null;
  const result = await resolveIdentityForEnrichment({
    row,
    findPublishedLinks: async () => ({ complete: true, candidates: [superULink()] }),
    fetchOfficial: async (request, options) => {
      assert.equal(request.kind, "siret");
      verificationOptions = options;
      return { items: [sidonamCandidate()], coverage: { complete: true, hasNextPage: false, unitSirens: ["410918080"] } };
    },
    resolveFallback: async () => {
      fallbackCalled = true;
      throw new Error("fallback must not run");
    },
  });

  assert.equal(fallbackCalled, false);
  assert.equal(verificationOptions?.cacheTtlMs, 0, "published SIRET proof must bypass session cache");
  assert.equal(result.decision.status, IDENTITY_STATES.MATCH_VERIFIED);
  assert.equal(result.decision.candidate.siret, "41091808000020");
  assert.match(result.decision.reason, /chaîne de preuves/i);
  assert.equal(result.links[0].verifiedOfficial, true);
});

test("published SIRET falls back to published legal name when direct identifier search omits the establishment", async () => {
  const calls = [];
  let fallbackCalled = false;
  const result = await resolveIdentityForEnrichment({
    row,
    findPublishedLinks: async () => ({ complete: true, candidates: [superULink()] }),
    fetchOfficial: async (request, options) => {
      calls.push({ request, options });
      if (request.kind === "siret") {
        return { items: [], coverage: { complete: true, hasNextPage: false, unitSirens: [] } };
      }
      assert.equal(request.kind, "text");
      assert.equal(request.query, "SIDONAM");
      assert.equal(request.codePostal, "44270");
      return { items: [sidonamCandidate()], coverage: { complete: true, hasNextPage: false, unitSirens: ["410918080"] } };
    },
    resolveFallback: async () => {
      fallbackCalled = true;
      throw new Error("fallback must not run");
    },
  });

  assert.equal(fallbackCalled, false);
  assert.deepEqual(calls.map(call => call.request.kind), ["siret", "text"]);
  assert.ok(calls.every(call => call.options?.cacheTtlMs === 0));
  assert.equal(result.decision.status, IDENTITY_STATES.MATCH_VERIFIED);
  assert.equal(result.decision.candidate.siret, "41091808000020");
  assert.equal(result.requests[0].kind, "text");
});

test("no published bridge falls back to the general resolver", async () => {
  const expected = {
    decision: { status: IDENTITY_STATES.NO_MATCH, reason: "none", candidate: null },
    candidates: [], displayCandidates: [], geocodeCandidates: [], selectedGeocode: null,
    links: [], coverage: [], requests: [], diagnostics: [],
  };
  const result = await resolveIdentityForEnrichment({
    row: { NomCommercial: "Structure inconnue", Adresse: "1 rue X 44000 Nantes", SirenSiret: "" },
    findPublishedLinks: async () => ({ complete: true, candidates: [] }),
    resolveFallback: async () => expected,
    fetchOfficial: async () => { throw new Error("must not verify"); },
  });
  assert.equal(result.decision.status, IDENTITY_STATES.NO_MATCH);
});
