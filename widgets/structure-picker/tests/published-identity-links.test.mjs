import test from "node:test";
import assert from "node:assert/strict";
import { findPublishedIdentityLinks, matchPublishedIdentityLinks } from "../published-identity-links.js";

const row = {
  NomCommercial: "Super U Machecoul",
  Adresse: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME",
};

const officialLink = {
  recordId: "magasins-u:PL00660",
  siret: "41091808000020",
  publicNames: ["Super U Machecoul", "Super U"],
  legalName: "SIDONAM",
  address: "BOULEVARD DES PRISES 44270 MACHECOUL ST MEME",
  postcode: "44270",
  city: "MACHECOUL ST MEME",
  sourceLabel: "Magasins U",
  sourceUrl: "https://example.test/u.pdf",
  sourcePublishedAt: "2023-12-21",
  sourceKind: "operator-published-local-siret",
};

test("published identity link requires both public identity and compatible site address", () => {
  const wrongName = { ...officialLink, recordId: "other", siret: "11111111100011", publicNames: ["Autre magasin"] };
  const wrongAddress = { ...officialLink, recordId: "far", siret: "22222222200022", address: "1 RUE AUTRE 44000 NANTES" };
  const matches = matchPublishedIdentityLinks([wrongName, wrongAddress, officialLink], row);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].siret, "41091808000020");
  assert.equal(matches[0].sourceLabel, "Magasins U");
  assert.equal(matches[0].legalName, "SIDONAM");
  assert.equal(matches[0].postcode, "44270");
});

test("published link loader preserves provenance and legal revalidation hints", async () => {
  const result = await findPublishedIdentityLinks({
    row,
    fetchImpl: async () => ({
      ok: true,
      async json() { return { schemaVersion: 1, generatedAt: "2026-10-01T00:00:00Z", records: [officialLink] }; },
    }),
  });
  assert.equal(result.complete, true);
  assert.equal(result.candidates[0].siret, "41091808000020");
  assert.equal(result.candidates[0].legalName, "SIDONAM");
  assert.equal(result.candidates[0].postcode, "44270");
  assert.equal(result.candidates[0].sourceUrl, "https://example.test/u.pdf");
  assert.equal(result.candidates[0].sourcePublishedAt, "2023-12-21");
});
