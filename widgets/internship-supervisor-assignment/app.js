import { analyzeClass, AssignmentError, classOptions, generatePlan } from "./assignment.js";
import { applyPlan, configurationProblems, fetchSnapshot, initializeGrist } from "./grist.js";

const $ = selector => document.querySelector(selector);
const el = {
  status: $("#config-status"), refresh: $("#refresh"), classSelect: $("#class-select"), periods: $("#periods"),
  diversity: $("#criterion-diversity"), priority: $("#priority-diversity"), analysis: $("#analysis"),
  generate: $("#generate"), card: $("#proposal-card"), summary: $("#proposal-summary"),
  details: $("#proposal-details"), quotas: $("#quota-details"), apply: $("#apply"),
};
const state = { snapshot: null, plan: null, busy: false };

function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function status(message, kind) { el.status.textContent = message; el.status.className = "status " + (kind || "pending"); }
function classId() { const n = Number(el.classSelect.value); return Number.isInteger(n) && n > 0 ? n : null; }
function periods() { return [...el.periods.querySelectorAll("input:checked")].map(node => Number(node.value)).sort((a,b) => a-b); }
function invalidate() { state.plan = null; el.card.hidden = true; }
function metric(value, label) { return '<div class="metric"><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span></div>'; }

function renderClasses(preferred) {
  const rows = classOptions(state.snapshot);
  el.classSelect.replaceChildren();
  for (const row of rows) {
    const option = document.createElement("option"); option.value = String(row.id); option.textContent = row.label; el.classSelect.append(option);
  }
  el.classSelect.disabled = !rows.length;
  if (rows.length) el.classSelect.value = String(rows.some(row => row.id === preferred) ? preferred : rows[0].id);
}

function renderPeriods(preferred) {
  el.periods.replaceChildren();
  const row = classOptions(state.snapshot).find(item => item.id === classId());
  if (!row || !row.periods.length) { el.periods.textContent = "Aucune période valide pour cette classe."; return; }
  const keep = preferred ? new Set(preferred) : null;
  for (const period of row.periods) {
    const label = document.createElement("label"); label.className = "period-option";
    const input = document.createElement("input"); input.type = "checkbox"; input.value = String(period); input.checked = keep ? keep.has(period) : true;
    input.addEventListener("change", () => { invalidate(); renderAnalysis(); });
    label.append(input, document.createTextNode("P" + period)); el.periods.append(label);
  }
}

function renderAnalysis() {
  el.generate.disabled = true;
  if (!state.snapshot) { el.analysis.textContent = "Chargement des données…"; return; }
  const config = configurationProblems(state.snapshot);
  if (config.length) { el.analysis.innerHTML = '<ul class="issues">' + config.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>"; return; }
  const cid = classId();
  if (!cid) { el.analysis.textContent = "Aucune classe à traiter."; return; }
  const a = analyzeClass(state.snapshot, cid, periods());
  const p = a.periods.length ? a.periods.map(x => "P" + x).join(", ") : "—";
  let html = '<div class="analysis-grid">' + metric(p,"Périodes") + metric(a.selectedStageCount || 0,"Stages concernés") + metric(a.existingSelectedCount || 0,"Déjà affectés") + metric(a.unassignedSelectedCount || 0,"À affecter") + "</div>";
  if (a.errors.length) html += '<ul class="issues">' + a.errors.map(x => "<li>" + esc(x.message) + "</li>").join("") + "</ul>";
  else { html += '<div class="success-line">✓ Données cohérentes : la proposition peut être calculée.</div>'; el.generate.disabled = state.busy; }
  el.analysis.innerHTML = html;
}

function renderPlan(plan) {
  state.plan = plan; el.card.hidden = false;
  const repeat = plan.metrics.newCount ? (plan.metrics.diversifiedAssignments + "/" + plan.metrics.newCount + " affectation(s) sans répétition enseignant–élève.") : "Aucune nouvelle affectation.";
  el.summary.innerHTML = '<div class="summary-line"><strong>✓ Tous les quotas sélectionnés sont respectés.</strong></div>' +
    '<div class="summary-line">' + plan.metrics.newCount + " nouvelle(s) affectation(s), " + plan.metrics.existingCount + " déjà existante(s).</div>" +
    '<div class="summary-line">' + esc(repeat) + (plan.metrics.introducedRepeats ? " " + plan.metrics.introducedRepeats + " répétition(s) restent nécessaires." : "") + "</div>";
  el.details.innerHTML = plan.assignments.map(row => "<tr><td>P" + row.period + "</td><td>" + esc(row.studentLabel) + "</td><td>" + esc(row.teacherLabel) + "</td></tr>").join("") || '<tr><td colspan="3">Aucune nouvelle affectation.</td></tr>';
  el.quotas.innerHTML = plan.summary.map(row => "<tr><td>P" + row.period + "</td><td>" + esc(row.teacherLabel) + "</td><td>" + row.target + "</td><td>" + row.existing + "</td><td>" + row.proposed + "</td><td><strong>" + row.total + "</strong></td></tr>").join("");
  el.apply.disabled = !plan.assignments.length || state.busy;
  el.apply.textContent = plan.assignments.length ? "Appliquer les " + plan.assignments.length + " affectation(s)" : "Rien à appliquer";
}

async function refresh(preserve = true, announce = true) {
  const oldClass = preserve ? classId() : null; const oldPeriods = preserve ? periods() : null;
  state.busy = true; el.refresh.disabled = true; if (announce) status("Actualisation des données Grist…","pending");
  try {
    state.snapshot = await fetchSnapshot(); renderClasses(oldClass); renderPeriods(oldClass === classId() ? oldPeriods : null);
    const problems = configurationProblems(state.snapshot); status(problems.length ? problems.join(" ") : "Données Grist chargées.", problems.length ? "error" : "ok");
  } catch (error) { state.snapshot = null; status(error.message || "Impossible de lire les données Grist.","error"); }
  finally { state.busy = false; el.refresh.disabled = false; renderAnalysis(); }
}

async function generate() {
  const cid = classId(), selected = periods(); invalidate(); state.busy = true; renderAnalysis(); status("Vérification et calcul…","pending");
  try {
    state.snapshot = await fetchSnapshot(); const problems = configurationProblems(state.snapshot); if (problems.length) throw new Error(problems.join(" "));
    const plan = generatePlan(state.snapshot,{ classId: cid, periods: selected, criteria: { diversity: { enabled: el.diversity.checked, priority: el.priority.value } } });
    status("Proposition calculée. Aucune donnée Grist n'a encore été modifiée.","ok"); renderPlan(plan);
  } catch (error) {
    status(error.message || "Le calcul a échoué.","error");
    if (error instanceof AssignmentError && error.issues.length) el.analysis.innerHTML = '<ul class="issues">' + error.issues.map(x => "<li>" + esc(x.message) + "</li>").join("") + "</ul>";
  } finally { state.busy = false; renderAnalysis(); }
}

async function apply() {
  if (!state.plan?.assignments?.length) return;
  const count = state.plan.assignments.length; state.busy = true; el.apply.disabled = true; status("Application des affectations…","pending");
  try { state.snapshot = await applyPlan(state.plan); invalidate(); status(count + " affectation(s) appliquée(s).","ok"); }
  catch (error) { status(error.message || "L'application a échoué.","error"); }
  finally { state.busy = false; renderAnalysis(); }
}

el.classSelect.addEventListener("change",() => { invalidate(); renderPeriods(); renderAnalysis(); });
el.diversity.addEventListener("change",() => { el.priority.disabled = !el.diversity.checked; invalidate(); });
el.priority.addEventListener("change",invalidate);
el.refresh.addEventListener("click",async () => { invalidate(); await refresh(true,true); });
el.generate.addEventListener("click",generate); el.apply.addEventListener("click",apply);

initializeGrist();
await refresh(false,false);
