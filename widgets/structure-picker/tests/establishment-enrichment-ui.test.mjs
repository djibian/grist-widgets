import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate as settle } from "node:timers/promises";
import { resetOfficialClientForTests } from "../enterprise-client.js";

// Exercise the sole enrichment listener loaded by index.html with the actual
// identity, index-source and position pipeline, fake Grist and controlled network races.
class Element extends EventTarget {
  children = [];
  dataset = {};
  disabled = false;
  checked = false;
  className = "";
  #text = "";
  classList = { add: value => { this.className += ` ${value}`; } };

  constructor(tagName = "div") {
    super();
    this.tagName = tagName;
  }

  set textContent(value) { this.#text = String(value); this.children = []; }
  get textContent() { return this.#text + this.children.map(child => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.#text = ""; this.children = children; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const matches = node => {
      if (selector.startsWith("#")) return node.id === selector.slice(1);
      if (selector.startsWith(".")) return node.className.split(" ").includes(selector.slice(1));
      if (selector === "a") return node.tagName === "a";
      if (selector === 'input[type="radio"]') return node.tagName === "input" && node.type === "radio";
      return node.tagName === "input" && node.dataset.identityProposalField
        && (!selector.includes(":checked") || node.checked)
        && (!selector.includes(":not(:disabled)") || !node.disabled);
    };
    return this.children.flatMap(child => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

const published = JSON.parse(await readFile(new URL("../identity-links/published.json", import.meta.url), "utf8"));
const overtureShard = JSON.parse(await readFile(new URL("./fixtures/overture-44270.json", import.meta.url), "utf8"));
const atpShard = JSON.parse(await readFile(new URL("./fixtures/all-the-places-44270.json", import.meta.url), "utf8"));
const ehpadOfficial = JSON.parse(await readFile(new URL("./fixtures/ehpad-annuaire.json", import.meta.url), "utf8"));
const ehpadFiness = JSON.parse(await readFile(new URL("./fixtures/ehpad-finess.json", import.meta.url), "utf8"));
const manifest = {
  schemaVersion: 1, generatedAt: "2026-09-14T15:54:51Z", sources: Object.fromEntries([
    ["all-the-places", "All The Places"], ["overture", "Overture Places"],
  ].map(([id, label]) => [id, { label, pathTemplate: `${id}/{department}/{postcode}.json`, shardBy: "postcode", departments: ["44", "85"] }])),
};
const scenarios = [
  {
    name: "Super U Machecoul", address: "Boulevard Des Prises Zone Commerciale 44270 MACHECOUL ST MEME",
    siret: "41091808000020", legalName: "SIDONAM", alias: null,
    officialAddress: "ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME", postcode: "44270", city: "MACHECOUL-SAINT-MEME",
    latitude: 46.996561, longitude: -1.815374, label: "Identité confirmée",
  },
  {
    name: "EHPAD La Reynerie Bouin 85230", address: "8bis Rue du Pays de Retz 85230 Bouin",
    siret: "26850025300011", legalName: "EHPAD LA REYNERIE BOUIN", alias: "EHPAD",
    officialAddress: "LA REYNERIE RUE DU PAYS DE RETZ 85230 BOUIN", postcode: "85230", city: "BOUIN",
    latitude: 46.973772, longitude: -1.995070, label: "Identité confirmée",
  },
  {
    name: "ô Pré d’Vous", address: "24 rue des fosses 44270 La Marne",
    siret: "89306104400028", legalName: "PH DISTRIBUTION", alias: "O PRE D'VOUS",
    officialAddress: "24 RUE DES FOSSES 44270 LA MARNE", postcode: "44270", city: "LA MARNE",
    latitude: 46.997657, longitude: -1.736921, label: "Identité confirmée",
  },
  {
    name: "CRECHE POM'DE RAINETTE ", address: "10 BIS RUE DES MARGOTINS 85300 SALLERTAINE ",
    siret: "88493583400033", legalName: "PICOTI PICOTA", alias: "POM' DE RAINETTE",
    officialAddress: "10 B RUE DES MARGOTINS 85300 SALLERTAINE", postcode: "85300", city: "SALLERTAINE",
    latitude: 46.86, longitude: -1.895, label: "Identité confirmée",
  },
];

function officialPayload(scenario) {
  if (scenario.siret === "26850025300011") return ehpadOfficial;
  const establishments = [{
    siret: scenario.siret, adresse: scenario.officialAddress, code_postal: scenario.postcode,
    libelle_commune: scenario.city, liste_enseignes: scenario.alias ? [scenario.alias] : null,
    latitude: scenario.siret === "41091808000020" ? 46.9980411897428 : scenario.latitude,
    longitude: scenario.siret === "41091808000020" ? -1.8156674543287 : scenario.longitude,
    etat_administratif: "A",
  }];
  return {
    total_results: 1, total_pages: 1, page: 1, per_page: 25,
    results: [{ siren: scenario.siret.slice(0, 9), nom_complet: scenario.legalName, matching_etablissements: establishments }],
  };
}

function pendingUntilAborted(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

test("Grist shows a single coherent site candidate and preserves the four identity cases, deadlines and selection races", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 9, 1) });
  const nodes = Object.fromEntries(["enrich-button", "enrich-status", "establishment-candidate", "proposal-panel"]
    .map(id => [id, Object.assign(new Element(id === "enrich-button" ? "button" : "div"), { id })]));
  const mappings = { NomCommercial: "Nom_usuel", Adresse: "Adresse", SirenSiret: "Numero_d_immatriculation", RaisonSociale: "Raison_sociale", Latitude: "Latitude", Longitude: "Longitude" };
  const table = {
    id: [1, 2, 3, 4], Nom_usuel: scenarios.map(item => item.name), Adresse: scenarios.map(item => item.address),
    Numero_d_immatriculation: ["", "", "", ""], Raison_sociale: ["", "", "", ""],
    Latitude: [0, 0, 0, 0], Longitude: [0, 0, 0, 0], PositionSource: ["", "", "", ""], PositionProof: ["", "", "", ""],
  };
  let onRecord;
  let current = scenarios[0];
  let mode = "normal";
  let releaseOldPosition;
  let releaseOldFiness;
  const requests = [];
  const writes = [];
  const originalDocument = globalThis.document;
  const originalGrist = globalThis.grist;
  globalThis.document = { getElementById: id => nodes[id], createElement: tag => new Element(tag) };
  globalThis.grist = {
    onRecords() {}, onNewRecord() {}, onRecord(callback) { onRecord = callback; },
    selectedTable: { async getTableId() { return "Structures_de_stage"; } },
    async setCursorPos() {},
    docApi: {
      async fetchTable(id) {
        if (id === "Structures_de_stage") return table;
        if (id === "_grist_Tables") return { id: [1], tableId: ["Structures_de_stage"] };
        return {};
      },
      async applyUserActions(actions) {
        writes.push(actions);
        for (const [, , rowId, fields] of actions) {
          for (const [field, value] of Object.entries(fields)) table[field][table.id.indexOf(rowId)] = value;
        }
      },
    },
  };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalGrist === undefined) delete globalThis.grist;
    else globalThis.grist = originalGrist;
    resetOfficialClientForTests();
  });
  t.mock.method(globalThis, "fetch", async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    requests.push({ url, signal: options.signal, body: options.body, at: Date.now() });
    if (url.pathname.endsWith("/identity-links/published.json")) return Response.json(published);
    if (url.pathname.endsWith("/identity-links/finess/850002.json")) {
      if (mode === "pending-finess") return new Promise(() => {});
      if (mode === "late-finess") return new Promise(resolve => { releaseOldFiness = () => resolve(Response.json(ehpadFiness)); });
      if (mode === "unavailable-finess") return new Response("", { status: 503 });
      return Response.json(ehpadFiness);
    }
    if (url.pathname.endsWith("/contact-indexes/indexed-departments.json")) return Response.json(manifest);
    if (url.pathname.endsWith("/all-the-places/44/44270.json")) {
      if (mode === "pending-atp") return new Promise(() => {}); // optional fetch ignores abort
      return Response.json(atpShard);
    }
    if (url.pathname.endsWith("/overture/44/44270.json")) {
      if (mode === "late-overture") return new Promise(resolve => { releaseOldPosition = () => resolve(Response.json(overtureShard)); });
      if (mode === "wrong-neighbour") return Response.json({ ...overtureShard, records: overtureShard.records.map(record => ({ ...record, siret: "12345678900011" })) });
      return Response.json(overtureShard);
    }
    if (/contact-indexes\/(all-the-places|overture)\//.test(url.pathname)) return new Response("", { status: 404 });
    if (url.hostname.startsWith("overpass")) return pendingUntilAborted(options.signal);
    if (url.hostname === "data.geopf.fr") {
      return Response.json({ features: [{ geometry: { coordinates: [current.longitude, current.latitude] }, properties: { label: current.address, postcode: current.postcode, city: current.city, score: 0.64 } }] });
    }
    assert.equal(url.hostname, "recherche-entreprises.api.gouv.fr");
    if (mode === "pending-verification" && url.searchParams.get("q") === scenarios[0].siret) return pendingUntilAborted(options.signal);
    // The unpatched UI searches Super U by text, then nearby, then awaits OSM.
    if (current === scenarios[0] && url.searchParams.get("q") !== current.siret && url.searchParams.get("q") !== current.legalName && url.pathname === "/search") {
      return Response.json({ results: [], total_results: 0, total_pages: 0, page: 1 });
    }
    return Response.json(officialPayload(current));
  });

  await import(`../establishment-enrichment-ui.js?click-regression=${Date.now()}`);

  async function select(index) {
    current = scenarios[index];
    onRecord({ id: index + 1 }, mappings);
    await settle();
    resetOfficialClientForTests();
    requests.length = 0;
  }
  function click() {
    nodes["enrich-button"].dispatchEvent(new Event("click", { cancelable: true }));
  }

  await t.test("Super U finishes with verified SIDONAM and an Overture site point without starting IGN or Overpass", async () => {
    await select(0);
    const startedAt = Date.now();
    click();
    await settle();
    // Also advance past the second Annuaire slot: the old listener is now stuck
    // on Overpass until its 12-second deadline, whereas the fixed one is done.
    t.mock.timers.tick(1800);
    await settle();
    if (nodes["enrich-button"].disabled) {
      t.mock.timers.tick(10200);
      await settle();
    }
    const uiText = nodes["establishment-candidate"].textContent;
    assert.equal(nodes["enrich-button"].disabled, false, `UI still pending: ${requests.map(item => item.url).join(" -> ")}`);
    assert.match(uiText, /Identité confirmée/);
    assert.match(uiText, /SIDONAM/);
    assert.match(uiText, /41091808000020/);
    assert.ok(Date.now() - startedAt < 12000);
    assert.equal(requests.filter(item => item.url.hostname === "recherche-entreprises.api.gouv.fr").length, 1);
    assert.equal(requests.some(item => item.url.hostname.startsWith("overpass") || item.url.hostname === "data.geopf.fr"), false);
    assert.match(uiText, /46\.99808, -1\.815576/);
    assert.doesNotMatch(uiText, /46\.996561/);
    assert.match(uiText, /Overture Places/);
    assert.match(uiText, /nom public attesté/);
    assert.equal(nodes["establishment-candidate"].querySelectorAll(".establishment-card").length, 1);
    assert.equal(nodes["establishment-candidate"].querySelectorAll('input[type="radio"]').length, 0);
    assert.equal(requests[1].url.searchParams.get("q"), "41091808000020");
    t.mock.timers.tick(12000);
    await settle();
    assert.equal(nodes["establishment-candidate"].textContent, uiText, "no late timeout may overwrite verified identity");
  });

  for (let index = 1; index < scenarios.length; index += 1) {
    await t.test(`${scenarios[index].name} keeps its sole expected SIRET`, async () => {
      await select(index);
      click();
      await settle();
      t.mock.timers.tick(1800); // fresh sector revalidation gets the next Annuaire queue slot
      await settle();
      t.mock.timers.tick(1500);
      await settle();
      assert.equal(nodes["enrich-button"].disabled, false);
      assert.match(nodes["establishment-candidate"].textContent, new RegExp(current.siret));
      assert.ok(nodes["establishment-candidate"].textContent.includes(current.label));
      assert.equal(nodes["establishment-candidate"].querySelectorAll(".establishment-card").length, 1);
      assert.equal(nodes["establishment-candidate"].querySelectorAll('input[type="radio"]').length, 0);
      for (const request of requests.filter(item => item.url.hostname.startsWith("overpass"))) {
        assert.equal(new URLSearchParams(request.body).get("data").includes(`"${current.siret}"`), true);
      }
      if (index === 2) {
        assert.match(nodes["establishment-candidate"].textContent, /46\.99756389, -1\.7365524/);
        assert.doesNotMatch(nodes["establishment-candidate"].textContent, /VIVAL/);
      } else {
        assert.match(nodes["establishment-candidate"].textContent, /Position précise du site non démontrée/);
      }
      if (index === 1) {
        const siret = nodes["proposal-panel"].querySelectorAll("input[data-identity-proposal-field]:checked:not(:disabled)")
          .find(item => item.dataset.identityProposalField === "SirenSiret");
        assert.ok(siret, "the sector proof confirms the sole EHPAD SIRET");
        assert.match(nodes["establishment-candidate"].textContent, /FINESS géographique 850002163/);
        assert.equal(nodes["establishment-candidate"].querySelector(".choice-name").textContent, "EHPAD LA REYNERIE");
        assert.match(nodes["establishment-candidate"].textContent, /Agence du Numérique en Santé/);
        assert.match(nodes["establishment-candidate"].textContent, /2026-10-02/);
        assert.ok(nodes["establishment-candidate"].querySelectorAll("a").some(link =>
          link.href === ehpadFiness.source.url && link.textContent.includes("Extraction officielle FINESS")));
        assert.doesNotMatch(nodes["establishment-candidate"].textContent, /26850025300045|89405714000010|46\.974887/);
        assert.equal(requests.filter(item => item.url.pathname.endsWith("/identity-links/finess/850002.json")).length, 1);
        assert.equal(requests.filter(item => item.url.hostname === "recherche-entreprises.api.gouv.fr").length, 1, "a fresh text response already revalidates this exact site and FINESS");
        assert.equal(requests.some(item => item.url.hostname === "data.geopf.fr"), false, "street geocoding cannot delay stronger identity proof");
        assert.equal(nodes["proposal-panel"].querySelectorAll("input[data-identity-proposal-field]").some(input => input.dataset.identityProposalField === "Coordinates"), false);
      }
    });
  }

  await t.test("an unavailable FINESS proof keeps the EHPAD probable with no automatic legal selection", async () => {
    await select(1);
    mode = "unavailable-finess";
    click();
    await settle();
    t.mock.timers.tick(1500);
    await settle();
    assert.match(nodes["establishment-candidate"].textContent, /Identité probable/);
    assert.match(nodes["establishment-candidate"].textContent, /26850025300011/);
    assert.equal(nodes["proposal-panel"].querySelectorAll("input[data-identity-proposal-field]:checked:not(:disabled)")
      .some(input => input.dataset.identityProposalField === "SirenSiret"), false);
    mode = "normal";
  });

  await t.test("a FINESS fetch ignoring abort finishes as probable without consuming the identity deadline", async () => {
    await select(1);
    mode = "pending-finess";
    click();
    await settle();
    const finessSignal = requests.find(item => item.url.pathname.endsWith("/identity-links/finess/850002.json")).signal;
    t.mock.timers.tick(8000);
    await settle();
    t.mock.timers.tick(1500);
    await settle();
    assert.equal(finessSignal.aborted, true);
    assert.equal(nodes["enrich-button"].disabled, false);
    assert.match(nodes["establishment-candidate"].textContent, /Identité probable.*26850025300011/);
    assert.doesNotMatch(nodes["enrich-status"].textContent, /délai maximal/);
    mode = "normal";
  });

  await t.test("a late FINESS proof after changing Grist selection cannot confirm the old candidate", async () => {
    await select(1);
    mode = "late-finess";
    click();
    await settle();
    const finessSignal = requests.find(item => item.url.pathname.endsWith("/identity-links/finess/850002.json")).signal;
    await select(2);
    mode = "normal";
    assert.equal(finessSignal.aborted, true);
    click();
    await settle();
    const text = nodes["establishment-candidate"].textContent;
    assert.match(text, /89306104400028/);
    releaseOldFiness();
    await settle();
    t.mock.timers.tick(4000);
    await settle();
    assert.equal(nodes["establishment-candidate"].textContent, text);
    assert.doesNotMatch(text, /26850025300011|850002163/);
  });

  await t.test("a hanging optional ATP shard cannot discard the fast Overture position or trigger Overpass", async () => {
    await select(0);
    mode = "pending-atp";
    click();
    await settle();
    t.mock.timers.tick(10000);
    await settle();
    assert.equal(nodes["enrich-button"].disabled, false);
    assert.match(nodes["establishment-candidate"].textContent, /41091808000020/);
    assert.match(nodes["establishment-candidate"].textContent, /46\.99808, -1\.815576/);
    assert.equal(requests.some(item => item.url.hostname.startsWith("overpass")), false);
    mode = "normal";
  });

  await t.test("a nearby POI carrying another SIRET cannot supply the candidate's coordinates", async () => {
    await select(0);
    mode = "wrong-neighbour";
    click();
    await settle();
    t.mock.timers.tick(1500);
    await settle();
    assert.match(nodes["establishment-candidate"].textContent, /Identité confirmée/);
    assert.match(nodes["establishment-candidate"].textContent, /41091808000020/);
    assert.match(nodes["establishment-candidate"].textContent, /Position précise du site non démontrée/);
    assert.equal(nodes["proposal-panel"].querySelectorAll("input[data-identity-proposal-field]").some(input => input.dataset.identityProposalField === "Coordinates"), false);
    mode = "normal";
  });

  await t.test("late position responses from the old Grist selection cannot cross-wire the next candidate", async () => {
    await select(0);
    mode = "late-overture";
    click();
    await settle();
    await select(2);
    mode = "normal";
    click();
    await settle();
    const text = nodes["establishment-candidate"].textContent;
    assert.match(text, /89306104400028/);
    assert.match(text, /46\.99756389, -1\.7365524/);
    releaseOldPosition();
    await settle();
    t.mock.timers.tick(10000);
    await settle();
    assert.equal(nodes["establishment-candidate"].textContent, text);
    assert.doesNotMatch(text, /41091808000020/);
  });

  await t.test("a stalled Annuaire revalidation is aborted at the global deadline without starting OSM", async () => {
    await select(0);
    mode = "pending-verification";
    click();
    await settle();
    assert.equal(requests.length, 2);
    const verificationSignal = requests[1].signal;
    t.mock.timers.tick(11999);
    await settle();
    assert.equal(nodes["enrich-button"].disabled, true);
    t.mock.timers.tick(1);
    await settle();
    assert.equal(verificationSignal.aborted, true);
    assert.equal(nodes["enrich-button"].disabled, false);
    assert.match(nodes["enrich-status"].textContent, /délai maximal/);
    assert.equal(nodes["establishment-candidate"].textContent, "");
    assert.equal(requests.length, 2, "failed verification must not launch a fallback after the deadline");
  });

  await t.test("changing Grist selection aborts the old verification and cannot overwrite the new identity", async () => {
    await select(0);
    mode = "pending-verification";
    click();
    await settle();
    const oldSignal = requests[1].signal;
    await select(2);
    mode = "normal";
    assert.equal(oldSignal.aborted, true);
    click();
    await settle();
    const uiText = nodes["establishment-candidate"].textContent;
    assert.match(uiText, /Identité confirmée/);
    assert.match(uiText, /89306104400028/);
    t.mock.timers.tick(12000);
    await settle();
    assert.equal(nodes["establishment-candidate"].textContent, uiText);
    assert.equal(nodes["enrich-button"].disabled, false);
    assert.doesNotMatch(nodes["enrich-status"].textContent, /délai maximal/);
  });
  await t.test("a concurrent edit in Grist invalidates the analysed candidate before any coordinates are written", async () => {
    await select(0);
    click();
    await settle();
    table.Numero_d_immatriculation[0] = "12345678900011";
    const errors = [];
    const errorMock = t.mock.method(console, "error", error => errors.push(error));
    nodes["proposal-panel"].querySelector("#identity-apply-proposals").dispatchEvent(new Event("click"));
    await settle();
    errorMock.mock.restore();
    assert.match(nodes["enrich-status"].textContent, /fiche a changé/);
    assert.equal(writes.length, 0);
    assert.equal(table.Latitude[0], 0);
    table.Numero_d_immatriculation[0] = "";
  });
  assert.deepEqual(writes, [], "analysis must not write to Grist");
  await t.test("the sole candidate applies its SIRET, paired coordinates and provenance in one Grist update", async () => {
    await select(0);
    click();
    await settle();
    const siret = nodes["proposal-panel"].querySelectorAll("input[data-identity-proposal-field]").find(input => input.dataset.identityProposalField === "SirenSiret");
    const coordinates = nodes["proposal-panel"].querySelectorAll("input[data-identity-proposal-field]").find(input => input.dataset.identityProposalField === "Coordinates");
    assert.equal(coordinates.checked, true);
    siret.checked = false;
    siret.dispatchEvent(new Event("change"));
    assert.equal(coordinates.disabled, true);
    siret.checked = true;
    siret.dispatchEvent(new Event("change"));
    assert.equal(coordinates.disabled, false);
    nodes["proposal-panel"].querySelector("#identity-apply-proposals").dispatchEvent(new Event("click"));
    await settle();
    assert.equal(writes.length, 1);
    const fields = writes[0][0][3];
    assert.equal(fields.Numero_d_immatriculation, "41091808000020");
    assert.equal(fields.Latitude, 46.99808);
    assert.equal(fields.Longitude, -1.815576);
    assert.match(fields.PositionSource, /Overture Places/);
    assert.equal(JSON.parse(fields.PositionProof).siret, "41091808000020");
  });
});
