import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { rows, replay, directory } from "./context-replay.mjs";
import {
  publishedAccessBinding,
  parseSiteAddress,
} from "../identity-resolution.js";
import {
  validateCertifiedEntrance,
  publicEntrancePositionValid,
} from "../certified-entrances.js";
import { buildEnrichmentProposals, selectedChanges } from "../enrichment.js";
import { applyEnrichmentChanges } from "../grist.js";

test("a published physical access and registered address reconcile the same establishment without proximity", async () => {
  const row = rows.find((r) => r.id === 24),
    r = await replay(row);
  assert.equal(r.decision.status, "MATCH_VERIFIED");
  assert.equal(r.candidate.siret, "78592725200011");
  assert.equal(r.candidate.raisonSociale, "RESIDENCE SAINT JOSEPH");
  assert.ok(
    r.candidate.position.proof.some((p) => p.kind === "PUBLISHED_ACCESS"),
  );
  assert.deepEqual(
    [r.candidate.latitude, r.candidate.longitude],
    [47.11622528, -1.9417729],
  );
  const p = directory.records.find((r) => r.id === "saint-joseph-chaumes"),
    c = { ...r.candidate, adresse: r.candidate.officialAddress };
  assert.ok(publishedAccessBinding(p, c));
  for (const change of [
    (p) => (p.siret = "78592725299999"),
    (p) => (p.access.nativeHtml = "Un autre accès rue de Nantes"),
    (p) => (p.registration.url = "https://unrelated.test/"),
    (p) => (p.registeredAddress = "5 rue de Pornic 44320 Chaumes-en-Retz"),
  ]) {
    const wrong = structuredClone(p);
    change(wrong);
    assert.equal(publishedAccessBinding(wrong, c), null);
  }
  assert.equal(
    parseSiteAddress("Chemin Saint Joseph BP 4015 44320 Chaumes-en-Retz")
      .number,
    "",
  );
});

test("only a native, municipality-certified entrance can produce this fallback position", async () => {
  const p = JSON.parse(
    await readFile(
      new URL(
        "../site-position-indexes/certified-entrances/85670/2.json",
        import.meta.url,
      ),
    ),
  );
  const feature = p.records[0];
  assert.ok(validateCertifiedEntrance(feature));
  for (const change of [
    (p) => (p.type_position = "segment"),
    (p) => (p.certification_commune = "0"),
    (p) => (p.source_position = "interpolation"),
    (p) => (p.lat = 100),
    (p) => (p.numero = ""),
    (p) => (p.id = "unrelated"),
  ]) {
    const wrong = structuredClone(feature);
    change(wrong.properties);
    assert.equal(validateCertifiedEntrance(wrong), null);
  }
  for (const id of [18, 23]) {
    const row = rows.find((r) => r.id === id),
      r = await replay(row);
    assert.equal(r.candidate.position.status, "SITE_CORROBORATED");
    assert.equal(r.candidate.position.source.geometry, "certified-entrance");
    const p = buildEnrichmentProposals(row, r.candidate, {
      identityStatus: r.decision.status,
    });
    assert.ok(p.some((p) => p.field === "Coordinates" && p.selectedByDefault));
  }
});

test("the public-school entrance and normalized fields are written together and tampering is refused", async (t) => {
  const row = rows.find((r) => r.id === 23),
    r = await replay(row),
    position = r.candidate.position;
  assert.ok(publicEntrancePositionValid(position));
  const wrong = structuredClone(position);
  wrong.latitude += 0.001;
  assert.equal(publicEntrancePositionValid(wrong), false);
  const mappings = Object.fromEntries(
    [
      "NomCommercial",
      "Adresse",
      "SirenSiret",
      "RaisonSociale",
      "Latitude",
      "Longitude",
      "Telephone",
      "Courriel",
      "SiteWeb",
      "PositionSource",
      "PositionProof",
    ].map((k) => [k, k]),
  );
  const table = Object.fromEntries(
    ["id", ...Object.keys(mappings)].map((k) => [k, [row[k] ?? ""]]),
  );
  const old = globalThis.grist;
  let writes = 0;
  globalThis.grist = {
    selectedTable: {
      async getTableId() {
        return "Structures_de_stage";
      },
    },
    async setCursorPos() {},
    docApi: {
      async fetchTable(id) {
        return id === "Structures_de_stage"
          ? table
          : id === "_grist_Tables"
            ? { id: [1], tableId: ["Structures_de_stage"] }
            : {};
      },
      async applyUserActions(actions) {
        writes++;
        for (const [, , id, fields] of actions)
          for (const [k, v] of Object.entries(fields)) table[k][0] = v;
      },
    },
  };
  t.after(() => {
    globalThis.grist = old;
  });
  const proposals = buildEnrichmentProposals(row, r.candidate, {
      identityStatus: r.decision.status,
    }),
    changes = selectedChanges(
      proposals,
      proposals.filter((p) => p.selectedByDefault).map((p) => p.field),
    );
  await assert.rejects(
    applyEnrichmentChanges(
      row.id,
      { ...changes, Latitude: position.latitude + 0.001 },
      mappings,
      { publicSitePosition: position, expectedRow: row },
    ),
    /site public/,
  );
  assert.equal(writes, 0);
  await applyEnrichmentChanges(row.id, changes, mappings, {
    publicSitePosition: position,
    expectedRow: row,
  });
  assert.equal(writes, 1);
  assert.equal(table.Latitude[0], position.latitude);
  assert.equal(table.SirenSiret[0], "");
});
