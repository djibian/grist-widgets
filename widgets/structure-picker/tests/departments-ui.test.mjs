import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const config = await readFile(new URL("../departments-config.js", import.meta.url), "utf8");
const contextStatus = await readFile(new URL("../context-status.js", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const search = await readFile(new URL("../search.js", import.meta.url), "utf8");

test("charge la configuration des départements avant l'application", () => {
  const settings = html.indexOf("departments-config.js?v=1.0.0");
  const appScript = html.indexOf("app.js?v=1.3.1");
  assert.ok(settings >= 0 && settings < appScript);
});

test("le module monte une configuration dédiée des départements", () => {
  for (const id of [
    "department-settings-open", "department-settings", "department-selected",
    "department-search", "department-results", "department-save", "department-cancel",
  ]) assert.match(config, new RegExp(id), `ID manquant dans le module : ${id}`);
  assert.match(config, /Recherche par numéro ou nom/);
});

test("le menu Départements reste concis et reprend l'icône de paramétrage Grist Studio", () => {
  assert.match(config, /text: "Départements"/);
  assert.doesNotMatch(config, /Départements ·/);
  assert.doesNotMatch(config, /text: "⚙"/);
  assert.match(config, /gw-icon--accented/);
  assert.match(config, /class: "gw-icon-main"/);
  assert.match(config, /class: "gw-icon-accent"/);
  assert.match(config, /cx: 17\.2, cy: 6\.2, r: 2\.3/);
  assert.match(config, /cx: 7, cy: 12, r: 2\.3/);
  assert.match(config, /cx: 17\.2, cy: 17\.8, r: 2\.3/);
});

test("l'état du bandeau utilise des messages courts et des couleurs sémantiques", () => {
  assert.match(config, /import "\.\/context-status\.js"/);
  assert.match(contextStatus, /Données Grist à jour\./);
  assert.match(contextStatus, /Compléments recommandés\./);
  assert.match(contextStatus, /Champs obligatoires à mapper\./);
  assert.match(contextStatus, /Colonnes obligatoires non modifiables\./);
  assert.match(contextStatus, /Lecture Grist impossible\./);
  assert.match(contextStatus, /kind: "success"/);
  assert.match(contextStatus, /kind: "warning"/);
  assert.match(contextStatus, /kind: "error"/);
  assert.match(contextStatus, /--gw-color-success/);
});

test("la configuration utilise les options natives Grist", () => {
  assert.match(config, /grist\.onOptions/);
  assert.match(config, /grist\.setOption\(OPTION_KEY/);
  assert.match(config, /const OPTION_KEY = "departments"/);
});

test("l'Annuaire et son cache utilisent la configuration active", () => {
  assert.match(search, /getActiveDepartments/);
  assert.match(search, /departement: departments\.join\(","\)/);
  assert.match(app, /getActiveDepartments\(\)\.join\(","\)/);
  assert.match(app, /formatDepartmentCodes/);
  assert.match(app, /formatDepartmentScope/);
  assert.doesNotMatch(app, /44 et 85|Loire-Atlantique ou Vendée/);
});
