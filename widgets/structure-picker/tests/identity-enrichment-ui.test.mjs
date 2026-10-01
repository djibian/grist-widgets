import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate as settle } from "node:timers/promises";
import { resetOfficialClientForTests } from "../enterprise-client.js";

// Exercise the capture-phase listener actually loaded by index.html, rather than
// calling identity-service directly (which already passed while Grist timed out).
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
    const matches = node => selector.startsWith("#")
      ? node.id === selector.slice(1)
      : node.tagName === "input" && node.dataset.identityProposalField && node.checked && !node.disabled;
    return this.children.flatMap(child => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

const published = JSON.parse(await readFile(new URL("../identity-links/published.json", import.meta.url), "utf8"));
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
    latitude: 46.974, longitude: -1.998, label: "Identité probable",
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
  const establishments = [{
    siret: scenario.siret, adresse: scenario.officialAddress, code_postal: scenario.postcode,
    libelle_commune: scenario.city, liste_enseignes: scenario.alias ? [scenario.alias] : null,
    etat_administratif: "A",
  }];
  if (scenario.siret === "26850025300011") {
    establishments.push({
      siret: "26850025300045", adresse: "14 RUE DU PAYS DE RETZ 85230 BOUIN", code_postal: "85230",
      libelle_commune: "BOUIN", liste_enseignes: ["SOINS INFIRMIERS DOMICILE SSIDPA"], etat_administratif: "A",
    });
  }
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

test("Grist analysis click uses the published bridge before a hanging Overpass and keeps the other three cases", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 9, 1) });
  const nodes = Object.fromEntries(["enrich-button", "enrich-status", "enterprise-choices", "geocode-choices", "proposal-panel"]
    .map(id => [id, Object.assign(new Element(id === "enrich-button" ? "button" : "div"), { id })]));
  const mappings = { NomCommercial: "Nom_usuel", Adresse: "Adresse", SirenSiret: "Numero_d_immatriculation", RaisonSociale: "Raison_sociale", Latitude: "Latitude", Longitude: "Longitude" };
  const table = {
    id: [1, 2, 3, 4], Nom_usuel: scenarios.map(item => item.name), Adresse: scenarios.map(item => item.address),
    Numero_d_immatriculation: ["", "", "", ""], Raison_sociale: ["", "", "", ""],
    Latitude: [0, 0, 0, 0], Longitude: [0, 0, 0, 0],
  };
  let onRecord;
  let current = scenarios[0];
  let mode = "normal";
  const requests = [];
  const writes = [];
  const originalDocument = globalThis.document;
  const originalGrist = globalThis.grist;
  globalThis.document = { getElementById: id => nodes[id], createElement: tag => new Element(tag) };
  globalThis.grist = {
    onRecords() {}, onNewRecord() {}, onRecord(callback) { onRecord = callback; },
    selectedTable: { async getTableId() { return "Structures_de_stage"; } },
    docApi: {
      async fetchTable(id) {
        if (id === "Structures_de_stage") return table;
        if (id === "_grist_Tables") return { id: [1], tableId: ["Structures_de_stage"] };
        return {};
      },
      async applyUserActions(actions) { writes.push(actions); },
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
    requests.push({ url, signal: options.signal, at: Date.now() });
    if (url.pathname.endsWith("/identity-links/published.json")) return Response.json(published);
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

  await import(`../identity-enrichment-ui.js?click-regression=${Date.now()}`);
  let otherHandlerCalls = 0;
  nodes["enrich-button"].addEventListener("click", () => { otherHandlerCalls += 1; });

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

  await t.test("Super U finishes with verified SIDONAM without starting IGN or Overpass", async () => {
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
    const uiText = nodes["enterprise-choices"].textContent;
    assert.equal(nodes["enrich-button"].disabled, false, `UI still pending: ${requests.map(item => item.url).join(" -> ")}`);
    assert.match(uiText, /Identité confirmée/);
    assert.match(uiText, /SIDONAM/);
    assert.match(uiText, /41091808000020/);
    assert.ok(Date.now() - startedAt < 12000);
    assert.deepEqual(requests.map(item => item.url.hostname), ["", "recherche-entreprises.api.gouv.fr"]);
    assert.equal(requests[1].url.searchParams.get("q"), "41091808000020");
    assert.equal(otherHandlerCalls, 0, "the capture listener must not launch a second analysis");
    t.mock.timers.tick(12000);
    await settle();
    assert.equal(nodes["enterprise-choices"].textContent, uiText, "no late timeout may overwrite verified identity");
  });

  for (let index = 1; index < scenarios.length; index += 1) {
    await t.test(`${scenarios[index].name} keeps its sole expected SIRET`, async () => {
      await select(index);
      click();
      await settle();
      assert.equal(nodes["enrich-button"].disabled, false);
      assert.match(nodes["enterprise-choices"].textContent, new RegExp(current.siret));
      assert.ok(nodes["enterprise-choices"].textContent.includes(current.label));
      assert.equal(requests.some(item => item.url.hostname.startsWith("overpass")), false);
      if (index === 1) {
        const siret = nodes["proposal-panel"].querySelectorAll("input[data-identity-proposal-field]:checked:not(:disabled)")
          .find(item => item.dataset.identityProposalField === "SirenSiret");
        assert.equal(siret, undefined, "EHPAD remains probable, without an automatic legal-field selection");
      }
    });
  }

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
    assert.equal(nodes["enterprise-choices"].textContent, "");
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
    const uiText = nodes["enterprise-choices"].textContent;
    assert.match(uiText, /Identité confirmée/);
    assert.match(uiText, /89306104400028/);
    t.mock.timers.tick(12000);
    await settle();
    assert.equal(nodes["enterprise-choices"].textContent, uiText);
    assert.equal(nodes["enrich-button"].disabled, false);
    assert.doesNotMatch(nodes["enrich-status"].textContent, /délai maximal/);
  });
  assert.deepEqual(writes, [], "analysis must not write to Grist");
});
