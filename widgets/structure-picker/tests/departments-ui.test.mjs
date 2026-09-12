import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const config = await readFile(new URL("../departments-config.js", import.meta.url), "utf8");
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
