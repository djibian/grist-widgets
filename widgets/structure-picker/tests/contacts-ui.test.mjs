import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../contacts-experiment.js", import.meta.url), "utf8");

test("contact UI uses a dedicated left-search right-results workflow", () => {
  assert.match(html, /id="panel-enrich"[\s\S]*id="contact-experiment"[\s\S]*Contacts publics[\s\S]*Expérimental/);
  assert.match(html, /class="gw-work-grid gw-work-grid--balanced contact-work-grid"/);
  assert.match(html, /03 · Rechercher[\s\S]*id="contact-search"[\s\S]*04 · Vérifier[\s\S]*id="contact-results"/);
  assert.match(html, /id="contact-apply"/);
  assert.doesNotMatch(html, /id="contact-sources"/);
  assert.match(html, /Un seul meilleur résultat par champ/);
  assert.match(html, /src="contacts-experiment\.js\?v=1\.2\.0"/);
});

test("contact lookup keeps safe Grist writes and delegates concise trusted selection", () => {
  assert.match(script, /applyEnrichmentChanges/);
  assert.match(script, /fetchFullSnapshot/);
  assert.match(script, /availableContactSources/);
  assert.match(script, /searchContactSources/);
  assert.match(script, /selectContactSuggestions/);
  assert.match(script, /isExactSiretCandidate/);
  assert.match(script, /contact-provenance-badge/);
  assert.doesNotMatch(script, /renderSourceStates/);
  assert.doesNotMatch(script, /contact-source-state/);
  assert.doesNotMatch(script, /candidate\.confidence/);
});
