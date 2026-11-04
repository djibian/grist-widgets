import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  formatUsualName,
  formatAddress,
  formatPhone,
  formatSiret,
} from "../presentation-conventions.js";
import { buildEnrichmentProposals, selectedChanges } from "../enrichment.js";
import { readOfficialSnapshot } from "../official-snapshots.js";
import { buildOfficialIdentifierSearchRequest } from "../search.js";
import { rows, replay, localTransport } from "./context-replay.mjs";

test("readable conventions preserve suffixes, accents, Roman numerals, brands and the complete commune", () => {
  for (const [input, town, expected] of [
    ["Espace et Vie Pornic", "Pornic", "Espace et vie — Pornic"],
    ["maison de l’enfance", "Legé", "Maison de l'enfance — Legé"],
    [
      "Super U Machecoul",
      "Machecoul-Saint-Même",
      "Super U — Machecoul-Saint-Même",
    ],
    [
      "ecole Notre Dame de Lourdes",
      "Sainte-Pazanne",
      "École notre dame de lourdes — Sainte-Pazanne",
    ],
  ]) {
    assert.equal(formatUsualName(input, town), expected);
    assert.equal(formatUsualName(expected, town), expected);
  }
  for (const [input, expected] of [
    [
      "10TER Place du Champ de Foire, 44650 Legé",
      "10 ter place du Champ de Foire, 44650 Legé",
    ],
    [
      "55 BOULEVARD JEAN XXIII 85300 CHALLANS",
      "55 boulevard Jean XXIII, 85300 Challans",
    ],
    [
      "43 rue Félix Platel 44310 Saint-Philbert-de-Grand-Lieu",
      "43 rue Félix Platel, 44310 Saint-Philbert-de-Grand-Lieu",
    ],
    [
      "6 rue des Ciseleurs ZA Voltière Sud 85710 La Garnache",
      "6 rue des Ciseleurs, 85710 La Garnache",
    ],
  ]) {
    assert.equal(formatAddress(input), expected);
    assert.equal(formatAddress(expected), expected);
  }
  assert.equal(formatPhone("+33 (0)2 51 74 33 00"), "02.51.74.33.00");
  assert.equal(formatSiret("26850065900027"), "268 500 659 00027");
  assert.equal(formatSiret("214400814"), "214 400 814");
});

test("an unavailable identity source still permits presentation fixes, without importing an unverified identity", () => {
  const row = {
    NomCommercial: "espace et VIE",
    Adresse: "2 RUE JOSHUA SLOCUM 44210 PORNIC",
    SirenSiret: "",
    Telephone: "0251743300",
  };
  const proposals = buildEnrichmentProposals(
    row,
    { siret: "99999999999999", raisonSociale: "Unverified" },
    { identityStatus: "INCOMPLETE" },
  );
  assert.ok(
    proposals.some(
      (p) =>
        p.field === "NomCommercial" && p.proposed === "Espace et vie — Pornic",
    ),
  );
  assert.ok(
    proposals.some(
      (p) => p.field === "Telephone" && p.proposed === "02.51.74.33.00",
    ),
  );
  assert.ok(proposals.every((p) => p.selectedByDefault));
  assert.ok(
    !proposals.some((p) =>
      ["RaisonSociale", "Coordinates", "SirenSiret"].includes(p.field),
    ),
  );
});

test("fresh exact public responses survive API failures; expiry, tampering and identifier substitution fail closed", async () => {
  const request = buildOfficialIdentifierSearchRequest("78835223500030");
  const path = new URL(
    "../identity-links/official-snapshots/78835223500030.json",
    import.meta.url,
  );
  const payload = JSON.parse(await readFile(path));
  const now = Date.parse(payload.checkedAt) + 86400000;
  const fetchImpl = async () => Response.json(payload);
  const valid = await readOfficialSnapshot(request, { fetchImpl, now });
  assert.ok(valid.verifiedSnapshot);
  assert.equal(valid.checkedAt, payload.checkedAt);
  assert.equal(valid.cached, true);
  assert.equal(
    await readOfficialSnapshot(request, {
      fetchImpl,
      now: now + 31 * 86400000,
    }),
    null,
  );
  payload.body += " ";
  assert.equal(await readOfficialSnapshot(request, { fetchImpl, now }), null);
  payload.siret = "99999999999999";
  assert.equal(await readOfficialSnapshot(request, { fetchImpl, now }), null);
});

test("the requested difficult cases now expose checked physical coordinates and their legal identity, with no row ID routing", async () => {
  for (const id of [10, 11, 14, 15, 16, 19, 20, 25]) {
    const row = rows.find((r) => r.id === id);
    const result = await replay({ ...row, id: 9000 + id });
    assert.equal(result.decision.status, "MATCH_VERIFIED");
    assert.ok(result.candidate.siret);
    assert.ok(result.candidate.raisonSociale);
    assert.ok(
      ["SITE_CONFIRMED", "SITE_CORROBORATED"].includes(
        result.candidate.position.status,
      ),
    );
    const proposals = buildEnrichmentProposals(row, result.candidate, {
      identityStatus: result.decision.status,
    });
    assert.ok(
      proposals.some((p) => p.field === "Coordinates" && p.selectedByDefault),
    );
    assert.ok(
      proposals
        .filter((p) => p.replacesExisting)
        .every((p) => p.selectedByDefault),
    );
  }
  const maison = await replay(rows.find((r) => r.id === 9));
  assert.equal(maison.candidate.siret, null);
  assert.equal(maison.candidate.operator.siret, "21440081400015");
  assert.equal(maison.candidate.raisonSociale, "COMMUNE DE LEGE");
  const p = buildEnrichmentProposals(
    rows.find((r) => r.id === 9),
    maison.candidate,
    { identityStatus: maison.decision.status },
  );
  assert.ok(p.some((p) => p.field === "RaisonSociale"));
  assert.ok(!p.some((p) => p.field === "SirenSiret"));
});

test("applying all checked corrections is stable on a second analysis of every real structure", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 5) });
  for (const row of rows) {
    const first = await replay(row),
      p = buildEnrichmentProposals(row, first.candidate, {
        identityStatus: first.decision.status,
      });
    const corrected = {
      ...row,
      ...selectedChanges(
        p,
        p.filter((p) => p.selectedByDefault).map((p) => p.field),
      ),
    };
    const second = await replay(corrected);
    assert.equal(
      second.decision.status,
      "MATCH_VERIFIED",
      `row ${row.id} lost its identity after formatting`,
    );
    assert.deepEqual(
      buildEnrichmentProposals(corrected, second.candidate, {
        identityStatus: second.decision.status,
      }),
      [],
      `row ${row.id} oscillates between spellings`,
    );
  }
});

test("confirmed existing coordinates keep priority over a weaker new point", () => {
  const siret = "12345678900011";
  const row = {
    SirenSiret: siret,
    Latitude: 47,
    Longitude: -1.8,
    PositionProof: JSON.stringify({ siret, status: "SITE_CONFIRMED" }),
  };
  const c = {
    siret,
    position: {
      siret,
      status: "SITE_CORROBORATED",
      latitude: 47.001,
      longitude: -1.8,
      source: { label: "Published place", recordId: "1" },
    },
  };
  assert.equal(
    buildEnrichmentProposals(row, c, { identityStatus: "MATCH_VERIFIED" }).find(
      (p) => p.field === "Coordinates",
    ).selectedByDefault,
    false,
  );
});

test("Lourdes keeps its full correction proposal when the external API is unavailable", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 5) });
  const { fetchOfficialRequest } = await import("../enterprise-client.js");
  let externalCalls = 0;
  const transport = async (input, options) => {
    if (new URL(input).protocol === "file:")
      return localTransport(input, options);
    externalCalls++;
    throw Error("API unavailable");
  };
  const row = rows.find((r) => r.id === 14),
    r = await replay(row, {
      fetchOfficial: (request, options) =>
        fetchOfficialRequest(request, { ...options, fetchImpl: transport }),
    });
  assert.equal(r.decision.status, "MATCH_VERIFIED");
  assert.equal(r.candidate.siret, "78835223500030");
  const fields = buildEnrichmentProposals(row, r.candidate, {
    identityStatus: r.decision.status,
  }).map((p) => p.field);
  for (const f of ["SirenSiret", "RaisonSociale", "Coordinates"])
    assert.ok(fields.includes(f));
  assert.equal(externalCalls, 0);
});

test("a completed local place proof does not wait for distant postcode services", async () => {
  const row = rows[0],
    r = await replay(row);
  const { findIndexedSitePositions } = await import(
    "../site-position-sources.js"
  );
  let externalCalls = 0;
  const transport = (input, options) => {
    if (new URL(input).protocol === "file:")
      return localTransport(input, options);
    externalCalls++;
    return new Promise(() => {});
  };
  const points = await findIndexedSitePositions({
    candidate: r.candidate,
    links: r.candidate.identityLinks,
    identityStatus: r.decision.status,
    fetchImpl: transport,
  });
  assert.ok(
    points.observations.some(
      (p) => p.latitude === 46.99808 && p.longitude === -1.815576,
    ),
  );
  assert.equal(externalCalls, 0);
});

test("every cached place retains its native public record and complete source capture fingerprint", async () => {
  const { readdir } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  let count = 0;
  const root = new URL(
    "../site-position-indexes/public-pois/",
    import.meta.url,
  );
  for (const cp of (await readdir(root)).filter((n) => /^\d{5}$/.test(n))) {
    const body = await readFile(
        new URL(
          `./fixtures/context/postcodes/overture-${cp}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
      source = JSON.parse(body);
    const actual = [];
    for (const file of await readdir(new URL(cp + "/", root))) {
      const p = JSON.parse(await readFile(new URL(cp + "/" + file, root)));
      assert.equal(
        p.source.sha256,
        createHash("sha256").update(body).digest("hex"),
      );
      assert.equal(p.recordCount, p.records.length);
      for (const r of p.records) {
        const native = source.records.find(
          (s) => s.recordId === r.source.recordId,
        );
        assert.ok(native);
        assert.deepEqual(
          [r.name, r.adresse, r.latitude, r.longitude],
          [native.name, native.address, native.latitude, native.longitude],
        );
        actual.push(r.source.recordId);
      }
    }
    assert.equal(
      new Set(actual).size,
      source.records.filter(
        (r) => r.name && r.address && r.latitude != null && r.longitude != null,
      ).length,
    );
    count += actual.length;
  }
  assert.ok(count > 4000);
});

test("a fast API failure cannot finish a public-site result before the typed-identifier snapshot completes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 5) });
  const row = rows.find((r) => r.id === 25),
    r = await replay(row, {
      fetchOfficial: async () => {
        throw Error("HTTP 429");
      },
      fetchSnapshot: async (request, options) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return readOfficialSnapshot(request, {
          ...options,
          fetchImpl: localTransport,
        });
      },
    });
  assert.equal(r.decision.status, "MATCH_VERIFIED");
  assert.equal(r.candidate.siret, "79080707700017");
  assert.equal(r.candidate.raisonSociale, "ROULE TA BILLE");
  assert.ok(r.candidate.latitude);
});
