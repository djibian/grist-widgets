import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

const requiredIds = [
  "search", "manual-create", "config-status", "table-counter", "table-count",
  "global-status", "local-results", "external-results", "external-status",
  "local-count", "external-count", "enrich-button", "selected-summary",
  "enrich-status", "enterprise-choices", "geocode-choices", "proposal-panel",
  "tab-search", "tab-enrich", "enrich-badge", "panel-search", "panel-enrich",
  "contact-experiment", "contact-search", "contact-current", "contact-status",
  "contact-results",
];

test("charge le socle UI commun avant la feuille locale", () => {
  const tokens = html.indexOf("../../shared/ui/tokens.css");
  const base = html.indexOf("../../shared/ui/base.css");
  const components = html.indexOf("../../shared/ui/components.css");
  const local = html.indexOf("style.css?v=1.2.0");
  assert.ok(tokens >= 0 && tokens < base && base < components && components < local);
});

test("préserve le contrat DOM des modules fonctionnels", () => {
  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `ID manquant: ${id}`);
  }
});

test("l'interface expose exactement les deux onglets principaux", () => {
  assert.match(html, /id="tab-search"[\s\S]*Rechercher \/ ajouter/);
  assert.match(html, /id="tab-enrich"[\s\S]*Compléter la sélection/);
  assert.match(html, /id="enrich-badge"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /ArrowRight/);
  assert.match(html, /ArrowLeft/);
});

test("le champ de recherche et ses résultats restent dans le même panneau", () => {
  assert.match(
    html,
    /<section id="panel-search"[\s\S]*id="search"[\s\S]*id="local-results"[\s\S]*id="external-results"[\s\S]*id="manual-create"[\s\S]*<\/section>\s*<section id="panel-enrich"/,
  );
});

test("le panneau d'enrichissement est séparé et masqué par défaut", () => {
  assert.match(html, /<section id="panel-enrich"[^>]*hidden/);
  assert.match(html, /id="selected-summary"/);
  assert.match(html, /id="enrich-button"/);
  assert.match(html, /id="proposal-panel"/);
});

test("le compteur de table utilise le pictogramme bâtiment minimaliste", () => {
  assert.match(html, /id="table-counter"/);
  assert.match(html, /class="table-counter-icon"/);
  assert.match(html, /id="table-count"/);
  assert.doesNotMatch(app, /Configuration valide/);
});

test("la terminologie visible utilise Nom usuel", () => {
  assert.match(html, /Nom usuel, raison sociale/);
  assert.match(app, /healthItem\("Nom usuel"/);
  assert.doesNotMatch(html, /Nom commercial/);
  assert.doesNotMatch(app, /Nom commercial/);
});

test("APE NAF n'est plus présenté par l'interface", () => {
  assert.doesNotMatch(app, /APE \/ NAF/);
  assert.doesNotMatch(app, /addMeta\([^\n]*"APE"/);
});

test("conserve explicitement l’expérimentation Contacts publics", () => {
  assert.match(html, /Contacts publics/);
  assert.match(html, /Expérimental/);
  assert.match(html, /src="contacts-experiment\.js"/);
  assert.match(css, /\.contact-experiment/);
  assert.match(css, /--gw-color-experimental-border/);
});

test("applique le langage Linear aux onglets et aux résultats", () => {
  assert.match(css, /\.tab-button\.active::after/);
  assert.match(css, /background: var\(--gw-color-primary\)/);
  assert.match(css, /\.result-card:hover/);
  assert.match(css, /border-top: 1px solid #f0f2f4/);
});
