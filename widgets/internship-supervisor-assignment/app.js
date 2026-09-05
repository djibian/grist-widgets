import {
  analyzeClass,
  AssignmentError,
  generatePlan,
  periodsForClass,
} from "./assignment.js";
import {
  applyPlan,
  configurationProblems,
  createMissingStages,
  fetchSnapshot,
  initializeGrist,
  loadConfiguration,
  saveConfiguration,
} from "./grist.js";
import {
  inferMappings,
  mappingGroups,
  mappingSignature,
  validateMappings,
} from "./mapping.js";

const $ = selector => document.querySelector(selector);
const el = {
  status: $("#config-status"),
  refresh: $("#refresh"),
  settingsToggle: $("#settings-toggle"),
  settingsPanel: $("#settings-panel"),
  settingsBackdrop: $("#settings-backdrop"),
  settingsClose: $("#settings-close"),
  settingsSave: $("#settings-save"),
  mappingAuto: $("#mapping-auto"),
  mappingFields: $("#mapping-fields"),
  mappingStatus: $("#mapping-status"),
  diversity: $("#criterion-diversity"),
  priority: $("#priority-diversity"),
  className: $("#class-name"),
  periods: $("#periods"),
  analysis: $("#analysis"),
  stageCreation: $("#stage-creation"),
  stageCreationTitle: $("#stage-creation-title"),
  createStages: $("#create-stages"),
  generate: $("#generate"),
  proposalCard: $("#proposal-card"),
  proposalPeriods: $("#proposal-periods"),
  proposalSummary: $("#proposal-summary"),
  proposalDetails: $("#proposal-details"),
  quotaDetails: $("#quota-details"),
  apply: $("#apply"),
};

const state = {
  snapshot: null,
  metadata: null,
  mappings: {},
  optimization: { diversity: { enabled: true, priority: "moyenne" } },
  selectedClassId: null,
  plan: null,
  busy: false,
  configurationLoaded: false,
  refreshSerial: 0,
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function status(message, kind = "pending") {
  el.status.textContent = message;
  el.status.className = `status ${kind}`;
}

function selectedClass() {
  return state.snapshot?.classes?.find(row => row.id === state.selectedClassId) ?? null;
}

function selectedPeriods() {
  return [...el.periods.querySelectorAll("input:checked")]
    .map(node => Number(node.value))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

function invalidatePlan() {
  state.plan = null;
  el.proposalCard.hidden = true;
}

function metric(value, label) {
  return `<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
}

function currentConfigurationProblems() {
  return state.snapshot ? configurationProblems(state.snapshot) : [];
}

function setBusy(busy) {
  state.busy = busy;
  el.refresh.disabled = busy;
  el.settingsSave.disabled = busy;
  renderAnalysis();
}

function renderPeriods(preferred = null) {
  el.periods.replaceChildren();
  const cls = selectedClass();
  if (!cls) {
    el.periods.textContent = "—";
    return;
  }
  const available = periodsForClass(cls);
  if (!available.length) {
    el.periods.textContent = "Aucune période valide";
    return;
  }

  const preferredSet = preferred ? new Set(preferred) : null;
  for (const period of available) {
    const label = document.createElement("label");
    label.className = "period-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(period);
    input.checked = preferredSet ? preferredSet.has(period) : true;
    input.addEventListener("change", () => {
      invalidatePlan();
      renderAnalysis();
    });
    label.append(input, document.createTextNode(`P${period}`));
    el.periods.append(label);
  }
}

function renderScope(preferredPeriods = null) {
  const cls = selectedClass();
  el.className.textContent = cls?.label ?? (state.selectedClassId ? `Classe #${state.selectedClassId}` : "—");
  renderPeriods(preferredPeriods);
}

function renderAnalysis() {
  el.generate.disabled = true;
  el.stageCreation.hidden = true;
  el.createStages.disabled = true;

  if (!state.snapshot) {
    el.analysis.className = "analysis empty";
    el.analysis.textContent = "Chargement des données…";
    return;
  }

  const configProblems = currentConfigurationProblems();
  el.settingsToggle.classList.toggle("attention", configProblems.some(message => message.includes("colonne") || message.includes("référence")));
  if (configProblems.length) {
    el.analysis.className = "analysis";
    el.analysis.innerHTML = `<ul class="issues">${configProblems.map(message => `<li>${esc(message)}</li>`).join("")}</ul>`;
    return;
  }

  const cls = selectedClass();
  if (!state.selectedClassId || !cls) {
    el.analysis.className = "analysis empty";
    el.analysis.textContent = "Sélectionne une classe dans la vue Classe. Le widget suivra automatiquement cette sélection.";
    return;
  }

  const periods = selectedPeriods();
  const analysis = analyzeClass(state.snapshot, cls.id, periods);
  const nonMissingErrors = analysis.errors.filter(row => row.code !== "MISSING_STAGES");
  const periodText = analysis.periods.length ? analysis.periods.map(period => `P${period}`).join(", ") : "—";

  let html = '<div class="analysis-grid">'
    + metric(analysis.students?.length ?? 0, "Élèves")
    + metric(analysis.expectedCount ?? 0, "Stages attendus")
    + metric(analysis.presentCount ?? 0, "Stages présents")
    + metric(analysis.missingCount ?? 0, "Stages manquants")
    + "</div>";

  html += `<div class="control-line"><strong>${esc(periodText)}</strong> : ${analysis.existingSelectedCount ?? 0} déjà affecté(s), ${analysis.unassignedSelectedCount ?? 0} présent(s) sans enseignant.</div>`;

  if (nonMissingErrors.length) {
    html += `<ul class="issues">${nonMissingErrors.map(row => `<li>${esc(row.message)}</li>`).join("")}</ul>`;
  }

  if (!analysis.errors.length) {
    html += '<div class="success-line">✓ Stages présents et quotas cohérents : la répartition peut être calculée.</div>';
    el.generate.disabled = state.busy;
  }
  el.analysis.className = "analysis";
  el.analysis.innerHTML = html;

  if ((analysis.missingCount ?? 0) > 0) {
    el.stageCreation.hidden = false;
    el.stageCreationTitle.textContent = `${analysis.missingCount} stage(s) manquant(s) sur ${analysis.expectedCount} attendu(s)`;
    el.createStages.textContent = `Créer les ${analysis.missingCount} stage(s) manquant(s)`;
    const coverageErrors = analysis.errors.filter(row => row.code !== "MISSING_STAGES" && row.code !== "QUOTA_TOTAL_MISMATCH" && row.code !== "DUPLICATE_QUOTA" && row.code !== "INVALID_QUOTA_TARGET" && row.code !== "INVALID_QUOTA_TEACHER" && row.code !== "EXISTING_ASSIGNMENT_NOT_ALLOWED" && row.code !== "EXISTING_ASSIGNMENT_OVER_QUOTA");
    el.createStages.disabled = state.busy || coverageErrors.length > 0;
  }
}

function renderPlan(plan) {
  state.plan = plan;
  el.proposalCard.hidden = false;
  el.proposalPeriods.textContent = plan.periods.map(period => `P${period}`).join(", ");

  const diversityLine = plan.metrics.newCount
    ? `${plan.metrics.diversifiedAssignments}/${plan.metrics.newCount} nouvelle(s) affectation(s) sans répétition enseignant–élève.`
    : "Aucune nouvelle affectation nécessaire.";
  el.proposalSummary.innerHTML = [
    '<div class="summary-line"><strong>✓ Tous les quotas sélectionnés sont respectés.</strong></div>',
    `<div class="summary-line">${plan.metrics.newCount} nouvelle(s) affectation(s), ${plan.metrics.existingCount} déjà existante(s).</div>`,
    `<div class="summary-line">${esc(diversityLine)}${plan.metrics.introducedRepeats ? ` ${plan.metrics.introducedRepeats} répétition(s) restent nécessaires.` : ""}</div>`,
  ].join("");

  el.proposalDetails.innerHTML = plan.assignments.map(row => (
    `<tr><td>P${row.period}</td><td>${esc(row.studentLabel)}</td><td>${esc(row.teacherLabel)}</td></tr>`
  )).join("") || '<tr><td colspan="3">Aucune nouvelle affectation.</td></tr>';

  el.quotaDetails.innerHTML = plan.summary.map(row => (
    `<tr><td>P${row.period}</td><td>${esc(row.teacherLabel)}</td><td>${row.target}</td><td>${row.existing}</td><td>${row.proposed}</td><td><strong>${row.total}</strong></td></tr>`
  )).join("");

  el.apply.disabled = !plan.assignments.length || state.busy;
  el.apply.textContent = plan.assignments.length
    ? `Appliquer les ${plan.assignments.length} affectation(s)`
    : "Rien à appliquer";
}

function columnOptionLabel(column) {
  return column.label === column.colId ? column.colId : `${column.label} · ${column.colId}`;
}

function renderMappingFields(mappings = state.mappings) {
  el.mappingFields.replaceChildren();
  for (const group of mappingGroups()) {
    const wrapper = document.createElement("section");
    wrapper.className = "mapping-group";
    const heading = document.createElement("h4");
    heading.textContent = group.table;
    wrapper.append(heading);

    const columns = state.metadata?.tables?.[group.table]?.columns ?? [];
    for (const definition of group.fields) {
      const row = document.createElement("div");
      row.className = "mapping-row";
      const label = document.createElement("label");
      label.htmlFor = `mapping-${definition.key}`;
      label.textContent = definition.label;
      const select = document.createElement("select");
      select.id = `mapping-${definition.key}`;
      select.dataset.mappingKey = definition.key;

      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "— Choisir —";
      select.append(empty);
      for (const column of columns) {
        const option = document.createElement("option");
        option.value = column.colId;
        option.textContent = columnOptionLabel(column);
        select.append(option);
      }
      select.value = mappings?.[definition.key] ?? "";
      select.addEventListener("change", renderMappingDraftStatus);
      row.append(label, select);
      wrapper.append(row);
    }
    el.mappingFields.append(wrapper);
  }
  renderMappingDraftStatus();
}

function collectMappingDraft() {
  const mappings = {};
  for (const select of el.mappingFields.querySelectorAll("select[data-mapping-key]")) {
    mappings[select.dataset.mappingKey] = select.value;
  }
  return mappings;
}

function renderMappingDraftStatus() {
  const mappings = el.mappingFields.querySelector("select[data-mapping-key]") ? collectMappingDraft() : state.mappings;
  const issues = validateMappings(state.metadata, mappings);
  if (!issues.length) {
    el.mappingStatus.className = "settings-message";
    el.mappingStatus.textContent = "✓ Paramétrage des colonnes valide.";
  } else {
    el.mappingStatus.className = "settings-message error";
    el.mappingStatus.innerHTML = issues.map(row => `• ${esc(row.message)}`).join("<br>");
  }
}

function renderSettings() {
  el.diversity.checked = state.optimization?.diversity?.enabled !== false;
  el.priority.value = state.optimization?.diversity?.priority ?? "moyenne";
  el.priority.disabled = !el.diversity.checked;
  renderMappingFields(state.mappings);
}

function openSettings() {
  renderSettings();
  el.settingsPanel.hidden = false;
  el.settingsBackdrop.hidden = false;
  el.settingsToggle.setAttribute("aria-expanded", "true");
}

function closeSettings() {
  el.settingsPanel.hidden = true;
  el.settingsBackdrop.hidden = true;
  el.settingsToggle.setAttribute("aria-expanded", "false");
}

async function refreshData({ preservePeriods = true, announce = true } = {}) {
  const preferred = preservePeriods ? selectedPeriods() : null;
  const serial = ++state.refreshSerial;
  if (announce) status("Actualisation des données Grist…", "pending");
  state.busy = true;
  el.refresh.disabled = true;
  try {
    const snapshot = await fetchSnapshot(state.mappings);
    if (serial !== state.refreshSerial) return;
    state.snapshot = snapshot;
    state.metadata = snapshot.configuration.metadata;
    renderScope(preferred);
    renderAnalysis();
    const problems = configurationProblems(snapshot);
    status(problems.length ? problems[0] : "Données Grist à jour.", problems.length ? "error" : "ok");
  } catch (error) {
    if (serial !== state.refreshSerial) return;
    state.snapshot = null;
    status(error.message || "Impossible de lire les données Grist.", "error");
    renderScope();
    renderAnalysis();
  } finally {
    if (serial === state.refreshSerial) {
      state.busy = false;
      el.refresh.disabled = false;
      renderAnalysis();
    }
  }
}

async function handleClassSelection(classId) {
  const changed = classId !== state.selectedClassId;
  state.selectedClassId = classId;
  invalidatePlan();
  if (!state.configurationLoaded) return;
  await refreshData({ preservePeriods: !changed, announce: false });
}

async function createStages() {
  const classId = state.selectedClassId;
  const periods = selectedPeriods();
  if (!classId || !periods.length) return;
  setBusy(true);
  status("Création des stages manquants…", "pending");
  try {
    const result = await createMissingStages(classId, periods, state.mappings);
    if (state.selectedClassId === classId) {
      state.snapshot = result.snapshot;
      state.metadata = result.snapshot.configuration.metadata;
      renderScope(periods);
    }
    invalidatePlan();
    status(
      result.createdCount ? `${result.createdCount} stage(s) créé(s).` : "Tous les stages existaient déjà.",
      "ok",
    );
  } catch (error) {
    status(error.message || "La création des stages a échoué.", "error");
  } finally {
    setBusy(false);
  }
}

async function generate() {
  const classId = state.selectedClassId;
  const periods = selectedPeriods();
  if (!classId || !periods.length) return;
  invalidatePlan();
  setBusy(true);
  status("Vérification et calcul de la répartition…", "pending");
  try {
    const snapshot = await fetchSnapshot(state.mappings);
    if (state.selectedClassId !== classId) throw new Error("La classe sélectionnée a changé. Relance le calcul.");
    state.snapshot = snapshot;
    state.metadata = snapshot.configuration.metadata;
    const problems = configurationProblems(snapshot);
    if (problems.length) throw new Error(problems.join(" "));

    const plan = generatePlan(snapshot, {
      classId,
      periods,
      criteria: state.optimization,
    });
    plan.mappingSignature = mappingSignature(state.mappings);
    renderScope(periods);
    renderPlan(plan);
    status("Proposition calculée. Aucune donnée Grist n'a encore été modifiée.", "ok");
  } catch (error) {
    if (error instanceof AssignmentError && error.issues.length) {
      const messages = error.issues.map(row => row.message).join(" ");
      status(messages, "error");
    } else {
      status(error.message || "Le calcul a échoué.", "error");
    }
  } finally {
    setBusy(false);
  }
}

async function apply() {
  const plan = state.plan;
  if (!plan?.assignments?.length) return;
  const count = plan.assignments.length;
  setBusy(true);
  el.apply.disabled = true;
  status("Application des affectations…", "pending");
  try {
    const snapshot = await applyPlan(plan, state.mappings);
    state.snapshot = snapshot;
    state.metadata = snapshot.configuration.metadata;
    invalidatePlan();
    renderScope(plan.periods);
    status(`${count} affectation(s) appliquée(s).`, "ok");
  } catch (error) {
    status(error.message || "L'application des affectations a échoué.", "error");
  } finally {
    setBusy(false);
  }
}

async function saveSettings() {
  const mappings = collectMappingDraft();
  const issues = validateMappings(state.metadata, mappings);
  if (issues.length) {
    renderMappingDraftStatus();
    el.mappingStatus.scrollIntoView({ block: "nearest" });
    return;
  }
  const optimization = {
    diversity: {
      enabled: el.diversity.checked,
      priority: el.priority.value,
    },
  };

  state.busy = true;
  el.settingsSave.disabled = true;
  try {
    await saveConfiguration(mappings, optimization);
    state.mappings = mappings;
    state.optimization = optimization;
    invalidatePlan();
    closeSettings();
    status("Réglages enregistrés.", "ok");
    await refreshData({ preservePeriods: true, announce: false });
  } catch (error) {
    el.mappingStatus.className = "settings-message error";
    el.mappingStatus.textContent = error.message || "Impossible d'enregistrer les réglages.";
  } finally {
    state.busy = false;
    el.settingsSave.disabled = false;
    renderAnalysis();
  }
}

el.settingsToggle.addEventListener("click", () => el.settingsPanel.hidden ? openSettings() : closeSettings());
el.settingsClose.addEventListener("click", closeSettings);
el.settingsBackdrop.addEventListener("click", closeSettings);
el.refresh.addEventListener("click", () => {
  invalidatePlan();
  refreshData({ preservePeriods: true, announce: true });
});
el.createStages.addEventListener("click", createStages);
el.generate.addEventListener("click", generate);
el.apply.addEventListener("click", apply);
el.diversity.addEventListener("change", () => { el.priority.disabled = !el.diversity.checked; });
el.mappingAuto.addEventListener("click", () => renderMappingFields(inferMappings(state.metadata, {})));
el.settingsSave.addEventListener("click", saveSettings);

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !el.settingsPanel.hidden) closeSettings();
});

initializeGrist(handleClassSelection);
try {
  const configuration = await loadConfiguration();
  state.metadata = configuration.metadata;
  state.mappings = configuration.mappings;
  state.optimization = configuration.optimization;
  state.configurationLoaded = true;
  renderSettings();
  await refreshData({ preservePeriods: false, announce: false });
} catch (error) {
  state.configurationLoaded = true;
  status(error.message || "Impossible d'initialiser le widget.", "error");
  renderAnalysis();
}
