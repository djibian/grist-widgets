import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { POSITION_STATES, resolveSitePosition, siteDistanceMeters } from "../establishment-position.js";
import { matchPublishedIdentityLinks } from "../published-identity-links.js";

const row = { NomCommercial: "Super U Machecoul", Adresse: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME" };
const published = JSON.parse(await readFile(new URL("../identity-links/published.json", import.meta.url)));
const links = matchPublishedIdentityLinks(published.records, row).map(link => ({ ...link, verifiedOfficial: true }));
const overture = JSON.parse(await readFile(new URL("./fixtures/overture-44270.json", import.meta.url)));
const record = overture.records.find(item => item.name === row.NomCommercial);
const official = {
  siret: "41091808000020", raisonSociale: "SIDONAM", aliases: [], nomUsuelDistinct: false,
  adresse: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME",
  latitude: 46.9980411897428, longitude: -1.8156674543287,
};
const poi = {
  kind: "site", name: record.name, siret: record.siret, adresse: record.address,
  latitude: record.latitude, longitude: record.longitude,
  source: { id: "overture", label: "Overture Places", recordId: record.recordId, upstream: overture.upstream },
};

test("published Super U identity and the actual Overture place yield a coherent real-site position, not the IGN street point", () => {
  const discovery = [{ adresse: row.Adresse, latitude: 46.996561, longitude: -1.815374 }];
  const position = resolveSitePosition(official, { observations: [poi], links, discovery });
  assert.equal(position.status, POSITION_STATES.SITE_CORROBORATED);
  assert.equal(position.siret, official.siret);
  assert.equal(position.source.recordId, "dd01bb16-803f-4a74-bb8f-738051c4c415");
  assert.ok(siteDistanceMeters(position, { latitude: 46.99818631727761, longitude: -1.8152600022701086 }) < 30);
  assert.ok(siteDistanceMeters(position, discovery[0]) > 150);
  assert.deepEqual(position.proof.map(item => item.kind), ["ATTESTED_PUBLIC_NAME", "EXACT_SITE_ADDRESS", "OFFICIAL_REVALIDATION"]);
  assert.ok(position.proof[0].source.url.startsWith("https://www.magasins-u.com/"));
  assert.equal(position.proof[0].source.historical, true);
  assert.equal(position.evidence.find(item => item.kind === "discovery").accepted, false);
  assert.equal(position.evidence.find(item => item.kind === "administrative").accepted, false);
});

test("a neighbouring POI with a different SIRET cannot be attached, even with identical name, address and coordinates", () => {
  const result = resolveSitePosition(official, { observations: [{ ...poi, siret: "12345678900011" }], links });
  assert.equal(result.status, POSITION_STATES.UNRESOLVED);
  assert.equal(result.latitude, null);
  assert.match(result.evidence.at(-1).reason, /autre SIRET/);
});

test("proximity, legal operator name, brand and existence confidence cannot substitute for public site identity", () => {
  for (const name of ["SIDONAM", "Station Super U Machecoul", "Super U Machecoul Services", "Magasin voisin"]) {
    assert.equal(resolveSitePosition(official, { observations: [{ ...poi, name, publicNames: ["Super U"], confidence: 1 }], links }).status, POSITION_STATES.UNRESOLVED);
  }
  assert.equal(resolveSitePosition(official, { observations: [poi], links: [] }).status, POSITION_STATES.UNRESOLVED);
  assert.equal(resolveSitePosition(official, { observations: [poi], links: links.map(link => ({ ...link, verifiedOfficial: false })) }).status, POSITION_STATES.UNRESOLVED);
});

test("same name at another site, conflicting postcode and contradictory house numbers are rejected", () => {
  for (const adresse of ["BOULEVARD GABRIEL RELIQUET 44270 MACHECOUL-SAINT-MEME", "BOULEVARD DES PRISES 44680 SAINTE-PAZANNE", "8 BOULEVARD DES PRISES 44270 MACHECOUL-SAINT-MEME"]) {
    assert.equal(resolveSitePosition(official, { observations: [{ ...poi, adresse }], links }).status, POSITION_STATES.UNRESOLVED);
  }
  const shop = { ...official, aliases: ["O PRE D'VOUS"], adresse: "24 RUE DES FOSSES 44270 LA MARNE", siret: "89306104400028" };
  assert.equal(resolveSitePosition(shop, { observations: [{ ...poi, name: "ô Pré d’Vous", adresse: "26 RUE DES FOSSES 44270 LA MARNE" }] }).status, POSITION_STATES.UNRESOLVED);
});

test("an exact SIRET site reference is preferred and contradictory positions cause abstention, not averaging", () => {
  const osm = { ...poi, siret: official.siret, source: { id: "osm", label: "OpenStreetMap", recordId: "way:42" } };
  const result = resolveSitePosition(official, { observations: [poi, osm], links });
  assert.equal(result.status, POSITION_STATES.SITE_CONFIRMED);
  assert.equal(result.source.id, "osm");
  const conflict = resolveSitePosition(official, { observations: [poi, { ...osm, latitude: osm.latitude + 0.001 }], links });
  assert.equal(conflict.status, POSITION_STATES.CONFLICT);
  assert.equal(conflict.latitude, null);
  assert.equal(conflict.longitude, null);
});

test("Annuaire coordinates and address geocoding alone never become a demonstrated site position", () => {
  const result = resolveSitePosition(official, { discovery: [{ latitude: 46.996561, longitude: -1.815374 }] });
  assert.equal(result.status, POSITION_STATES.UNRESOLVED);
  assert.equal(result.latitude, null);
  assert.equal(resolveSitePosition(official, { observations: [{ ...poi, kind: "address" }], links }).status, POSITION_STATES.UNRESOLVED);
});
