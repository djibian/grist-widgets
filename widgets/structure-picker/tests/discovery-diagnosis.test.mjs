import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseDiscovery, skipDiscoveryQuestion } from "../discovery-diagnosis.js";
import { emptyDiscoveryProgress, mergeDiscoveryProgress } from "../discovery-progress.js";
import { chooseDiscoveryGuidance, correctDiscoveryGuidance, emptyDiscoveryGuidance } from "../discovery-guidance.js";
import { planIdentityExpansion } from "../identity-expansion.js";
import { resolveStructureIdentity } from "../identity-orchestrator.js";

function site({ name = "Les Petits Loups", street = "1 rue du Parc", code = "44000",
  city = "Nantes", siren = "123456789", nic = "00012", operator = "Association Arc" } = {}) {
  return { nomCommercial: name, raisonSociale: operator, siren, siret: siren + nic,
    adresse: street + " " + code + " " + city, commune: city, codePostal: code,
    etatAdministratif: "A", aliases: [], latitude: null, longitude: null };
}
function progress(...sites) {
  return mergeDiscoveryProgress(emptyDiscoveryProgress(), { candidates: sites });
}
function official(items) {
  return { items, coverage: { complete: true, hasNextPage: false } };
}
test("A: ambiguous homonyms ask for commune and answer generates an actual new Annuaire request", async () => {
  const nantes = site(), angers = site({ code: "49000", city: "Angers", nic: "00020" });
  const row = { NomCommercial: "Les Petits Loups", Adresse: "", SirenSiret: "" };
  const guidance = emptyDiscoveryGuidance();
  const diagnosis = diagnoseDiscovery({ reference: row, progress: progress(nantes, angers), guidance, searching: true });
  assert.equal(diagnosis.blocker, "ambiguous-sites");
  assert.equal(diagnosis.question.field, "commune");
  const selected = diagnosis.question.options.find(x => x.label === "Angers");
  assert.ok(selected);
  assert.equal(chooseDiscoveryGuidance(guidance, selected.candidate, selected.field), true);
  const requests = [];
  await resolveStructureIdentity({
    row, guidance, deepening: true, geocode: async () => [], maxOfficialRequests: 8,
    maxPaginationPages: 0,
    fetchOfficial: async req => {
      requests.push(req);
      return official(req.query?.includes("angers") ? [angers] : []);
    },
  });
  assert.ok(requests.some(req => req.kind === "text" && req.query.includes("angers")),
    "user response must actually change HTTP lookup, not only UI sort");
  assert.equal(diagnoseDiscovery({ reference: row, progress: progress(nantes, angers), guidance }).question?.field, "address",
    "after a commune answer, a different uncertainty can become the next question");
});

test("B: contradictory address offers a correction and triggers geographic discovery without site certification", async () => {
  const target = site({ street: "9 rue du Parc", code: "49000", city: "Angers" });
  const row = { NomCommercial: "Les Petits Loups", Adresse: "5 rue des Érables 44000 Nantes", SirenSiret: "" };
  const guidance = emptyDiscoveryGuidance();
  const diagnosis = diagnoseDiscovery({ reference: row, progress: progress(target), guidance, searching: false });
  assert.equal(diagnosis.blocker, "conflicting-address");
  assert.equal(diagnosis.question.field, "address");
  const chosen = diagnosis.question.options[0];
  assert.equal(chooseDiscoveryGuidance(guidance, chosen.candidate, chosen.field), true);
  const geocoded = [], calls = [];
  const result = await resolveStructureIdentity({
    row, guidance, deepening: true, maxOfficialRequests: 8,
    geocode: async address => {
      geocoded.push(address);
      return [{ latitude: 47.47, longitude: -0.55 }];
    },
    fetchOfficial: async req => {
      calls.push(req);
      return official(req.kind === "nearby" ? [target] : []);
    },
  });
  assert.ok(geocoded.includes(target.adresse));
  assert.ok(calls.some(req => req.kind === "nearby"), "corrected address redirects official proximity lookup");
  assert.equal(result.selectedGeocode, null, "human correction never validates a site position");
  assert.equal(row.Adresse, "5 rue des Érables 44000 Nantes");
});

test("C: sibling sites from same manager ask for the internship site, not a SIREN attribution", () => {
  const a = site(), b = site({ street: "29 boulevard des Tilleuls", code: "44000", city: "Nantes", nic: "00020" });
  const row = { NomCommercial: "Les Petits Loups", Adresse: "", SirenSiret: "123456789" };
  const guidance = emptyDiscoveryGuidance();
  chooseDiscoveryGuidance(guidance, a, "operator");
  const question = diagnoseDiscovery({ reference: row, progress: progress(a, b), guidance }).question;
  assert.equal(question.kind, "operator-sites");
  assert.equal(question.field, "address");
  assert.equal(question.options.length, 2);
  const selected = question.options.find(x => x.label.includes("29 boulevard"));
  chooseDiscoveryGuidance(guidance, selected.candidate, selected.field);
  const planned = planIdentityExpansion(row, { guidance });
  assert.ok(planned.some(q => q.reason === "address-postcode" && q.request.query?.includes("boulevard")),
    "chosen site is searched by address instead of borrowing the manager's SIRET");
});

test("D: 'Je ne sais pas' suppresses only the same question and retains other opportunities", () => {
  const row = { NomCommercial: "Les Petits Loups", Adresse: "", SirenSiret: "" };
  const guidance = emptyDiscoveryGuidance();
  const p = progress(site(), site({ code: "49000", city: "Angers", nic: "00020" }));
  const initial = diagnoseDiscovery({ reference: row, progress: p, guidance }).question;
  assert.equal(initial.kind, "homonyms");
  assert.equal(skipDiscoveryQuestion(guidance, initial.id), true);
  assert.equal(skipDiscoveryQuestion(guidance, initial.id), false);
  assert.notEqual(diagnoseDiscovery({ reference: row, progress: p, guidance }).question?.id, initial.id);
  assert.deepEqual(guidance.selected, [], "ignorance is not treated as a confirmed choice");
});

test("E: answer at a live checkpoint changes subsequent official requests", async () => {
  const first = site(), second = site({ code: "49000", city: "Angers", nic: "00020" });
  const row = { NomCommercial: "Les Petits Loups", Adresse: "", SirenSiret: "" };
  const guidance = emptyDiscoveryGuidance();
  const calls = [];
  let questionChosen = false;
  await resolveStructureIdentity({
    row, guidance, deepening: true, maxOfficialRequests: 8, maxPaginationPages: 0,
    geocode: async () => [],
    fetchOfficial: async req => {
      calls.push(req);
      return official(calls.length === 1 ? [first, second] : []);
    },
    onProgress: checkpoint => {
      if (questionChosen) return;
      const question = diagnoseDiscovery({
        reference: row, progress: progress(...checkpoint.candidates), guidance, decision: checkpoint.decision, searching: true,
      }).question;
      assert.equal(question?.field, "commune");
      const answer = question.options.find(o => o.label === "Angers");
      chooseDiscoveryGuidance(guidance, answer.candidate, answer.field);
      questionChosen = true;
    },
  });
  assert.ok(questionChosen);
  assert.ok(calls.some(c => c.query?.includes("angers")), "in-flight replan must execute the new query");
});

test("F/H: source failure is not an address contradiction, easy cases ask nothing", () => {
  const row = { NomCommercial: "Les Petits Loups", Adresse: "1 rue du Parc 44000 Nantes" };
  const p = { candidates: [], activity: [{ source: "annuaire:text", state: "timeout" }] };
  const failed = diagnoseDiscovery({ reference: row, progress: p, searching: true });
  assert.equal(failed.blocker, "sources-unavailable");
  assert.equal(failed.question, null);
  assert.equal(diagnoseDiscovery({ reference: row, progress: progress(site()),
    decision: { status: "MATCH_VERIFIED" } }).question, null);
});

test("two successive corrections preserve hypotheses while creating different lookup families", () => {
  const row = { NomCommercial: "Les Petits Loups", Adresse: "", SirenSiret: "" };
  const a = site(), b = site({ city: "Angers", code: "49000", nic: "00020", street: "14 rue des Pins" });
  const guidance = emptyDiscoveryGuidance();
  const first = diagnoseDiscovery({ reference: row, progress: progress(a, b), guidance }).question;
  const answer = first.options.find(x => x.label === "Angers");
  chooseDiscoveryGuidance(guidance, answer.candidate, answer.field);
  const second = diagnoseDiscovery({ reference: row, progress: progress(b), guidance }).question;
  assert.equal(second?.field, "address", "new evidence can reveal a new address contradiction");
  correctDiscoveryGuidance(guidance, b, "address", "14 rue des Pins 49000 Angers");
  const urls = planIdentityExpansion(row, { guidance }).map(x => x.request.url);
  assert.ok(urls.some(url => /angers/i.test(decodeURIComponent(url))));
  assert.ok(urls.some(url => /pins/i.test(decodeURIComponent(url))));
  assert.equal(guidance.selected.length, 2);
  assert.equal(b.adresse, "14 rue des Pins 49000 Angers", "official observation is not rewritten");
});
