import { applyEnrichmentChanges, fetchFullSnapshot, findRowById, watchSelection, watchTable } from "./grist.js";
import { geocodeAddress } from "./geocode.js";
import { buildEnrichmentProposals, selectedChanges } from "./enrichment.js";
import { fetchOfficialRequest } from "./enterprise-client.js";
import { resolveStructureIdentity } from "./identity-orchestrator.js";
import { ESTABLISHMENT_BUDGET, resolveEstablishmentForEnrichment } from "./establishment-service.js";
import { IDENTITY_STATES, decisionEvidence } from "./identity-resolution.js";
import { findOsmIdentityPois } from "./osm-identity.js";
import { POSITION_STATES } from "./establishment-position.js";
import { warmSitePositionManifest } from "./site-position-sources.js";

const ui = {
  enrichButton: document.getElementById("enrich-button"),
  enrichStatus: document.getElementById("enrich-status"),
  candidate: document.getElementById("establishment-candidate"),
  proposalPanel: document.getElementById("proposal-panel"),
};

const state = {
  mappings: {},
  snapshot: null,
  snapshotGeneration: 0,
  selectedRowId: null,
  generation: 0,
  controller: null,
  decision: null,
  candidate: null,
  analyzedRow: null,
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

function canAnalyze() {
  const row = selectedRow();
  return row && !(state.snapshot?.missing?.length || state.snapshot?.nonWritableRequired?.length)
    && (row.NomCommercial || row.SirenSiret || row.Adresse);
}

function resetAnalysis() {
  state.generation += 1;
  state.controller?.abort();
  state.controller = null;
  state.decision = null;
  state.candidate = null;
  state.analyzedRow = null;
  state.proposals = [];
  if (ui.enrichButton) ui.enrichButton.disabled = true;
  clearNode(ui.candidate);
  clearNode(ui.proposalPanel);
  setStatus("");
}

async function refreshSnapshot(mappings = state.mappings) {
  state.mappings = mappings ?? state.mappings ?? {};
  const generation = ++state.snapshotGeneration;
  try {
    const snapshot = await fetchFullSnapshot(state.mappings);
    if (generation === state.snapshotGeneration) {
      state.snapshot = snapshot;
      if (ui.enrichButton) ui.enrichButton.disabled = Boolean(state.controller) || !canAnalyze();
      if (canAnalyze()) warmSitePositionManifest().catch(() => {});
    }
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

function candidateCard(candidate) {
  const card = document.createElement("div");
  card.className = "choice-card establishment-card";
  const content = document.createElement("div");
  const name = document.createElement("div");
  name.className = "choice-name";
  name.textContent = candidate.nomCommercial || candidate.raisonSociale || "Établissement";
  const legal = document.createElement("div");
  legal.className = "choice-detail";
  legal.textContent = `${candidate.raisonSociale || ""} — SIRET ${candidate.siret}`;
  const address = document.createElement("div");
  address.className = "choice-detail";
  address.textContent = candidate.adresse;
  content.append(name, legal, address);

  const position = document.createElement("div");
  position.className = "choice-detail";
  const point = candidate.position;
  const located = [POSITION_STATES.SITE_CONFIRMED, POSITION_STATES.SITE_CORROBORATED].includes(point?.status);
  position.textContent = located
    ? `${point.latitude}, ${point.longitude} — Position : ${point.source.label}, ${point.status === POSITION_STATES.SITE_CONFIRMED ? "SIRET explicite" : "nom public attesté + adresse de site concordante"}`
    : `Position : ${point?.reason || "position précise non démontrée"}`;
  content.appendChild(position);

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Sources et preuves";
  details.appendChild(summary);
  const identity = document.createElement("div");
  identity.className = "choice-detail";
  identity.textContent = `Identité : ${decisionEvidence(state.decision, candidate).join(" · ")}`;
  details.appendChild(identity);
  const sources = [
    { label: "Annuaire des Entreprises", recordId: candidate.siret, url: `https://annuaire-entreprises.data.gouv.fr/etablissement/${candidate.siret}` },
    ...(candidate.identityLinks ?? []).flatMap(link => [
      { label: link.sourceLabel, recordId: link.sourceRecordId, url: link.sourceUrl, publishedAt: link.sourcePublishedAt, historical: link.historical },
      ...(link.registryEvidence?.snapshotUrl ? [{ label: "Extraction officielle FINESS", recordId: link.sourceRecordId,
        url: link.registryEvidence.snapshotUrl, publishedAt: link.sourcePublishedAt }] : []),
    ]),
    ...(point?.proof ?? []).map(item => item.source),
    ...((point?.evidence ?? []).filter(item => item.accepted).map(item => item.observation.source)),
  ];
  const seen = new Set();
  for (const source of sources) {
    const key = `${source.url || ""}:${source.recordId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = document.createElement("div");
    line.className = "choice-detail";
    const link = document.createElement(/^https?:\/\//.test(source.url || "") ? "a" : "span");
    link.textContent = [source.label, source.recordId, source.upstream?.release || source.upstream?.runId, source.publishedAt || source.generatedAt, source.historical ? "référence historique revalidée" : ""].filter(Boolean).join(" — ");
    if (/^https?:\/\//.test(source.url || "")) { link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
    line.appendChild(link);
    details.appendChild(line);
  }
  for (const proof of point?.proof ?? []) {
    const line = document.createElement("div");
    line.className = "choice-detail";
    line.textContent = proof.description;
    details.appendChild(line);
  }
  if (point?.evidence?.some(item => item.kind === "discovery")) {
    const line = document.createElement("div");
    line.className = "choice-detail";
    line.textContent = "Le géocodage IGN a servi à la découverte et ne constitue pas une preuve de position du site.";
    details.appendChild(line);
  }
  if (point?.coverage?.some(item => ["error", "timeout", "not-indexed"].includes(item.status))) {
    const line = document.createElement("div");
    line.className = "choice-detail";
    line.textContent = "Certaines sources de position sont indisponibles ou ne couvrent pas ce code postal.";
    details.appendChild(line);
  }
  content.appendChild(details);
  card.appendChild(content);
  return card;
}

function renderEstablishment() {
  clearNode(ui.candidate);
  const decision = state.decision;
  if (!decision) return;
  const title = document.createElement("h3");
  title.textContent = "Établissement proposé";
  const summary = document.createElement("div");
  summary.className = "help";
  summary.textContent = `${decisionLabel(decision.status)} — ${decision.reason}`;
  ui.candidate.append(title, summary);
  if (state.candidate) ui.candidate.appendChild(candidateCard(state.candidate));
  else for (const candidate of (decision.alternatives ?? []).slice(0, 2)) ui.candidate.appendChild(candidateCard(candidate));
}

function updateApplyButton() {
  const button = ui.proposalPanel?.querySelector("#identity-apply-proposals");
  if (!button) return;
  const inputs = [...ui.proposalPanel.querySelectorAll("input[data-identity-proposal-field]")];
  const siretSelected = inputs.some(input => input.dataset.identityProposalField === "SirenSiret" && input.checked && !input.disabled);
  const coordinateInput = inputs.find(input => input.dataset.identityProposalField === "Coordinates");
  const coordinateProposal = state.proposals.find(item => item.field === "Coordinates");
  if (coordinateInput) coordinateInput.disabled = coordinateInput.dataset.writable !== "true"
    || !(siretSelected || coordinateProposal.currentSiret === coordinateProposal.requiresSiret);
  button.disabled = !Object.keys(selectedChanges(state.proposals,
    inputs.filter(input => input.checked && !input.disabled).map(input => input.dataset.identityProposalField),
  )).length;
}

function renderProposalPanel() {
  clearNode(ui.proposalPanel);
  const row = selectedRow();
  if (!row) return;
  state.proposals = buildEnrichmentProposals(
    row,
    state.candidate,
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
    const fields = item.fields ?? [item.field];
    const mapped = fields.every(field => state.snapshot?.resolvedMappings?.[field]);
    const writable = fields.every(field => state.snapshot?.writableMappings?.[field])
      && (!item.requiresSiret || item.currentSiret === item.requiresSiret || state.snapshot?.writableMappings?.SirenSiret);
    const rowNode = document.createElement("label");
    rowNode.className = "proposal-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.identityProposalField = item.field;
    checkbox.dataset.writable = String(Boolean(writable));
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
    const result = await applyEnrichmentChanges(row.id, changes, state.mappings, {
      positionSiret: state.candidate?.siret, expectedRow: state.analyzedRow,
    });
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
  if (!row || !canAnalyze() || state.controller) return;
  resetAnalysis();
  const generation = ++state.generation;
  const controller = new AbortController();
  state.controller = controller;
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("Le délai maximal de l’analyse a été atteint.", "TimeoutError"));
  }, ESTABLISHMENT_BUDGET.deadlineMs);
  ui.enrichButton.disabled = true;
  setStatus("Analyse de l’identité puis de la position du site…");

  try {
    const result = await resolveEstablishmentForEnrichment({
      row,
      signal: controller.signal,
      geocode: geocodeAddress,
      fetchOfficial: fetchOfficialRequest,
      resolveFallback: options => resolveStructureIdentity({ ...options, findPoiLinks: findOsmIdentityPois }),
    });
    if (generation !== state.generation) return;

    state.decision = result.decision;
    state.candidate = result.candidate;
    state.analyzedRow = Object.fromEntries(["NomCommercial", "RaisonSociale", "Adresse", "SirenSiret", "Latitude", "Longitude"].map(field => [field, row[field]]));

    renderEstablishment();
    renderProposalPanel();

    const diagnostics = (result.diagnostics ?? []).slice(0, 2);
    const message = [result.decision?.reason, ...diagnostics].filter(Boolean).join(" ");
    setStatus(message || "Analyse terminée.", result.decision?.status === IDENTITY_STATES.INCOMPLETE ? "error" : "");
  } catch (error) {
    if (generation !== state.generation) return;
    if (controller.signal.reason?.name === "TimeoutError" || error?.name === "TimeoutError") {
      setStatus(controller.signal.reason?.message || error.message, "error");
      return;
    }
    if (error?.name === "AbortError") return;
    console.error(error);
    setStatus(error.message || "Impossible d’analyser cette structure.", "error");
  } finally {
    clearTimeout(timeout);
    if (generation === state.generation) {
      state.controller = null;
      ui.enrichButton.disabled = !canAnalyze();
    }
  }
}

ui.enrichButton?.addEventListener("click", event => {
  event.preventDefault();
  runIdentityAnalysis();
});

watchTable(mappings => refreshSnapshot(mappings));
watchSelection((rowId, mappings) => {
  if (mappings && Object.keys(mappings).length) state.mappings = mappings;
  const changed = String(rowId) !== String(state.selectedRowId);
  state.selectedRowId = rowId;
  if (changed) resetAnalysis();
  refreshSnapshot(state.mappings);
});
