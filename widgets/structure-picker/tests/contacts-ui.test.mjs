import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../contacts-experiment.js", import.meta.url), "utf8");

test("experimental contact UI stays inside the completion tab", () => {
  assert.match(html, /id="panel-enrich"[\s\S]*id="contact-experiment"[\s\S]*Contacts publics[\s\S]*Expérimental/);
  assert.match(html, /id="contact-search"/);
  assert.match(html, /src="contacts-experiment\.js"/);
});

test("experimental contact lookup uses the source adapter, canonical model and safe Grist writes", () => {
  assert.match(script, /applyEnrichmentChanges/);
  assert.match(script, /fetchFullSnapshot/);
  assert.match(script, /osmContactSource/);
  assert.match(script, /CONTACT_SOURCE\.search/);
  assert.match(script, /isExactSiretCandidate/);
  assert.match(script, /isNearbyNameCandidate/);
  assert.match(script, /candidate\.contacts/);
  assert.match(script, /candidate\.identity/);
  assert.match(script, /contactSourceSummary/);
  assert.doesNotMatch(script, /findOsmContacts/);
  assert.doesNotMatch(script, /candidate\.confidence/);
  assert.match(script, /proximité et similitude du nom/);
});
