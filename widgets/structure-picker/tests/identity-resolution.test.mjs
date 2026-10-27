import test from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY_STATES,
  addressEvidence,
  decideIdentity,
  targetNameVariants,
  usableCoordinates,
} from "../identity-resolution.js";

const completeCoverage = [{ source: "annuaire:text", status: "ok", required: true, coverage: { complete: true } }];

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

test("one-letter brand tokens remain discriminating", () => {
  const variants = targetNameVariants({ NomCommercial: "Super U Machecoul", Adresse: "Boulevard des Prises 44270 Machecoul-Saint-Même" });
  assert.ok(variants.includes("super u"));
  assert.equal(variants.includes("super"), false);
});

test("Null Island is never a usable location", () => {
  assert.equal(usableCoordinates(0, 0), null);
  assert.deepEqual(usableCoordinates(48, 0), { latitude: 48, longitude: 0 });
});

test("address comparison preserves number and repetition", () => {
  const same = addressEvidence("10 BIS RUE DES MARGOTINS 85300 SALLERTAINE", "10 B RUE DES MARGOTINS 85300 SALLERTAINE");
  assert.equal(same.number, "same");
  assert.equal(same.repetition, "compatible");
  assert.equal(same.complete, true);

  const different = addressEvidence("12 rue des Fosses 44270 La Marne", "99 rue des Fosses 44270 La Marne");
  assert.equal(different.number, "conflict");
  assert.equal(different.conflict, true);
});

test("explicit SIRET is verified but a site contradiction blocks silent enrichment", () => {
  const row = { NomCommercial: "Garage Martin", SirenSiret: "12345678900011", Adresse: "12 rue des Acacias 44000 Nantes" };
  const ok = decideIdentity({
    row,
    candidates: [candidate({ siret: "12345678900011", siren: "123456789", raisonSociale: "MARTIN", adresse: "12 RUE DES ACACIAS 44000 NANTES" })],
    coverage: completeCoverage,
  });
  assert.equal(ok.status, IDENTITY_STATES.MATCH_VERIFIED);

  const conflict = decideIdentity({
    row,
    candidates: [candidate({ siret: "12345678900011", siren: "123456789", raisonSociale: "MARTIN", adresse: "99 RUE B 44000 NANTES" })],
    coverage: completeCoverage,
  });
  assert.equal(conflict.status, IDENTITY_STATES.NO_MATCH);
  assert.equal(conflict.identifierWarning.entered, row.SirenSiret);
});

test("Super U cannot be assigned to SIDONAM from boulevard proximity alone", () => {
  const row = {
    NomCommercial: "Super U Machecoul",
    Adresse: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME",
    SirenSiret: "",
    Latitude: "",
    Longitude: "",
  };
  const sidonam = candidate({
    nomCommercial: "SIDONAM",
    raisonSociale: "SIDONAM",
    siret: "41091808000020",
    siren: "410918080",
    adresse: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME",
    codePostal: "44270",
    commune: "MACHECOUL-SAINT-MEME",
    latitude: 46.998186,
    longitude: -1.81526,
  });
  const decision = decideIdentity({ row, candidates: [sidonam], coverage: completeCoverage, location: { latitude: 46.996561, longitude: -1.815374 } });
  assert.equal(decision.status, IDENTITY_STATES.NO_MATCH);
});

test("Super U becomes verified with an explicit local SIRET reference revalidated officially", () => {
  const row = {
    NomCommercial: "Super U Machecoul",
    Adresse: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME",
    SirenSiret: "",
  };
  const sidonam = candidate({
    nomCommercial: "SIDONAM",
    raisonSociale: "SIDONAM",
    siret: "41091808000020",
    siren: "410918080",
    adresse: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME",
    codePostal: "44270",
    commune: "MACHECOUL-SAINT-MEME",
  });
  const decision = decideIdentity({
    row,
    candidates: [sidonam],
    links: [{
      source: "osm",
      sourceLabel: "OpenStreetMap",
      siret: "41091808000020",
      verifiedOfficial: true,
      publicNames: ["Super U Machecoul"],
      adresse: "Boulevard des Prises 44270 Machecoul-Saint-Même",
      latitude: 46.99808,
      longitude: -1.815576,
    }],
    coverage: completeCoverage,
    location: { latitude: 46.996561, longitude: -1.815374 },
  });
  assert.equal(decision.status, IDENTITY_STATES.MATCH_VERIFIED);
  assert.equal(decision.candidate.siret, "41091808000020");
});

test("EHPAD site is the unique probable candidate, not its SSIAD or a nearby association", () => {
  const row = { NomCommercial: "EHPAD La Reynerie Bouin 85230", Adresse: "8bis Rue du Pays de Retz 85230 Bouin", SirenSiret: "" };
  const candidates = [
    candidate({
      nomCommercial: "EHPAD", aliases: ["EHPAD"], nomUsuelDistinct: true,
      raisonSociale: "EHPAD LA REYNERIE BOUIN", siret: "26850025300011", siren: "268500253",
      adresse: "LA REYNERIE RUE DU PAYS DE RETZ 85230 BOUIN", codePostal: "85230", commune: "BOUIN",
    }),
    candidate({
      nomCommercial: "SOINS INFIRMIERS DOMICILE SSIDPA", aliases: ["SOINS INFIRMIERS DOMICILE SSIDPA"], nomUsuelDistinct: true,
      raisonSociale: "EHPAD LA REYNERIE BOUIN", siret: "26850025300045", siren: "268500253",
      adresse: "14 RUE DU PAYS DE RETZ 85230 BOUIN", codePostal: "85230", commune: "BOUIN",
    }),
    candidate({
      nomCommercial: "ASSOCIATION DES AMIS DE LA MADELEINE ET DE LA REYNERIE", raisonSociale: "ASSOCIATION DES AMIS DE LA MADELEINE ET DE LA REYNERIE",
      siret: "89405714000010", siren: "894057140", adresse: "EHPAD LA REYNERIE 8 RUE DU PAYS DE RETZ 85230 BOUIN", codePostal: "85230", commune: "BOUIN",
    }),
  ];
  const decision = decideIdentity({ row, candidates, coverage: completeCoverage });
  assert.equal(decision.status, IDENTITY_STATES.MATCH_PROBABLE);
  assert.equal(decision.candidate.siret, "26850025300011");
});

test("O PRE D'VOUS is verified by distinctive alias and full site address", () => {
  const row = { NomCommercial: "ô Pré d’Vous", Adresse: "24 rue des fosses 44270 La Marne", SirenSiret: "" };
  const candidates = [
    candidate({ nomCommercial: "O PRE D'VOUS", aliases: ["O PRE D'VOUS"], nomUsuelDistinct: true, raisonSociale: "PH DISTRIBUTION", siret: "89306104400028", siren: "893061044", adresse: "24 RUE DES FOSSES 44270 LA MARNE", codePostal: "44270", commune: "LA MARNE" }),
    candidate({ nomCommercial: "PH DISTRIBUTION", raisonSociale: "PH DISTRIBUTION", siret: "89306104400010", siren: "893061044", adresse: "LA MORTIERE 44270 SAINT-ETIENNE-DE-MER-MORTE", codePostal: "44270", commune: "SAINT-ETIENNE-DE-MER-MORTE" }),
  ];
  const decision = decideIdentity({ row, candidates, coverage: completeCoverage });
  assert.equal(decision.status, IDENTITY_STATES.MATCH_VERIFIED);
  assert.equal(decision.candidate.siret, "89306104400028");
});

test("POM DE RAINETTE is verified despite the descriptive CRECHE prefix", () => {
  const row = { NomCommercial: "CRECHE POM'DE RAINETTE", Adresse: "10 BIS RUE DES MARGOTINS 85300 SALLERTAINE", SirenSiret: "" };
  const candidates = [
    candidate({ nomCommercial: "POM' DE RAINETTE", aliases: ["POM' DE RAINETTE"], nomUsuelDistinct: true, raisonSociale: "PICOTI PICOTA", siret: "88493583400033", siren: "884935834", adresse: "10 B RUE DES MARGOTINS 85300 SALLERTAINE", codePostal: "85300", commune: "SALLERTAINE" }),
    candidate({ nomCommercial: "PICOTI PICOTA", raisonSociale: "PICOTI PICOTA", siret: "88493583400025", siren: "884935834", adresse: "IMPASSE DE LA CAILLAUDIERE 85300 SALLERTAINE", codePostal: "85300", commune: "SALLERTAINE" }),
  ];
  const decision = decideIdentity({ row, candidates, coverage: completeCoverage });
  assert.equal(decision.status, IDENTITY_STATES.MATCH_VERIFIED);
  assert.equal(decision.candidate.siret, "88493583400033");
});

test("decision is invariant to candidate ordering", () => {
  const row = { NomCommercial: "ô Pré d’Vous", Adresse: "24 rue des fosses 44270 La Marne", SirenSiret: "" };
  const good = candidate({ nomCommercial: "O PRE D'VOUS", aliases: ["O PRE D'VOUS"], nomUsuelDistinct: true, raisonSociale: "PH DISTRIBUTION", siret: "89306104400028", siren: "893061044", adresse: "24 RUE DES FOSSES 44270 LA MARNE", codePostal: "44270", commune: "LA MARNE" });
  const bad = candidate({ nomCommercial: "COIFF & MOI", aliases: ["COIFF & MOI"], nomUsuelDistinct: true, raisonSociale: "COIFF & MOI", siret: "79825660800018", siren: "798256608", adresse: "26 RUE DES FOSSES 44270 LA MARNE", codePostal: "44270", commune: "LA MARNE" });
  const one = decideIdentity({ row, candidates: [good, bad], coverage: completeCoverage });
  const two = decideIdentity({ row, candidates: [bad, good], coverage: completeCoverage });
  assert.equal(one.status, two.status);
  assert.equal(one.candidate?.siret, two.candidate?.siret);
});

test("an equivalent second verified candidate forces ambiguity", () => {
  const row = { NomCommercial: "Garage Martin", Adresse: "12 rue des Artisans 44000 Nantes", SirenSiret: "" };
  const a = candidate({ nomCommercial: "GARAGE MARTIN", aliases: ["GARAGE MARTIN"], nomUsuelDistinct: true, raisonSociale: "A", siret: "11111111100011", adresse: "12 RUE DES ARTISANS 44000 NANTES", codePostal: "44000", commune: "NANTES" });
  const b = candidate({ nomCommercial: "GARAGE MARTIN", aliases: ["GARAGE MARTIN"], nomUsuelDistinct: true, raisonSociale: "B", siret: "22222222200022", adresse: "12 RUE DES ARTISANS 44000 NANTES", codePostal: "44000", commune: "NANTES" });
  const decision = decideIdentity({ row, candidates: [a, b], coverage: completeCoverage });
  assert.equal(decision.status, IDENTITY_STATES.AMBIGUOUS);
});

test("a probable candidate cannot become a match when required coverage is truncated", () => {
  const row = { NomCommercial: "EHPAD La Reynerie Bouin 85230", Adresse: "8bis Rue du Pays de Retz 85230 Bouin", SirenSiret: "" };
  const ehpad = candidate({ nomCommercial: "EHPAD", aliases: ["EHPAD"], nomUsuelDistinct: true, raisonSociale: "EHPAD LA REYNERIE BOUIN", siret: "26850025300011", adresse: "LA REYNERIE RUE DU PAYS DE RETZ 85230 BOUIN", codePostal: "85230", commune: "BOUIN" });
  const decision = decideIdentity({
    row,
    candidates: [ehpad],
    coverage: [{ source: "annuaire:text", status: "ok", required: true, coverage: { complete: false, hasNextPage: true } }],
  });
  assert.equal(decision.status, IDENTITY_STATES.INCOMPLETE);
});

test('Roman typography correction is limited to invalid numerals, preserving genuine numerals and nearby street distinctions',async()=>{
 const {normalizeAddressTypography}=await import('../identity-resolution.js');
 for(const [from,to] of [['XXlll','XXIII'],['Vll','VII'],['XVlll','XVIII']]){
  assert.equal(normalizeAddressTypography(`12 rue Charles ${from} 44000 Nantes`).normalized,`12 rue Charles ${to} 44000 Nantes`);
 }
 for(const token of ['XXII','XXIII','XL','Xl','LIII','Mill','Miller','XXLLL','Xlllfoo'])assert.equal(normalizeAddressTypography(token).normalized,token);
 assert.equal(addressEvidence('55 Bd Jean XXII 85300 Challans','55 Bd Jean XXIII 85300 Challans').conflict,true);
 assert.equal(addressEvidence('55 Bd Jean XXlll 85300 Challans','57 Bd Jean XXIII 85300 Challans').conflict,true);
});

test('a wrong or malformed entered number never vetoes a site proven by public name and address',()=>{
 const site=candidate({nomCommercial:'LES ACACIAS',aliases:['LES ACACIAS'],nomUsuelDistinct:true,raisonSociale:'OPERATEUR MULTISITE',siret:'12345678900029',siren:'123456789',adresse:'12 RUE DES ACACIAS 44000 NANTES'});
 for(const number of ['',site.siret,'12345678900011','98765432100019','987654321','erreur de saisie']){
  const result=decideIdentity({row:{NomCommercial:'Les Acacias',Adresse:'12 rue des Acacias 44000 Nantes',SirenSiret:number},candidates:[site],coverage:completeCoverage});
  assert.equal(result.status,'MATCH_VERIFIED');assert.equal(result.candidate.siret,site.siret);
  if(number&&number!==site.siret)assert.ok(result.identifierWarning);
 }
});

test('a matching entered number cannot turn an incompatible public name or site address into a verified identity',()=>{
 const site=candidate({nomCommercial:'AUTRE ECOLE',aliases:['AUTRE ECOLE'],nomUsuelDistinct:true,raisonSociale:'ASSOCIATION',siret:'12345678900029',siren:'123456789',adresse:'12 RUE DES ACACIAS 44000 NANTES'});
 const result=decideIdentity({row:{NomCommercial:'Les Acacias',Adresse:site.adresse,SirenSiret:site.siret},candidates:[site],coverage:completeCoverage});
 assert.notEqual(result.status,'MATCH_VERIFIED');
});

test('even an exact entered SIRET cannot select between two independently verified homonyms at the same site address',()=>{
 const first=candidate({nomCommercial:'LES ACACIAS',aliases:['LES ACACIAS'],nomUsuelDistinct:true,raisonSociale:'PREMIER OPERATEUR',siret:'12345678900029',siren:'123456789',adresse:'12 RUE DES ACACIAS 44000 NANTES'});
 const second={...first,siret:'98765432100019',siren:'987654321',raisonSociale:'SECOND OPERATEUR'};
 for(const entered of [first.siret,second.siret,'00000000000000']){
  const result=decideIdentity({row:{NomCommercial:'Les Acacias',Adresse:first.adresse,SirenSiret:entered},candidates:[first,second],coverage:completeCoverage});
  assert.equal(result.status,'AMBIGUOUS');assert.equal(result.candidate,null);assert.equal(result.alternatives.length,2);
 }
});

test('an entered registration number alone is not a demonstrated public-site identity',()=>{
 const site=candidate({raisonSociale:'OPERATEUR',siret:'12345678900029',siren:'123456789',adresse:'12 RUE DES ACACIAS 44000 NANTES'});
 const result=decideIdentity({row:{NomCommercial:'',Adresse:'',SirenSiret:site.siret},candidates:[site],coverage:completeCoverage});
 assert.notEqual(result.status,'MATCH_VERIFIED');assert.equal(result.candidate,null);
});
