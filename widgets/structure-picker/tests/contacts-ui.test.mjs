import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../contacts-experiment.js", import.meta.url), "utf8");

test("experimental contact UI stays inside the completion tab and exposes source status", () => {
  assert.match(html, /id="panel-enrich"[\s\S]*id="contact-experiment"[\s\S]*Contacts publics[\s\S]*Expérimental/);
  assert.match(html, /id="contact-search"/);
  assert.match(html, /id="contact-sources"/);
  assert.match(html, /Croise les sources publiques disponibles/);
  assert.match(html, /Rechercher les contacts/);
  assert.match(html, /src="contacts-experiment\.js\?v=1\.1\.0"/);
});

test("contact lookup resolves multi-source canonical candidates before safe Grist writes", () => {
  assert.match(script, /applyEnrichmentChanges/);
  assert.match(script, /fetchFullSnapshot/);
  assert.match(script, /availableContactSources/);
  assert.match(script, /searchContactSources/);
  assert.match(script, /resolveContactCandidates/);
  assert.match(script, /contactConfidence/);
  assert.match(script, /CONTACT_CONFIDENCE/);
  assert.match(script, /isExactSiretCandidate/);
  assert.match(script, /candidate\.contacts/);
  assert.match(script, /candidate\.identity/);
  assert.match(script, /contactSourceSummary/);
  assert.match(script, /contact-source-state/);
  assert.match(script, /contact-provenance-badge/);
  assert.doesNotMatch(script, /osmContactSource/);
  assert.doesNotMatch(script, /findOsmContacts/);
  assert.doesNotMatch(script, /candidate\.confidence/);
});
