import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
const contactsCss = await readFile(new URL("../contacts-layout.css", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const structureCss = await readFile(new URL("../../../shared/ui/structure.css", import.meta.url), "utf8");

const requiredIds = [
  "search", "manual-create", "config-status", "table-counter", "table-count",
  "global-status", "local-results", "external-results", "external-status",
  "local-count", "external-count", "enrich-button", "selected-summary",
  "enrich-status", "enterprise-choices", "geocode-choices", "proposal-panel",
  "tab-search", "tab-enrich", "enrich-badge", "panel-search", "panel-enrich",
  "contact-experiment", "contact-search", "contact-current", "contact-status",
  "contact-results", "contact-apply",
];

test("charge le socle Grist Studio complet avant les feuilles locales", () => {
  const tokens = html.indexOf("../../shared/ui/tokens.css");
  const base = html.indexOf("../../shared/ui/base.css");
  const components = html.indexOf("../../shared/ui/components.css");
  const structure = html.indexOf("../../shared/ui/structure.css");
  const local = html.indexOf("style.css?v=");
  const contacts = html.indexOf("contacts-layout.css?v=");
  assert.ok(tokens >= 0 && tokens < base && base < components && components < structure && structure < local && local < contacts);
  assert.doesNotMatch(html, /studio\.css/);
});

test("préserve le contrat DOM des modules fonctionnels", () => {
  for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), `ID manquant: ${id}`);
});

test("conserve exactement les deux modes principaux", () => {
  assert.match(html, /id="tab-search"[\s\S]*Rechercher \/ ajouter/);
  assert.match(html, /id="tab-enrich"[\s\S]*Compléter la sélection/);
  assert.match(html, /id="enrich-badge"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /ArrowRight/);
  assert.match(html, /ArrowLeft/);
});

test("compose le mode recherche en travail puis décision avec une grille équilibrée", () => {
  assert.match(html, /<section id="panel-search"[\s\S]*class="gw-work-grid gw-work-grid--balanced search-work-grid"/);
  assert.match(html, /01 · Rechercher/);
  assert.match(html, /02 · Vérifier \/ ajouter/);
  assert.match(html, /id="search"[\s\S]*id="local-results"[\s\S]*id="external-results"[\s\S]*id="manual-create"/);
});

test("compose l'enrichissement avec davantage de largeur pour la vérification", () => {
  assert.match(html, /<section id="panel-enrich"[^>]*hidden/);
  assert.match(html, /class="gw-work-grid gw-work-grid--decision-wide enrich-work-grid"/);
  assert.match(html, /01 · Examiner/);
  assert.match(html, /02 · Vérifier/);
  assert.match(html, /class="gw-decision-panel enrich-decision"/);
  assert.match(html, /id="selected-summary"/);
  assert.match(html, /id="proposal-panel"/);
});

test("compose Contacts publics dans une seconde grille équilibrée recherche puis résultats", () => {
  assert.match(html, /id="contact-experiment"[\s\S]*class="gw-work-grid gw-work-grid--balanced contact-work-grid"/);
  assert.match(html, /03 · Rechercher[\s\S]*id="contact-search"/);
  assert.match(html, /04 · Vérifier[\s\S]*id="contact-results"[\s\S]*id="contact-apply"/);
  assert.doesNotMatch(html, /id="contact-sources"/);
  assert.match(contactsCss, /\.contact-result-row/);
  assert.match(contactsCss, /\.contact-confidence\.exact/);
  assert.match(contactsCss, /\.contact-confidence\.probable/);
  assert.doesNotMatch(contactsCss, /contact-source-state/);
});

test("utilise un cadre fluide et des variantes qui se replient selon la largeur du widget", () => {
  assert.match(structureCss, /\.gw-widget-frame[\s\S]*width: calc\(100% - 32px\)[\s\S]*max-width: none[\s\S]*container-name: gw-widget/);
  assert.match(structureCss, /\.gw-work-grid--balanced \{ grid-template-columns: minmax\(0, 1fr\) minmax\(320px, 1fr\); \}/);
  assert.match(structureCss, /\.gw-work-grid--decision-wide \{ grid-template-columns: minmax\(300px, \.72fr\) minmax\(0, 1\.28fr\); \}/);
  assert.match(structureCss, /@container gw-widget \(max-width: 860px\)[\s\S]*\.gw-work-grid--balanced,[\s\S]*\.gw-work-grid--decision-wide \{ grid-template-columns: 1fr; \}/);
  assert.doesNotMatch(structureCss, /920px/);
});

test("utilise une seule feuille locale historique et le contrat couleur définitif", () => {
  assert.match(css, /\.app\.gw-widget-frame \{ margin: 0 auto 32px; padding: 0; \}/);
  assert.match(css, /\.app-kicker[\s\S]*color: var\(--gw-color-workflow\)/);
  assert.match(css, /\.tab-button\.active::after[\s\S]*background: var\(--gw-color-workflow\)/);
  assert.match(css, /\.tab-badge[\s\S]*background: var\(--gw-color-warning\)/);
  assert.doesNotMatch(css, /gw-color-organization|gw-color-geography/);
});

test("le compteur de table conserve le pictogramme bâtiment", () => {
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
  assert.match(html, /src="contacts-experiment\.js(?:\?[^\"]*)?"/);
  assert.match(contactsCss, /\.contact-experiment/);
  assert.match(contactsCss, /\.contact-provenance-badge/);
});

test("applique la composition Grist Studio sans supprimer les composants métier", () => {
  assert.match(html, /class="gw-context-strip"/);
  assert.match(html, /class="mode-switch"/);
  assert.match(css, /\.search-work-grid/);
  assert.match(css, /\.enrich-work-grid/);
  assert.match(css, /\.result-card:hover/);
  assert.match(css, /\.proposal-row/);
});
