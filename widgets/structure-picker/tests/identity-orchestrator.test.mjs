import test from "node:test";
import assert from "node:assert/strict";
import { resolveStructureIdentity } from "../identity-orchestrator.js";
import { IDENTITY_STATES } from "../identity-resolution.js";
import { emptyDiscoveryGuidance, correctDiscoveryGuidance } from "../discovery-guidance.js";

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

test("a supplied SIREN cannot eliminate an independently verified homonym at the same address", async () => {
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
  assert.equal(result.decision.status, "AMBIGUOUS");
  assert.deepEqual(result.decision.alternatives.map(item => item.siret).sort(), [outsider.siret, target.siret].sort());
  assert.deepEqual(calls, ["text"]);
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

test('a wrong entered number cannot delay the text/address result through a redundant identifier lookup',async()=>{
 const site=candidate({nomCommercial:'GARAGE MARTIN',aliases:['GARAGE MARTIN'],nomUsuelDistinct:true,raisonSociale:'MARTIN AUTO',siret:'12345678900029',siren:'123456789',adresse:'12 RUE DES ACACIAS 44000 NANTES'});
 const calls=[];
 const result=await resolveStructureIdentity({row:{NomCommercial:'Garage Martin',Adresse:site.adresse,SirenSiret:'98765432100019'},fetchOfficial:async request=>{calls.push(request.kind);assert.equal(request.kind,'text');return official([site]);},geocode:async()=>{throw Error('unnecessary discovery');}});
 assert.equal(result.decision.status,'MATCH_VERIFIED');assert.equal(result.decision.candidate.siret,site.siret);assert.ok(result.decision.identifierWarning);assert.deepEqual(calls,['text']);
});

test('an existing legal name can discover the site when its public name is not indexed by the text service',async()=>{
 const calls=[];
 const r=await resolveStructureIdentity({row:{NomCommercial:'Garage Martin',RaisonSociale:'MARTIN AUTOMOBILES',Adresse:'12 rue des Champs 44270 Machecoul-Saint-Même'},geocode:async()=>{throw Error('A complete public name and site address need no geocode');},fetchOfficial:async request=>{
  calls.push(request.query);
  return official(request.query==='martin automobiles'?[candidate({nomCommercial:'Garage Martin',aliases:['Garage Martin'],nomUsuelDistinct:true,raisonSociale:'MARTIN AUTOMOBILES',siret:'12345678900011',adresse:'12 rue des Champs 44270 Machecoul-Saint-Même'})]:[]);
 }});
 assert.equal(r.decision.status,'MATCH_VERIFIED');assert.deepEqual(calls,['garage martin','martin automobiles']);
});


test("optional deeper search discovers a novel local site using a broad name query without trusting the entered SIRET", async () => {
  const calls = [];
  const real = candidate({
    nomCommercial: "Atelier des Saules", aliases: ["Atelier des Saules"], nomUsuelDistinct: true,
    raisonSociale: "Coopérative des Saules", siren: "112233445", siret: "11223344500027",
    adresse: "7 rue des Tisserands 44000 Nantes", codePostal: "44000", commune: "Nantes",
  });
  const wrong = candidate({
    nomCommercial: "Autre activité", raisonSociale: "Exploitant étranger",
    siren: "998877665", siret: "99887766500013",
    adresse: "99 rue des Saules 44000 Nantes", codePostal: "44000", commune: "Nantes",
  });
  const row = { NomCommercial: "Atelier des Saules", Adresse: "7 rue des Tisserands 44000 Nantes", SirenSiret: wrong.siret };
  const result = await resolveStructureIdentity({
    row, deepening: true, deadlineMs: 28000, maxOfficialRequests: 12,
    geocode: async () => [],
    fetchOfficial: async request => {
      calls.push(request);
      if (request.kind === "siret") return official([wrong]);
      if (request.kind === "text" && !request.codePostal) return official([real]);
      return official([]);
    },
  });
  assert.ok(calls.some(request => request.kind === "siret"), "entered identifier must be explored, not accepted");
  assert.ok(calls.some(request => request.kind === "text" && !request.codePostal), "broaden the search");
  assert.equal(result.decision.status, IDENTITY_STATES.MATCH_VERIFIED);
  assert.equal(result.decision.candidate.siret, real.siret);
  assert.equal(result.decision.identifierWarning?.entered, wrong.siret);
  assert.equal(new Set(calls.map(request => request.url)).size, calls.length);
});

test("explicit deepening extends Annuaire pagination without inventing a SIRET or changing the abstention rule", async () => {
  const calls = [];
  const found = candidate({
    nomCommercial: "Jardin des Aubépines", aliases: ["Jardin des Aubépines"], nomUsuelDistinct: true,
    raisonSociale: "Exploitation horticole", siren: "223344556", siret: "22334455600031",
    adresse: "42 route des Jardins 85000 La Roche-sur-Yon", codePostal: "85000", commune: "La Roche-sur-Yon",
  });
  const row = { NomCommercial: "Jardin des Aubépines", Adresse: "42 route des Jardins 85000 La Roche-sur-Yon" };
  const result = await resolveStructureIdentity({
    row, deepening: true, deadlineMs: 28000, maxOfficialRequests: 12, maxPaginationPages: 3,
    fetchOfficial: async request => {
      calls.push(request);
      return official(request.page === 3 ? [found] : [], {
        complete: request.page === 3, hasNextPage: request.page !== 3,
      });
    },
  });
  assert.deepEqual(calls.slice(0, 3).map(request => request.page), [1, 2, 3]);
  assert.equal(result.decision.status, IDENTITY_STATES.MATCH_VERIFIED);
  assert.equal(result.decision.candidate.siret, found.siret);
  assert.equal(result.requests.some(req => req.source.endsWith(":page3")), true);
});

test("deepening may rank a contradictory address but must never confirm site identity from a matching number alone", async () => {
  const wrong = candidate({
    nomCommercial: "Ferme des Érables", aliases: ["Ferme des Érables"], nomUsuelDistinct: true,
    raisonSociale: "Exploitant", siren: "334455667", siret: "33445566700029",
    adresse: "22 route des Chênes 44000 Nantes", codePostal: "44000", commune: "Nantes",
  });
  const result = await resolveStructureIdentity({
    row: { NomCommercial: "Ferme des Érables", Adresse: "12 route des Chênes 44000 Nantes", SirenSiret: wrong.siret },
    deepening: true, deadlineMs: 28000, maxOfficialRequests: 8,
    fetchOfficial: async () => official([wrong]),
  });
  assert.notEqual(result.decision.status, IDENTITY_STATES.MATCH_VERIFIED);
});


test("feedback at an active checkpoint really reorders later Annuaire lookups without granting legal proof", async () => {
  const row = { NomCommercial: "Lieu à découvrir", Adresse: "5 rue du Chêne 44000 Nantes", SirenSiret: "" };
  const guidance = { selected: [], rejected: [], version: 0 };
  const requests = [];
  let chosen = false;
  const result = await resolveStructureIdentity({
    row, guidance, deepening: true, maxOfficialRequests: 5, maxPaginationPages: 0,
    geocode: async () => [],
    fetchOfficial: async request => {
      requests.push(request);
      return official([]);
    },
    onProgress: () => {
      if (chosen) return;
      chosen = true;
      guidance.selected.push({ field: "name", key: "hint", value: "Atelier de la Source" });
      guidance.version += 1;
    },
  });
  assert.ok(chosen);
  assert.ok(requests.some(item => item.kind === "text" && item.query.includes("atelier de la source")));
  assert.notEqual(result.decision.status, IDENTITY_STATES.MATCH_VERIFIED);
  assert.equal(row.NomCommercial, "Lieu à découvrir");
});


test("corrected search hints broaden discovery without becoming site identity evidence", async () => {
  const row = { NomCommercial: "École du Verger", Adresse: "4 rue du Jardin 44000 Nantes", SirenSiret: "" };
  const hint = candidate({ nomCommercial: "Atelier des Quais", siret: "98765432100019",
    adresse: "10 quai des Quais 49000 Angers" });
  const guidance = emptyDiscoveryGuidance();
  assert.equal(correctDiscoveryGuidance(guidance, hint, "name", "Atelier des Quais"), true);
  assert.equal(correctDiscoveryGuidance(guidance, hint, "address", "10 quai des Quais 49000 Angers"), true);
  const calls = [];
  const result = await resolveStructureIdentity({
    row, guidance, deepening: true, deadlineMs: 28000, maxOfficialRequests: 12,
    geocode: async () => [],
    fetchOfficial: async request => {
      calls.push(request);
      return official(request.kind === "text" && request.query === "atelier des quais" &&
        request.codePostal === "49000" ? [hint] : []);
    },
  });
  assert.ok(calls.some(req => req.kind === "text" && req.query === "atelier des quais" && req.codePostal === "49000"),
    "manual corrected name and address must generate an actual targeted request");
  assert.ok(result.candidates.some(item => item.siret === hint.siret), "new candidate remains visible");
  assert.notEqual(result.decision.status, IDENTITY_STATES.MATCH_VERIFIED,
    "guided candidate is never an official identity for a conflicting reference row");
  assert.equal(row.NomCommercial, "École du Verger");
  assert.equal(row.Adresse, "4 rue du Jardin 44000 Nantes");
});

test("a novel site may be found by address alone but the unrelated legal operator is not automatically verified", async () => {
  const row = {
    NomCommercial: "Maison des Saules", Adresse: "17 rue des Moissons 44000 Nantes",
    SirenSiret: "", Latitude: "", Longitude: "",
  };
  const other = candidate({
    nomCommercial: "Société anonyme XYZ", raisonSociale: "XYZ Développement",
    siren: "111222333", siret: "11122233300044",
    adresse: "17 rue des Moissons 44000 Nantes", codePostal: "44000", commune: "Nantes",
  });
  const queries = [];
  const result = await resolveStructureIdentity({
    row, deepening: true, maxOfficialRequests: 12, maxPaginationPages: 0,
    geocode: async () => [],
    fetchOfficial: async request => {
      queries.push(request);
      return official(request.kind === "text" && request.query === "17 rue des moissons" &&
        request.codePostal === "44000" ? [other] : []);
    },
  });
  assert.ok(queries.some(request => request.kind === "text" &&
    request.query === "17 rue des moissons" && request.codePostal === "44000"));
  assert.ok(result.candidates.some(item => item.siret === other.siret), "address discovery must preserve the candidate");
  assert.notEqual(result.decision.status, IDENTITY_STATES.MATCH_VERIFIED, "address-only match cannot prove the site's SIRET");
  assert.equal(new Set(queries.map(request => request.url)).size, queries.length, "no duplicated URL");
});

test("human operator choice during live search discovers sibling sites without promoting their identity", async () => {
  const row = { NomCommercial: "Atelier du Littoral", Adresse: "8 rue de l'Etang 44000 Nantes", SirenSiret: "" };
  const manager = candidate({ nomCommercial: "Atelier du Littoral", aliases: ["Atelier du Littoral"],
    nomUsuelDistinct: true, raisonSociale: "Gestion du Littoral", siren: "456789012",
    siret: "45678901200011", adresse: "2 rue du Siège 44000 Nantes", codePostal: "44000", commune: "Nantes" });
  const sibling = candidate({ nomCommercial: "Entrepôt Atlantique", aliases: ["Entrepôt Atlantique"],
    nomUsuelDistinct: true, raisonSociale: "Gestion du Littoral", siren: "456789012",
    siret: "45678901200029", adresse: "8 rue de l'Etang 44000 Nantes", codePostal: "44000", commune: "Nantes" });
  const guidance = emptyDiscoveryGuidance();
  const calls = [];
  const outcome = await resolveStructureIdentity({
    row, guidance, deepening: true, maxOfficialRequests: 5, maxPaginationPages: 0,
    geocode: async () => [],
    fetchOfficial: async request => {
      calls.push(request);
      if (request.kind === "siren") return official([manager, sibling]);
      if (request.kind === "text" && request.codePostal) return official([manager]);
      return official([]);
    },
    onProgress: checkpoint => {
      if (!guidance.selected.length && checkpoint.candidates.some(c => c.siret === manager.siret))
        guidance.selected.push({ field: "operator", key: "siret:" + manager.siret, value: manager.raisonSociale });
    },
  });
  assert.ok(calls.some(request => request.kind === "siren" && request.identifier === "456789012"));
  assert.ok(outcome.candidates.some(c => c.siret === sibling.siret), "sibling site enters discovery");
  assert.notEqual(outcome.decision.status, IDENTITY_STATES.MATCH_VERIFIED,
    "a shared operator and matching address cannot by themselves certify this different-name site");
  assert.equal(row.SirenSiret, "");
});
