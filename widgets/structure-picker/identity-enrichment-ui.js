import { applyEnrichmentChanges, fetchFullSnapshot, findRowById, watchSelection, watchTable } from "./grist.js";
import { geocodeAddress } from "./geocode.js";
import { buildEnrichmentProposals, selectedChanges } from "./enrichment.js";
import { fetchOfficialRequest } from "./enterprise-client.js";
import { IDENTITY_BUDGET, resolveStructureIdentity } from "./identity-orchestrator.js";
import { resolveIdentityForEnrichment } from "./identity-service.js";
import { IDENTITY_STATES, decisionEvidence } from "./identity-resolution.js";
import { findOsmIdentityPois } from "./osm-identity.js";

const ui = {
  enrichButton: document.getElementById("enrich-button"),
  enrichStatus: document.getElementById("enrich-status"),
  enterpriseChoices: document.getElementById("enterprise-choices"),
  geocodeChoices: document.getElementById("geocode-choices"),
  proposalPanel: document.getElementById("proposal-panel"),
};

const state = {
  mappings: {},
  snapshot: null,
  selectedRowId: null,
  generation: 0,
  controller: null,
  decision: null,
  enterpriseCandidate: null,
  geocodeCandidates: [],
  selectedGeocode: null,
  proposals: [],
};

function clearNode(node) {
  node?.replaceChildren();
}

function setStatus(message = "", type = "") {
  if (!ui.enrichStatus) return;
  ui.enrichStatus.textContent = message;
  ui.enrichStatus.className = "substatus";
  if (type) ui.enrichStatus.classList.add(type);
}

function emptyMessage(message) {
  const node = document.createElement("div");
  node.className = "empty";
  node.textContent = message;
  return node;
}

function selectedRow() {
  if (!state.snapshot || !state.selectedRowId || state.selectedRowId === "new") return null;
  return findRowById(state.snapshot, state.selectedRowId);
}

function resetAnalysis() {
  state.generation += 1;
  state.controller?.abort();
  state.controller = null;
  state.decision = null;
  state.enterpriseCandidate = null;
  state.geocodeCandidates = [];
  state.selectedGeocode = null;
  state.proposals = [];
  clearNode(ui.enterpriseChoices);
  clearNode(ui.geocodeChoices);
  clearNode(ui.proposalPanel);
  setStatus("");
}

async function refreshSnapshot(mappings = state.mappings) {
  state.mappings = mappings ?? state.mappings ?? {};
  try {
    state.snapshot = await fetchFullSnapshot(state.mappings);
  } catch (error) {
    console.warn("Identity resolver snapshot unavailable", error);
  }
}

function decisionLabel(status) {
  if (status === IDENTITY_STATES.MATCH_VERIFIED) return "Identité confirmée";
  if (status === IDENTITY_STATES.MATCH_PROBABLE) return "Identité probable";
  if (status === IDENTITY_STATES.AMBIGUOUS) return "Identité ambiguë";
  if (status === IDENTITY_STATES.INCOMPLETE) return "Analyse incomplète";
  return "Aucune identité démontrée";
}

function candidateCard(candidate, { selected = false, selectable = false } = {}) {
  const card = document.createElement(selectable ? "label" : "div");
  card.className = "choice-card";
  if (selectable) {
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "identity-resolution-candidate";
    radio.checked = selected;
    radio.addEventListener("change", () => {
      state.enterpriseCandidate = candidate;
      renderProposalPanel();
    });
    card.appendChild(radio);
  }

  const content = document.createElement("div");
  const name = document.createElement("div");
  name.className = "choice-name";
  name.textContent = candidate?.nomCommercial || candidate?.raisonSociale || "Établissement";
  content.appendChild(name);

  const detail = document.createElement("div");
  detail.className = "choice-detail";
  detail.textContent = [
    candidate?.raisonSociale,
    candidate?.adresse,
    candidate?.siret ? `SIRET ${candidate.siret}` : "",
  ].filter(Boolean).join(" — ");
  content.appendChild(detail);

  const evidence = decisionEvidence(state.decision, candidate).slice(0, 3);
  if (evidence.length) {
    const proof = document.createElement("div");
    proof.className = "choice-detail";
    proof.textContent = `Preuves : ${evidence.join(" · ")}`;
    content.appendChild(proof);
  }
  card.appendChild(content);
  return card;
}

function renderIdentityDecision() {
  clearNode(ui.enterpriseChoices);
  const decision = state.decision;
  if (!decision) return;

  const title = document.createElement("h3");
  title.textContent = "Identité officielle — Annuaire des Entreprises";
  ui.enterpriseChoices.appendChild(title);

  const summary = document.createElement("div");
  summary.className = "help";
  summary.textContent = `${decisionLabel(decision.status)} — ${decision.reason}`;
  ui.enterpriseChoices.appendChild(summary);

  if (decision.status === IDENTITY_STATES.MATCH_VERIFIED || decision.status === IDENTITY_STATES.MATCH_PROBABLE) {
    if (decision.candidate) ui.enterpriseChoices.appendChild(candidateCard(decision.candidate, { selected: true, selectable: true }));
    return;
  }

  const alternatives = decision.candidate ? [decision.candidate] : (decision.alternatives ?? []);
  for (const candidate of alternatives.slice(0, 2)) {
    ui.enterpriseChoices.appendChild(candidateCard(candidate));
  }
}

function renderGeocodeChoices() {
  clearNode(ui.geocodeChoices);
  if (!state.geocodeCandidates.length) return;
  const title = document.createElement("h3");
  title.textContent = "Localisation — Géocodage IGN";
  ui.geocodeChoices.appendChild(title);
  const list = document.createElement("div");
  list.className = "choice-list";

  state.geocodeCandidates.forEach((item, index) => {
    const label = document.createElement("label");
    label.className = "choice-card";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "identity-geocode-choice";
    radio.value = String(index);
    radio.checked = item === state.selectedGeocode;
    radio.addEventListener("change", () => {
      state.selectedGeocode = item;
      renderProposalPanel();
    });
    const content = document.createElement("div");
    const name = document.createElement("div");
    name.className = "choice-name";
    name.textContent = item.adresse;
    const detail = document.createElement("div");
    detail.className = "choice-detail";
    const score = Number.isFinite(item.score) ? `score ${item.score.toFixed(2)}` : "";
    detail.textContent = [`${item.latitude}, ${item.longitude}`, score].filter(Boolean).join(" — ");
    content.append(name, detail);
    label.append(radio, content);
    list.appendChild(label);
  });
  ui.geocodeChoices.appendChild(list);
}

function updateApplyButton() {
  const button = ui.proposalPanel?.querySelector("#identity-apply-proposals");
  if (!button) return;
  button.disabled = !ui.proposalPanel.querySelector("input[data-identity-proposal-field]:checked:not(:disabled)");
}

function renderProposalPanel() {
  clearNode(ui.proposalPanel);
  const row = selectedRow();
  if (!row) return;
  state.proposals = buildEnrichmentProposals(
    row,
    state.enterpriseCandidate,
    state.selectedGeocode,
    { identityStatus: state.decision?.status ?? "" },
  );
  if (!state.proposals.length) {
    ui.proposalPanel.append(emptyMessage("Aucune modification supplémentaire à proposer avec les preuves disponibles."));
    return;
  }

  const title = document.createElement("h3");
  title.textContent = "Modifications proposées";
  ui.proposalPanel.appendChild(title);
  const help = document.createElement("div");
  help.className = "help";
  help.textContent = state.decision?.status === IDENTITY_STATES.MATCH_PROBABLE
    ? "L’identité est probable : les champs juridiques restent décochés par défaut."
    : "Les champs vides confirmés sont cochés par défaut. Remplacer une valeur existante exige une validation explicite.";
  ui.proposalPanel.appendChild(help);

  const list = document.createElement("div");
  list.className = "proposal-list";
  for (const item of state.proposals) {
    const mapped = state.snapshot?.resolvedMappings?.[item.field];
    const writable = state.snapshot?.writableMappings?.[item.field];
    const rowNode = document.createElement("label");
    rowNode.className = "proposal-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.identityProposalField = item.field;
    checkbox.checked = Boolean(item.selectedByDefault && writable);
    checkbox.disabled = !writable;
    checkbox.addEventListener("change", updateApplyButton);

    const label = document.createElement("div");
    label.className = "proposal-label";
    label.textContent = item.label;
    if (!mapped) label.textContent += " — non mappé";
    else if (!writable) label.textContent += " — non modifiable";

    const values = document.createElement("div");
    values.className = "proposal-values";
    const current = document.createElement("div");
    current.className = "proposal-current";
    current.textContent = `Actuel : ${item.current === undefined || item.current === null || item.current === "" ? "—" : item.current}`;
    const proposed = document.createElement("div");
    proposed.className = "proposal-new";
    proposed.textContent = `Proposé : ${item.proposed}`;
    const source = document.createElement("div");
    source.className = "proposal-source";
    source.textContent = item.source;
    values.append(current, proposed, source);
    rowNode.append(checkbox, label, values);
    list.appendChild(rowNode);
  }
  ui.proposalPanel.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "proposal-actions";
  const apply = document.createElement("button");
  apply.id = "identity-apply-proposals";
  apply.type = "button";
  apply.className = "button button-primary";
  apply.textContent = "Appliquer les modifications cochées";
  apply.addEventListener("click", applySelectedProposals);
  actions.appendChild(apply);
  ui.proposalPanel.appendChild(actions);
  updateApplyButton();
}

async function applySelectedProposals() {
  const row = selectedRow();
  if (!row) return;
  const selectedFields = new Set(
    [...ui.proposalPanel.querySelectorAll("input[data-identity-proposal-field]:checked:not(:disabled)")]
      .map(input => input.dataset.identityProposalField),
  );
  const changes = selectedChanges(state.proposals, selectedFields);
  if (!Object.keys(changes).length) return;

  const button = ui.proposalPanel.querySelector("#identity-apply-proposals");
  if (button) button.disabled = true;
  setStatus("Mise à jour de la structure dans Grist…");
  try {
    const result = await applyEnrichmentChanges(row.id, changes, state.mappings);
    state.snapshot = result.snapshot;
    const skippedMessage = result.skipped.length ? ` Champs ignorés : ${result.skipped.join(", ")}.` : "";
    setStatus(`Structure mise à jour.${skippedMessage}`, "success");
    clearNode(ui.proposalPanel);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Impossible de mettre à jour la structure.", "error");
    updateApplyButton();
  }
}

async function runIdentityAnalysis() {
  const row = selectedRow();
  if (!row) return;
  resetAnalysis();
  const generation = ++state.generation;
  const controller = new AbortController();
  state.controller = controller;
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("Le délai maximal de l’analyse a été atteint.", "TimeoutError"));
  }, IDENTITY_BUDGET.deadlineMs);
  ui.enrichButton.disabled = true;
  setStatus("Analyse de l’identité de l’établissement…");

  try {
    const result = await resolveIdentityForEnrichment({
      row,
      signal: controller.signal,
      geocode: geocodeAddress,
      fetchOfficial: fetchOfficialRequest,
      resolveFallback: options => resolveStructureIdentity({ ...options, findPoiLinks: findOsmIdentityPois }),
    });
    if (generation !== state.generation) return;

    state.decision = result.decision;
    state.geocodeCandidates = result.geocodeCandidates ?? [];
    state.selectedGeocode = result.selectedGeocode ?? null;
    state.enterpriseCandidate = [IDENTITY_STATES.MATCH_VERIFIED, IDENTITY_STATES.MATCH_PROBABLE].includes(result.decision?.status)
      ? result.decision.candidate
      : null;

    renderIdentityDecision();
    renderGeocodeChoices();
    renderProposalPanel();

    const diagnostics = (result.diagnostics ?? []).slice(0, 2);
    const message = [result.decision?.reason, ...diagnostics].filter(Boolean).join(" ");
    setStatus(message || "Analyse terminée.", result.decision?.status === IDENTITY_STATES.INCOMPLETE ? "error" : "");
  } catch (error) {
    if (generation !== state.generation) return;
    if (controller.signal.reason?.name === "TimeoutError") {
      setStatus(controller.signal.reason.message, "error");
      return;
    }
    if (error?.name === "AbortError") return;
    console.error(error);
    setStatus(error.message || "Impossible d’analyser cette structure.", "error");
  } finally {
    clearTimeout(timeout);
    if (generation === state.generation) ui.enrichButton.disabled = !selectedRow();
  }
}

ui.enrichButton?.addEventListener("click", event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  runIdentityAnalysis();
}, { capture: true });

watchTable(mappings => refreshSnapshot(mappings));
watchSelection((rowId, mappings) => {
  if (mappings && Object.keys(mappings).length) state.mappings = mappings;
  const changed = String(rowId) !== String(state.selectedRowId);
  state.selectedRowId = rowId;
  if (changed) resetAnalysis();
  refreshSnapshot(state.mappings);
});
