import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  findOfficialPublicSites,
  publicSiteCandidate,
  publicSiteWriteProofValid,
  validatePublicSite,
} from "../public-sites.js";
import {
  findOfficialRegistrySites,
  verifiedRegistryLink,
} from "../official-site-registry.js";
import { extractOfficialCandidates } from "../search.js";
import { resolveIdentityForEnrichment } from "../identity-service.js";
import { resolveEstablishmentForEnrichment } from "../establishment-service.js";
import { findIndexedSitePositions } from "../site-position-sources.js";
import { resolveSitePosition } from "../establishment-position.js";
import { ignSiteObservation, assessIgnSite } from "../ign-site-positions.js";
import { pointInsideSingleBuilding } from "../address-building-positions.js";
import { buildEnrichmentProposals, selectedChanges } from "../enrichment.js";
const json = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const local = async (input) => {
  const u = new URL(input);
  u.search = "";
  try {
    return new Response(await readFile(u));
  } catch {
    return new Response("", { status: 404 });
  }
};
const actual = (
  await json("./fixtures/resolution/grist-inputs-2026-10-27.json")
).rows;
const row = actual.find((x) => x.id === 9);
const cohort = await json("../identity-links/public-sites/44081.json");
const record = cohort.records.find((x) => x.id === "6294");
const publisher = cohort.publisher;
const educationRow = actual.find((x) => x.id === 5);
const registry = (
  await findOfficialRegistrySites({
    row: educationRow,
    fetchImpl: local,
    allowLive: false,
  })
).records[0];
const official = extractOfficialCandidates(
  await json("./fixtures/resolution/alliance-annuaire.json"),
).items[0];
const link = verifiedRegistryLink(registry, official, {
  checkedAt: new Date().toISOString(),
  url: "https://recherche-entreprises.api.gouv.fr/search?q=" + official.siret,
});
const ign = await json("../site-position-indexes/ign-education/85047/085125.json");
const feature = ign.records.find(
  (x) => x.properties.identifiants_sources === "MEN:0851256D",
);
const poi = ignSiteObservation(feature, ign.source);

test("Alliance obtains a real IGN footprint explicitly carrying its UAI, distinct from the neighbouring college", async () => {
  assert.equal(
    assessIgnSite(official, poi, {
      links: [link],
      identityStatus: "MATCH_VERIFIED",
    }).accepted,
    true,
  );
  assert.equal(
    pointInsideSingleBuilding([-1.8664473, 46.8371761], feature.geometry),
    true,
    "the user-provided Google place point belongs to this official school footprint",
  );
  const result = await resolveEstablishmentForEnrichment({
    row: educationRow,
    resolveIdentity: async () => ({
      decision: { status: "MATCH_VERIFIED", candidate: official },
      links: [link],
    }),
    findIndexedPositions: (opts) =>
      findIndexedSitePositions({ ...opts, fetchImpl: local }),
    findOsmPositions: async () => {
      throw Error("unnecessary Overpass");
    },
  });
  assert.equal(result.candidate.position.status, "SITE_CONFIRMED");
  assert.equal(result.candidate.position.source.id, "ign-bdtopo");
  assert.equal(
    result.candidate.position.source.recordId,
    "SURFACTI0000000070239731",
  );
  assert.equal(
    pointInsideSingleBuilding(
      [result.candidate.longitude, result.candidate.latitude],
      feature.geometry,
    ),
    true,
  );
  assert.equal(
    result.candidate.position.source.geometry,
    "site-interior-point",
  );
  assert.ok(
    result.candidate.position.proof.some(
      (p) => p.kind === "EXPLICIT_IGN_UAI_FOOTPRINT",
    ),
  );
  assert.equal(ign.source.cohort.count, 124);
  assert.ok(ign.records.every((f) => f.properties.insee_commune === "85047"));
});

for (const [name, change] of [
  ["college UAI", (f) => (f.properties.identifiants_sources = "MEN:0851158X")],
  ["fictional geometry", (f) => (f.properties.fictif = true)],
  [
    "computed approximate geometry",
    (f) => (f.properties.methode_d_acquisition_planimetrique = "Calculé"),
  ],
  ["wrong category", (f) => (f.properties.nature = "Collège")],
  [
    "another school name",
    (f) => (f.properties.toponyme = "Groupe scolaire du voisin"),
  ],
  [
    "another house",
    (f) => (f.properties.adresse_postale = "57 BOULEVARD JEAN XXIII"),
  ],
  ["another commune", (f) => (f.properties.insee_commune = "44081")],
])
  test("IGN rejects " + name, () => {
    const f = structuredClone(feature);
    change(f);
    const other = ignSiteObservation(f, ign.source);
    assert.equal(
      assessIgnSite(official, other, {
        links: [link],
        identityStatus: "MATCH_VERIFIED",
      }).accepted,
      false,
    );
  });

test("a position contradiction carrying the same school identifier provokes abstention", () => {
  const wrong = structuredClone(poi);
  wrong.latitude += 0.002;
  const result = resolveSitePosition(official, {
    observations: [poi, wrong],
    links: [link],
    identityStatus: "MATCH_VERIFIED",
  });
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.latitude, null);
});

test("Legé is a verified public site with its municipality-published coordinates, without borrowing the town hall SIRET", async () => {
  let officialSignal;
  const result = await resolveIdentityForEnrichment({
    row,
    findRegistrySites: async () => ({ records: [], complete: true }),
    findPublicSites: (opts) =>
      findOfficialPublicSites({ ...opts, fetchImpl: local }),
    findPublishedLinks: null,
    fetchOfficial: (_, { signal }) => {
      officialSignal = signal;
      return new Promise(() => {});
    },
    geocode: async () => {
      throw Error("must not await secondary geocoding");
    },
  });
  assert.equal(result.decision.status, "MATCH_VERIFIED");
  const c = result.decision.candidate;
  assert.equal(c.identityScope, "PUBLIC_SITE");
  assert.equal(c.siret, null);
  assert.equal(c.siren, null);
  assert.equal(c.raisonSociale, "");
  assert.deepEqual([c.latitude, c.longitude], [46.8861988, -1.5975397]);
  assert.ok(officialSignal.aborted);
  assert.ok(publicSiteWriteProofValid(c.position));
  const proposals = buildEnrichmentProposals(row, c, {
    identityStatus: result.decision.status,
  });
  assert.deepEqual(
    proposals.map((p) => p.field),
    ["Coordinates"],
  );
  const changes = selectedChanges(proposals, ["Coordinates"]);
  assert.equal(changes.Latitude, c.latitude);
  assert.equal(changes.Longitude, c.longitude);
  assert.equal(changes.SirenSiret, undefined);
  const stored = JSON.parse(changes.PositionProof);
  assert.equal(stored.identityScope, "PUBLIC_SITE");
  assert.equal(stored.siteId, record.url);
  assert.equal(stored.siret, null);
  assert.equal(cohort.source.recordCount, 87);
  assert.equal(cohort.source.selectedRecords, 12);
  assert.ok(cohort.recordCount > 2);
});

test("a nearby Maison des Jeunes or a different address cannot supply the Maison de l’enfance point", () => {
  const other = structuredClone(record);
  other.name = "Maison des Jeunes";
  other.native.titleHtml = "Maison des Jeunes";
  other.native.markerHtml = other.native.markerHtml.replace(
    /Enfance/g,
    "Jeunes",
  );
  assert.equal(publicSiteCandidate(other, publisher, row), null);
  assert.equal(
    publicSiteCandidate(record, publisher, {
      ...row,
      Adresse: "10ter rue Jules Ferry 44650 Legé",
    }),
    null,
  );
  assert.equal(
    publicSiteCandidate(record, publisher, {
      ...row,
      Adresse: "10ter Place du Champ de Foire 44000 Nantes",
    }),
    null,
  );
});

for (const [name, change] of [
  ["changed point", (r) => (r.latitude += 0.001)],
  [
    "different marker name",
    (r) =>
      (r.native.markerHtml = r.native.markerHtml.replace("Enfance", "Jeunes")),
  ],
  ["missing source date", (r) => (r.modifiedAt = "")],
  ["foreign publisher URL", (r) => (r.url = "https://example.org/place")],
])
  test("public site rejects " + name, () => {
    const r = structuredClone(record);
    change(r);
    assert.equal(validatePublicSite(r, publisher), null);
  });

test("the municipality authority proof must attest the publisher domain and commune", () => {
  for (const change of [
    (p) =>
      (p.authorityRecord.site_internet = '[{"valeur":"https://example.org"}]'),
    (p) => (p.code = "85047"),
    (p) => delete p.authorityRecord,
  ]) {
    const p = structuredClone(publisher);
    change(p);
    assert.equal(validatePublicSite(record, p), null);
  }
});

test("multiple official sites stay ambiguous instead of choosing the nearest point", async () => {
  const first = publicSiteCandidate(record, publisher, row);
  const second = structuredClone(first);
  second.siteId += "/other";
  const result = await resolveIdentityForEnrichment({
    row,
    findRegistrySites: async () => ({ records: [], complete: true }),
    findPublicSites: async () => ({ candidates: [first, second] }),
    findPublishedLinks: null,
    fetchOfficial: async () => ({ items: [], coverage: { complete: true } }),
    geocode: async () => [],
  });
  assert.equal(result.decision.status, "AMBIGUOUS");
  assert.equal(result.decision.candidate, null);
});

test("a public point cannot carry an unvalidated registration number or tampered provenance into a write", () => {
  const c = publicSiteCandidate(record, publisher, row);
  const existingNumber = { ...row, SirenSiret: "21440081400015" };
  assert.deepEqual(
    selectedChanges(buildEnrichmentProposals(existingNumber, c), [
      "Coordinates",
    ]),
    {},
  );
  for (const mutate of [
    (p) => (p.siteId = "other"),
    (p) => (p.siret = "21440081400015"),
    (p) => (p.source.url = "https://example.org"),
    (p) => (p.latitude += 0.001),
  ]) {
    const p = structuredClone(c.position);
    mutate(p);
    assert.equal(publicSiteWriteProofValid(p), false);
  }
});
