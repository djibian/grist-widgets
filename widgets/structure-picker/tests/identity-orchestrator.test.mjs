import test from "node:test";
import assert from "node:assert/strict";
import { resolveStructureIdentity } from "../identity-orchestrator.js";
import { IDENTITY_STATES } from "../identity-resolution.js";

function official(items, extra = {}) {
  return { items, coverage: { complete: true, hasNextPage: false, unitSirens: [...new Set(items.map(item => item.siren).filter(Boolean))], ...extra } };
}

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

test("a conclusive text identity does not start an unnecessary geocode for verified O PRE D'VOUS", async () => {
  const calls = [];
  const result = await resolveStructureIdentity({
    row: { NomCommercial: "ô Pré d’Vous", Adresse: "24 rue des fosses 44270 La Marne", SirenSiret: "", Latitude: "", Longitude: "" },
    geocode: async () => { assert.fail("identity must not wait for street discovery"); },
    fetchOfficial: async request => {
      calls.push(request);
      assert.equal(request.kind, "text");
      assert.equal(request.query, "o pre d vous");
      return official([candidate({ nomCommercial: "O PRE D'VOUS", aliases: ["O PRE D'VOUS"], nomUsuelDistinct: true, raisonSociale: "PH DISTRIBUTION", siren: "893061044", siret: "89306104400028", adresse: "24 RUE DES FOSSES 44270 LA MARNE", codePostal: "44270", commune: "LA MARNE" })]);
    },
  });
  assert.equal(result.decision.status, IDENTITY_STATES.MATCH_VERIFIED);
  assert.equal(result.decision.candidate.siret, "89306104400028");
  assert.equal(calls.length, 1);
});

test("Super U does not accept SIDONAM by proximity but verifies an explicit OSM SIRET link", async () => {
  const calls = [];
  const sidonam = candidate({ nomCommercial: "SIDONAM", raisonSociale: "SIDONAM", siren: "410918080", siret: "41091808000020", adresse: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME", codePostal: "44270", commune: "MACHECOUL-SAINT-MEME", latitude: 46.998186, longitude: -1.81526 });
  const result = await resolveStructureIdentity({
    row: { NomCommercial: "Super U Machecoul", Adresse: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME", SirenSiret: "", Latitude: "", Longitude: "" },
    geocode: async () => [{ adresse: "Boulevard des Prises 44270 Machecoul-Saint-Même", codePostal: "44270", commune: "Machecoul-Saint-Même", latitude: 46.996561, longitude: -1.815374, score: 0.64 }],
    fetchOfficial: async request => {
      calls.push(request.kind);
      if (request.kind === "text") return official([]);
      if (request.kind === "nearby") return official([sidonam]);
      if (request.kind === "siret") return official([sidonam]);
      throw new Error(`unexpected ${request.kind}`);
    },
    findPoiLinks: async () => ({
      complete: true,
      candidates: [{ source: "osm", sourceLabel: "OpenStreetMap", sourceRecordId: "node:1", publicNames: ["Super U Machecoul"], siret: "41091808000020", adresse: "Boulevard des Prises 44270 Machecoul-Saint-Même", latitude: 46.99808, longitude: -1.815576, nameScore: 1 }],
    }),
  });
  assert.equal(result.decision.status, IDENTITY_STATES.MATCH_VERIFIED);
  assert.equal(result.decision.candidate.siret, "41091808000020");
  assert.deepEqual(calls, ["text", "nearby", "siret"]);
});

test("Super U abstains when no explicit legal bridge exists", async () => {
  const sidonam = candidate({ nomCommercial: "SIDONAM", raisonSociale: "SIDONAM", siren: "410918080", siret: "41091808000020", adresse: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME", codePostal: "44270", commune: "MACHECOUL-SAINT-MEME" });
  const result = await resolveStructureIdentity({
    row: { NomCommercial: "Super U Machecoul", Adresse: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME", SirenSiret: "" },
    geocode: async () => [{ adresse: "Boulevard des Prises 44270 Machecoul-Saint-Même", codePostal: "44270", commune: "Machecoul-Saint-Même", latitude: 46.996561, longitude: -1.815374, score: 0.64 }],
    fetchOfficial: async request => request.kind === "nearby" ? official([sidonam]) : official([]),
    findPoiLinks: async () => ({ complete: true, candidates: [{ source: "osm", sourceLabel: "OpenStreetMap", sourceRecordId: "node:1", publicNames: ["Super U Machecoul"], siret: "", adresse: "Boulevard des Prises 44270 Machecoul-Saint-Même", latitude: 46.99808, longitude: -1.815576, nameScore: 1 }] }),
  });
  assert.equal(result.decision.status, IDENTITY_STATES.NO_MATCH);
  assert.equal(result.displayCandidates.length, 0);
});

test("SIREN validates the legal person but text candidates are restricted to that SIREN", async () => {
  const calls = [];
  const target = candidate({ nomCommercial: "O PRE D'VOUS", aliases: ["O PRE D'VOUS"], nomUsuelDistinct: true, raisonSociale: "PH DISTRIBUTION", siren: "893061044", siret: "89306104400028", adresse: "24 RUE DES FOSSES 44270 LA MARNE", codePostal: "44270", commune: "LA MARNE" });
  const outsider = candidate({ nomCommercial: "O PRE D'VOUS", aliases: ["O PRE D'VOUS"], nomUsuelDistinct: true, raisonSociale: "OTHER", siren: "111111111", siret: "11111111100011", adresse: "24 RUE DES FOSSES 44270 LA MARNE", codePostal: "44270", commune: "LA MARNE" });
  const result = await resolveStructureIdentity({
    row: { NomCommercial: "ô Pré d’Vous", Adresse: "24 rue des fosses 44270 La Marne", SirenSiret: "893061044" },
    geocode: async () => [],
    fetchOfficial: async request => {
      calls.push(request.kind);
      if (request.kind === "siren") return { items: [], coverage: { complete: true, hasNextPage: false, unitSirens: ["893061044"] } };
      if (request.kind === "text") return official([outsider, target]);
      return official([]);
    },
  });
  assert.equal(result.decision.candidate?.siret, "89306104400028");
  assert.ok(calls.includes("siren"));
  assert.ok(calls.includes("text"));
});

test("pagination incompleteness is not hidden", async () => {
  let page = 0;
  const result = await resolveStructureIdentity({
    row: { NomCommercial: "Entreprise X", Adresse: "1 rue X 44000 Nantes", SirenSiret: "" },
    geocode: async () => [],
    fetchOfficial: async request => {
      page += 1;
      return { items: [], coverage: { complete: false, hasNextPage: true, page: request.page, unitSirens: [] } };
    },
    maxOfficialRequests: 2,
  });
  assert.equal(result.decision.status, IDENTITY_STATES.INCOMPLETE);
  assert.ok(page >= 1);
});
