import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("l'interface expose exactement les deux onglets principaux", () => {
  assert.match(html, /id="tab-search"[\s\S]*Rechercher \/ ajouter/);
  assert.match(html, /id="tab-enrich"[\s\S]*Compléter la sélection/);
  assert.match(html, /id="enrich-badge"/);
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
