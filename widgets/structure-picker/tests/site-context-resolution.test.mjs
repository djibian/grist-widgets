import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  findOfficialRegistrySites,
  resetRegistryCacheForTests,
} from "../official-site-registry.js";
import { resolveEstablishmentForEnrichment } from "../establishment-service.js";
import { findOfficialPublicSites } from "../public-sites.js";
import { findPublishedIdentityLinks } from "../published-identity-links.js";
import { findIndexedSitePositions } from "../site-position-sources.js";
import { findFinessIdentityLinks } from "../finess-identity.js";
import { extractOfficialCandidates } from "../search.js";
import { phoneKey, emailKey, siteContextEvidence } from "../site-context.js";
import {
  validateNamedSite,
  namedSiteCandidate,
  namedSiteAddressSuggestions,
  namedSitePositionValid,
} from "../named-site-directory.js";
import { establishmentConfidence } from "../confidence.js";
import { buildEnrichmentProposals, selectedChanges } from "../enrichment.js";
import { parseChildcareDirectory } from "../../../scripts/generate-childcare-directory.mjs";
import {
  rows,
  directory,
  localTransport,
  officialReplay,
  replay,
} from "./context-replay.mjs";
const results = new Map();
test("replay every actual public structure row: useful candidates, no global timeout or manager number invented", async (t) => {
  for (const row of rows)
    await t.test(`${row.id}: ${row.NomCommercial}`, async () => {
      const result = await replay(row);
      results.set(row.id, result);
      assert.ok(
        result.candidate,
        JSON.stringify({
          row,
          diagnostics: result.diagnostics,
          decision: result.decision,
        }),
      );
      assert.equal(
        result.decision.status,
        [15, 19].includes(row.id) ? "MATCH_PROBABLE" : "MATCH_VERIFIED",
      );
      assert.ok(!result.diagnostics.some((d) => /délai maximal/.test(d)));
      assert.ok(result.candidate.adresse);
      const proposals = buildEnrichmentProposals(row, result.candidate, {
        identityStatus: result.decision.status,
      });
      if ([15, 19].includes(row.id)) {
        assert.equal(result.candidate.latitude, null);
        assert.ok(
          proposals.some(
            (p) =>
              p.field === "Adresse" && p.proposed.includes("Gabriel Reliquet"),
          ),
        );
        assert.ok(proposals.every((p) => !p.selectedByDefault));
        assert.ok(
          !proposals.some((p) =>
            ["Coordinates", "SirenSiret"].includes(p.field),
          ),
        );
      }
      if ([23, 24].includes(row.id))
        assert.equal(
          result.candidate.siret,
          null,
          "conflicting official registry must not assign its legal number to the named site",
        );
    });
});
test("preserves the historical site coordinates, both Sainte Marie variants and explicit-number corrections", async () => {
  for (const [id, latitude, longitude] of [
    [1, 46.99808, -1.815576],
    [2, 46.9742242, -1.9937342],
    [3, 46.99756389, -1.7365524],
    [4, 46.868617815626294, -1.942076105568997],
  ]) {
    const c = results.get(id).candidate;
    assert.equal(c.latitude, latitude);
    assert.equal(c.longitude, longitude);
  }
  assert.equal(results.get(7).candidate.siret, "78605938600023");
  assert.equal(results.get(8).candidate.siret, "78605938600023");
  assert.equal(results.get(16).candidate.siret, "26850065900027");
  assert.equal(
    results.get(7).decision.identifierWarning.entered,
    "78605938600015",
  );
});
test("shared operator contacts, wrong address suffixes, postcodes and names cannot supply another site", () => {
  const record = directory.records.find((r) =>
    r.name.includes("Picoti Picota"),
  );
  const actual = directory.records.find((r) => r.name.includes("rainette"));
  assert.ok(record && actual);
  const row = {
    NomCommercial: actual.name,
    Adresse: actual.adresse,
    Telephone: record.contacts.phones[0],
  };
  assert.equal(namedSiteCandidate(record, row), null);
  const r = directory.records.find((r) => r.id === "roule-ta-bille");
  for (const change of [
    { Adresse: "2 rue Paul Fort 44760 La Bernerie-en-Retz" },
    { Adresse: "1 ter rue Paul Fort 44760 La Bernerie-en-Retz" },
    { Adresse: "1 rue Paul Fort 85300 Challans" },
    { NomCommercial: "Maison de retraite" },
  ]) {
    assert.equal(
      namedSiteCandidate(r, {
        NomCommercial: r.name,
        Adresse: r.adresse,
        ...change,
      }),
      null,
    );
  }
  assert.equal(
    siteContextEvidence(
      {
        NomCommercial: r.name,
        Adresse: "",
        Courriel: "anything@rouletabille.net",
      },
      r,
    ).matched,
    false,
    "a shared email domain is never an identity proof",
  );
  assert.equal(phoneKey("200 056 455 0003"), "");
  assert.equal(emailKey("foyer-mimosas.com"), "");
});
test("contact-derived UAI helps discovery but cannot erase a different school name or site address", async () => {
  const row = rows.find((r) => r.id === 21);
  const r = await findOfficialRegistrySites({
    row,
    fetchImpl: localTransport,
    allowLive: false,
  });
  assert.equal(r.records[0].recordId, "0442536T");
  const bad = await findOfficialRegistrySites({
    row: {
      ...row,
      NomCommercial: "École du voisin",
      Adresse: "4 rue Jules Ferry",
    },
    fetchImpl: localTransport,
    allowLive: false,
  });
  assert.deepEqual(bad.records, []);
  const other = await findOfficialRegistrySites({
    row: { ...row, Adresse: "6 rue Jules Ferry 44310 La Limouzinière" },
    fetchImpl: localTransport,
    allowLive: false,
  });
  assert.deepEqual(other.records, []);
});
test("corrects site names and contacts but never automatically overwrites an entered field", () => {
  const row = rows.find((r) => r.id === 22),
    result = results.get(22);
  const p = buildEnrichmentProposals(row, result.candidate, {
    identityStatus: result.decision.status,
  });
  assert.ok(
    p.some((p) => p.field === "Adresse" && p.proposed.includes("44310")),
  );
  assert.ok(p.some((p) => p.field === "Telephone"));
  assert.ok(p.some(p => p.field === "Courriel" && p.proposed === "ecolenddlc@gmail.com"));
  assert.ok(
    p.filter((p) => p.replacesExisting).every((p) => !p.selectedByDefault),
  );
  const uncertain = results.get(15);
  assert.equal(
    establishmentConfidence(uncertain.decision, uncertain.candidate).score,
    55,
  );
});
test("directory capture provenance, points and missing precision fail closed", () => {
  for (const r of directory.records) assert.ok(validateNamedSite(r), r.id);
  const r = structuredClone(
    directory.records.find((r) => r.id === "paz-a-pas"),
  );
  assert.equal(namedSitePositionValid(namedSiteCandidate(r, {NomCommercial:r.name,Adresse:r.adresse}).position),false);
  assert.equal(namedSiteCandidate(r, {NomCommercial:r.name,Adresse:r.adresse}).latitude,null);
  r.point.latitude += 1;
  const c = namedSiteCandidate(r, {
    NomCommercial: r.name,
    Adresse: r.adresse,
  });
  assert.equal(c.latitude, null);
  r.name = "Invented school";
  assert.equal(validateNamedSite(r), false);
  const villa = results.get(17).candidate;
  assert.equal(villa.position.status, "UNRESOLVED");
  assert.equal(villa.latitude, null);
  const suggestion = namedSiteAddressSuggestions(
    directory.records,
    rows.find((r) => r.id === 15),
  );
  assert.equal(suggestion.length, 1);
  assert.equal(suggestion[0].identityStatus, "MATCH_PROBABLE");
});
test("a complete childcare heading cohort preserves source blocks and shared phones without targeted names", () => {
  const records = directory.records.filter((r) => r.native.siteHtml);
  assert.equal(records.length, 16);
  const html = records.map((r) => r.native.siteHtml).join("\n");
  const replay = parseChildcareDirectory(html, {
    url: records[0].url,
    publisherLabel: records[0].publisherLabel,
  });
  assert.deepEqual(
    replay.map((r) => [r.name, r.adresse, r.contacts]),
    records.map((r) => [r.name, r.adresse, r.contacts]),
  );
});
test("confidence is ordinal and cannot average away ambiguity, incompleteness or a position conflict", () => {
  const c = { position: { status: "SITE_CONFIRMED" } };
  assert.equal(
    establishmentConfidence({ status: "MATCH_VERIFIED" }, c).score,
    95,
  );
  assert.equal(establishmentConfidence({ status: "AMBIGUOUS" }, c).score, 35);
  assert.equal(establishmentConfidence({ status: "INCOMPLETE" }, c).score, 25);
  assert.equal(
    establishmentConfidence(
      { status: "MATCH_VERIFIED" },
      { position: { status: "CONFLICT" } },
    ).score,
    40,
  );
});

test('public HTTP captures retain their exact body, capture time and SHA-256', async () => {
  const {createHash}=await import('node:crypto');
  const captures=JSON.parse(await readFile(new URL('./fixtures/context/official-responses.json',import.meta.url),'utf8'));
  assert.equal(captures.length,20);
  for(const c of captures){assert.equal(createHash('sha256').update(c.body).digest('hex'),c.sha256);assert.deepEqual(JSON.parse(c.body),c.payload);assert.ok(Number.isFinite(Date.parse(c.capturedAt)));}
});
