import { presentedCandidate, formatSiret } from "./presentation-conventions.js";
import { establishmentConfidence } from "./confidence.js";
import {
  applyEnrichmentChanges,
  fetchFullSnapshot,
  findRowById,
  watchSelection,
  watchTable,
} from "./grist.js";
import { geocodeAddress } from "./geocode.js";
import { buildEnrichmentProposals, selectedChanges } from "./enrichment.js";
import { fetchOfficialRequest } from "./enterprise-client.js";
import { resolveStructureIdentity } from "./identity-orchestrator.js";
import {
  ESTABLISHMENT_BUDGET,
  resolveEstablishmentForEnrichment,
} from "./establishment-service.js";
import { IDENTITY_STATES, decisionEvidence } from "./identity-resolution.js";
import { findOsmIdentityPois } from "./osm-identity.js";
import { POSITION_STATES } from "./establishment-position.js";
import { warmSitePositionManifest } from "./site-position-sources.js";
import {
  emptyDiscoveryProgress,
  mergeDiscoveryProgress,
  recordDiscoverySourceEvent,
  discoveryHints,
  discoveryHintKey,
  discoverySourceLabel,
} from "./discovery-progress.js";
import {
  emptyDiscoveryGuidance,
  chooseDiscoveryGuidance,
  correctDiscoveryGuidance,
  isRejectedGuidance,
  guidanceFieldValue,
} from "./discovery-guidance.js";
import { diagnoseDiscovery, skipDiscoveryQuestion } from "./discovery-diagnosis.js";

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
  diagnostics: [],
  trace: [],
  progress: null,
  progressKey: null,
  visibleHintCount: 5,
  guidance: emptyDiscoveryGuidance(),
  isDeepening: false,
  guidedRestart: false,
  questionDraft: null,
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
  if (!state.snapshot || !state.selectedRowId || state.selectedRowId === "new")
    return null;
  return findRowById(state.snapshot, state.selectedRowId);
}

function canAnalyze() {
  const row = selectedRow();
  return (
    row &&
    !(
      state.snapshot?.missing?.length ||
      state.snapshot?.nonWritableRequired?.length
    ) &&
    (row.NomCommercial || row.SirenSiret || row.Adresse)
  );
}

function resetAnalysis() {
  state.generation += 1;
  state.controller?.abort();
  state.controller = null;
  state.decision = null;
  state.candidate = null;
  state.analyzedRow = null;
  state.proposals = [];
  state.diagnostics = [];
  state.trace = [];
  state.progress = null;
  state.progressKey = null;
  state.visibleHintCount = 5;
  state.guidance = emptyDiscoveryGuidance();
  state.isDeepening = false;
  state.guidedRestart = false;
  state.questionDraft = null;
  if (ui.enrichButton) {
    ui.enrichButton.disabled = true;
    ui.enrichButton.textContent = "Analyser / compléter";
  }
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
      if (ui.enrichButton)
        ui.enrichButton.disabled = Boolean(state.controller) || !canAnalyze();
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
  candidate = presentedCandidate(candidate, state.analyzedRow);
  const card = document.createElement("div");
  card.className = "choice-card establishment-card";
  const content = document.createElement("div");
  const name = document.createElement("div");
  name.className = "choice-name";
  name.textContent =
    candidate.nomCommercial || candidate.raisonSociale || "Établissement";
  const legal = document.createElement("div");
  legal.className = "choice-detail";
  legal.textContent =
    candidate.identityScope === "PUBLIC_SITE"
      ? candidate.operator
        ? `Gestionnaire : ${candidate.operator.raisonSociale} — SIRET ${formatSiret(candidate.operator.siret)}`
        : "Lieu identifié — numéro d’immatriculation propre non établi"
      : [
          candidate.raisonSociale,
          candidate.siret ? `SIRET ${formatSiret(candidate.siret)}` : "",
        ]
          .filter(Boolean)
          .join(" — ");
  const address = document.createElement("div");
  address.className = "choice-detail";
  address.textContent = candidate.adresse;
  const confidence = establishmentConfidence(state.decision, candidate);
  const badge = document.createElement("div");
  badge.className = `confidence-badge confidence-${confidence.tone}`;
  badge.textContent = `Confiance ${confidence.score} / 100`;
  badge.title =
    "Indice fondé sur les vérifications disponibles ; ce n’est pas une probabilité statistique.";
  content.append(name, badge, legal, address);

  const position = document.createElement("div");
  position.className = "choice-detail";
  const point = candidate.position;
  const located = [
    POSITION_STATES.SITE_CONFIRMED,
    POSITION_STATES.SITE_CORROBORATED,
  ].includes(point?.status);
  position.textContent = located
    ? `Latitude ${point.latitude} / Longitude ${point.longitude} — Position ${point.status === POSITION_STATES.SITE_CONFIRMED ? "confirmée" : "corroborée"}`
    : point?.status === POSITION_STATES.CONFLICT
      ? "Position à vérifier : les informations disponibles se contredisent."
      : "Position précise à vérifier ; aucune coordonnée proposée.";
  content.appendChild(position);

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Détails de vérification";
  details.appendChild(summary);
  const identity = document.createElement("div");
  identity.className = "choice-detail";
  identity.textContent = `Identité : ${candidate.identityScope === "PUBLIC_SITE" ? candidate.identityProof.join(" · ") : decisionEvidence(state.decision, candidate).join(" · ")}`;
  details.appendChild(identity);
  const sources = [
    ...(candidate.siret
      ? [
          {
            label: "Annuaire des Entreprises",
            recordId: candidate.siret,
            url: `https://annuaire-entreprises.data.gouv.fr/etablissement/${candidate.siret}`,
          },
        ]
      : []),
    ...(candidate.identityLinks ?? []).flatMap((link) => [
      {
        label: link.sourceLabel,
        recordId: link.sourceRecordId,
        url: link.sourceUrl,
        publishedAt: link.sourcePublishedAt,
        historical: link.historical,
      },
      ...(link.registryEvidence?.snapshotUrl
        ? [
            {
              label: "Extraction officielle FINESS",
              recordId: link.sourceRecordId,
              url: link.registryEvidence.snapshotUrl,
              publishedAt: link.sourcePublishedAt,
            },
          ]
        : []),
    ]),
    ...(point?.proof ?? []).map((item) => item.source),
    ...(point?.evidence ?? [])
      .filter((item) => item.accepted)
      .map((item) => item.observation.source),
  ];
  const seen = new Set();
  for (const source of sources.filter(Boolean)) {
    const key = `${source.url || ""}:${source.recordId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = document.createElement("div");
    line.className = "choice-detail";
    const link = document.createElement(
      /^https?:\/\//.test(source.url || "") ? "a" : "span",
    );
    link.textContent = [
      source.label,
      source.recordId,
      source.version ? `version ${source.version}` : "",
      source.updatedAt,
      source.upstream?.release || source.upstream?.runId,
      source.publishedAt || source.generatedAt,
      source.historical ? "référence historique revalidée" : "",
    ]
      .filter(Boolean)
      .join(" — ");
    if (/^https?:\/\//.test(source.url || "")) {
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    line.appendChild(link);
    details.appendChild(line);
  }
  for (const proof of point?.proof ?? []) {
    const line = document.createElement("div");
    line.className = "choice-detail";
    line.textContent = proof.description;
    details.appendChild(line);
  }
  if (point?.evidence?.some((item) => item.kind === "discovery")) {
    const line = document.createElement("div");
    line.className = "choice-detail";
    line.textContent =
      "Le géocodage IGN a servi à la découverte et ne constitue pas une preuve de position du site.";
    details.appendChild(line);
  }
  if (
    point?.coverage?.some((item) =>
      ["error", "timeout", "not-indexed"].includes(item.status),
    )
  ) {
    const line = document.createElement("div");
    line.className = "choice-detail";
    line.textContent =
      "Certaines sources de position sont indisponibles ou ne couvrent pas ce code postal.";
    details.appendChild(line);
  }
  content.appendChild(details);
  card.appendChild(content);
  appendGuidanceControls(card, candidate);
  return card;
}


// A teacher's choice changes lookup priority, never the target row used by
// decideIdentity, the official proof set or the Grist write authorization.
function redirectDiscovery() {
  if (state.controller && !state.isDeepening) {
    state.guidedRestart = true;
    state.controller.abort(new DOMException("Nouvelle piste choisie", "AbortError"));
    return;
  }
  if (!state.controller) {
    runIdentityAnalysis({ deepening: true });
    return;
  }
  setStatus("Choix pris en compte pour les prochaines recherches. Aucune donnée Grist modifiée.");
  renderDiscoveryProgress();
}

function appendGuidanceControls(container, candidate) {
  const actions = document.createElement("div");
  actions.className = "discovery-guidance-actions";
  const fields = [
    ["name", "Nom"], ["address", "Adresse"], ["commune", "Commune"],
    ["operator", "Gestionnaire"], ["siret", "SIRET"],
  ];
  for (const [field, label] of fields) {
    const value = guidanceFieldValue(candidate, field);
    if (!value) continue;
    const selected = state.guidance.selected.some(item =>
      item.field === field && item.value === value
    );
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary";
    button.textContent = (selected ? "✓ " : "") + label;
    button.title = "Utiliser cette information pour chercher ; ne prouve pas l’identité du site.";
    button.ariaPressed = String(selected);
    button.addEventListener("click", () => {
      if (!chooseDiscoveryGuidance(state.guidance, candidate, field)) return;
      redirectDiscovery();
    });
    actions.appendChild(button);
  }
  const rejected = isRejectedGuidance(state.guidance, candidate);
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "button button-secondary";
  reject.textContent = rejected ? "Réexaminer" : "Écarter";
  reject.ariaPressed = String(rejected);
  reject.addEventListener("click", () => {
    if (!chooseDiscoveryGuidance(state.guidance, candidate, "", "reject")) return;
    redirectDiscovery();
  });
  actions.appendChild(reject);
  container.appendChild(actions);

  const correction = document.createElement("details");
  correction.className = "discovery-correction";
  const summary = document.createElement("summary");
  summary.textContent = "Corriger ou préciser une information";
  const selector = document.createElement("select");
  selector.className = "discovery-correction-field";
  for (const [field, label] of fields) {
    const option = document.createElement("option");
    option.value = field;
    option.textContent = label;
    selector.appendChild(option);
  }
  selector.value = "name";
  selector.setAttribute?.("aria-label", "Information à corriger pour la recherche");
  const entry = document.createElement("input");
  entry.type = "text";
  entry.className = "discovery-correction-value";
  entry.maxLength = 250;
  entry.setAttribute?.("aria-label", "Valeur corrigée, utilisée uniquement pour rechercher");
  const candidateKey = discoveryHintKey(candidate);
  const refreshEntry = () => {
    entry.value = state.guidance.selected.find(item => item.key === candidateKey && item.field === selector.value)?.value
      ?? guidanceFieldValue(candidate, selector.value);
  };
  selector.addEventListener("change", refreshEntry);
  refreshEntry();
  const useCorrection = document.createElement("button");
  useCorrection.type = "button";
  useCorrection.className = "button button-secondary discovery-correction-apply";
  useCorrection.textContent = "Rechercher avec cette correction";
  useCorrection.addEventListener("click", () => {
    const row = selectedRow();
    if (!row || state.progressKey !== [row.id, row.NomCommercial, row.Adresse, row.SirenSiret].join("|")) return;
    if (!correctDiscoveryGuidance(state.guidance, candidate, selector.value, entry.value)) {
      setStatus("Correction inchangée ou invalide. Pour le SIRET, saisir 9 ou 14 chiffres.", "error");
      return;
    }
    redirectDiscovery();
  });
  const note = document.createElement("div");
  note.className = "help";
  note.textContent = "Indice de recherche uniquement : ne certifie pas le SIRET, l’adresse ou le site et n’enregistre rien dans Grist.";
  correction.append(summary, selector, entry, useCorrection, note);
  container.appendChild(correction);
}

function appendGuidanceSummary(container) {
  const corrections = state.guidance.selected.filter(item => item.corrected);
  if (!corrections.length) return;
  const line = document.createElement("div");
  line.className = "help";
  line.textContent = "Corrections utilisées pour la recherche (non vérifiées) : " +
    corrections.map(item => item.field + " : " + item.value).join(" ; ");
  container.appendChild(line);
}

function appendDiscoveryHints(container, { excluded = [] } = {}) {
  const reference = selectedRow();
  const leads = discoveryHints(state.progress, state.visibleHintCount, {
    excluded, reference, guidance: state.guidance,
  });
  if (!leads.length) return;
  const available = (state.progress?.candidates ?? []).filter(candidate =>
    !excluded.includes(discoveryHintKey(candidate))).length;
  const label = document.createElement("div");
  label.className = "help";
  label.textContent = `Pistes à explorer (${leads.length} affichées sur ${available} disponibles). Classement indicatif par nom et lieu, sans preuve d’identité. Les pistes restent conservées et consultables ; les choix orientent la recherche sans modifier Grist.`;
  container.appendChild(label);
  for (const lead of leads) {
    const line = document.createElement("div");
    line.className = "discovery-lead";
    const description = document.createElement("div");
    description.className = "choice-detail";
    description.textContent = [
      lead.name, lead.address,
      lead.siret ? "SIRET indiqué : " + formatSiret(lead.siret) + " (à vérifier)" : "",
    ].filter(Boolean).join(" — ");
    line.appendChild(description);
    appendGuidanceControls(line, lead.candidate);
    container.appendChild(line);
  }
  const remaining = available - leads.length;
  if (remaining > 0) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "button button-secondary discovery-more";
    more.textContent = "Afficher " + Math.min(5, remaining) + " autres pistes (" + remaining + " restantes)";
    more.addEventListener("click", () => {
      state.visibleHintCount = Math.min(250, state.visibleHintCount + 5);
      if (state.decision) renderEstablishment();
      else renderDiscoveryProgress();
    });
    container.appendChild(more);
  }
}


// One contextual question at a time. Its answer becomes a search hint, never
// official evidence and never a Grist write. Re-rendering preserves typed text.
function appendDiscoveryQuestion(container, { searching = false } = {}) {
  const row = selectedRow();
  if (!row) return;
  const diagnosis = diagnoseDiscovery({
    reference: row, progress: state.progress, guidance: state.guidance,
    decision: state.decision, searching,
  });
  const question = diagnosis.question;
  if (!question) return;
  const panel = document.createElement("section");
  panel.className = "discovery-question";
  const title = document.createElement("strong");
  title.textContent = question.message;
  const reason = document.createElement("p");
  reason.className = "help";
  reason.textContent = question.reason;
  panel.append(title, reason);

  const stillSameRow = () => {
    const latest = selectedRow();
    return latest && state.progressKey === [latest.id, latest.NomCommercial, latest.Adresse, latest.SirenSiret].join("|");
  };
  const apply = (candidate, value, field, correction = false) => {
    if (!stillSameRow()) return;
    const updated = correction
      ? correctDiscoveryGuidance(state.guidance, candidate, field, value)
      : chooseDiscoveryGuidance(state.guidance, candidate, field);
    if (!updated) {
      setStatus("Précision inchangée ou invalide.", "error");
      return;
    }
    state.questionDraft = null;
    redirectDiscovery();
  };
  for (const choice of question.options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary discovery-question-option";
    button.textContent = choice.label;
    button.title = "Utiliser pour la prochaine recherche (sans valider l’établissement)";
    button.addEventListener("click", () =>
      apply(choice.candidate, choice.label, choice.field));
    panel.appendChild(button);
  }

  const form = document.createElement("form");
  form.className = "discovery-question-entry";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 250;
  input.setAttribute("aria-label", "Autre précision utile pour la recherche");
  input.placeholder = question.field === "commune" ? "Autre commune" :
    question.field === "address" ? "Autre adresse" : "Autre nom";
  input.value = state.questionDraft?.id === question.id ? state.questionDraft.value : "";
  input.addEventListener("input", () => {
    state.questionDraft = { id: question.id, value: input.value };
  });
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "button button-secondary";
  submit.textContent = "Rechercher avec cette précision";
  form.addEventListener("submit", event => {
    event.preventDefault();
    apply(question.anchor, input.value, question.field, true);
  });
  form.append(input, submit);
  panel.appendChild(form);
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "button button-secondary";
  skip.textContent = "Je ne sais pas / Ignorer";
  skip.addEventListener("click", () => {
    if (!stillSameRow()) return;
    skipDiscoveryQuestion(state.guidance, question.id);
    state.questionDraft = null;
    if (state.decision) renderEstablishment();
    else renderDiscoveryProgress();
    // Automatic lookup continues while running. A completed ordinary search
    // may be deepened without asking the same question again.
    if (!state.controller && !state.isDeepening)
      runIdentityAnalysis({ deepening: true });
  });
  panel.appendChild(skip);
  const warning = document.createElement("div");
  warning.className = "help";
  warning.textContent = "Votre réponse guide la recherche ; elle ne certifie ni l’identité juridique, ni la position, et n’écrit rien dans Grist.";
  panel.appendChild(warning);
  container.appendChild(panel);
}

function renderDiscoveryProgress({ stopped = false } = {}) {
  if (!state.progress) return;
  clearNode(ui.candidate);
  const heading = document.createElement("h3");
  heading.textContent = stopped ? "Recherche interrompue — pistes conservées" : "Recherche en cours — premiers résultats";
  ui.candidate.appendChild(heading);
  appendGuidanceSummary(ui.candidate);
  appendDiscoveryQuestion(ui.candidate, { searching: !stopped && Boolean(state.controller) });
  appendDiscoveryHints(ui.candidate);

  const activity = state.progress.activity ?? [];
  if (activity.length) {
    const details = document.createElement("details");
    const title = document.createElement("summary");
    title.textContent = "Activité réelle des sources (" + activity.length + ")";
    details.appendChild(title);
    for (const entry of activity) {
      const line = document.createElement("div");
      line.className = "choice-detail";
      line.textContent = entry.source + " : " + discoverySourceLabel(entry.state) +
        (entry.elapsedMs === null ? "" : " — " + entry.elapsedMs + " ms");
      details.appendChild(line);
    }
    ui.candidate.appendChild(details);
  }
  if (stopped) {
    const deepen = document.createElement("button");
    deepen.type = "button";
    deepen.className = "button button-secondary";
    deepen.textContent = "Approfondir la recherche";
    deepen.addEventListener("click", () => runIdentityAnalysis({ deepening: true }));
    ui.candidate.appendChild(deepen);
  }
  if (!stopped && state.controller && !state.controller.signal.aborted) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary";
    button.textContent = "Interrompre la recherche";
    button.addEventListener("click", () => {
      if (state.controller && !state.controller.signal.aborted)
        state.controller.abort(new DOMException("Interruption demandée", "AbortError"));
    });
    ui.candidate.appendChild(button);
  }
}

function renderEstablishment() {
  clearNode(ui.candidate);
  const decision = state.decision;
  if (!decision) return;
  const title = document.createElement("h3");
  title.textContent = "Établissement proposé";
  const summary = document.createElement("div");
  summary.className = "help";
  summary.textContent =
    decisionLabel(decision.status) +
    (decision.status === IDENTITY_STATES.AMBIGUOUS
      ? " — Précisez l’adresse ou le contact pour départager les lieux."
      : state.candidate?.addressCorrectionSuggestion
        ? " — Adresse différente : vérifiez qu’il s’agit bien de votre structure avant d’accepter la correction."
        : decision.status === IDENTITY_STATES.INCOMPLETE
          ? " — Certaines vérifications n’ont pas abouti. Les informations reçues restent disponibles."
          : "");
  ui.candidate.append(title, summary);
  appendGuidanceSummary(ui.candidate);
  appendDiscoveryQuestion(ui.candidate);
  if (state.candidate) ui.candidate.appendChild(candidateCard(state.candidate));
  else {
    const alternatives = (decision.alternatives ?? []).slice(0, 5);
    for (const candidate of alternatives)
      ui.candidate.appendChild(candidateCard(candidate));
  }
  if (decision.status !== IDENTITY_STATES.MATCH_VERIFIED) {
    // Even an ambiguous verdict may contain more independent clues than its
    // first five official alternatives. Avoid duplicating displayed cards.
    const displayed = [state.candidate, ...(decision.alternatives ?? []).slice(0, 5)]
      .filter(Boolean).map(discoveryHintKey);
    appendDiscoveryHints(ui.candidate, { excluded: displayed });
    const deepen = document.createElement("button");
    deepen.type = "button";
    deepen.className = "button button-secondary";
    deepen.textContent = "Approfondir la recherche";
    deepen.addEventListener("click", () => runIdentityAnalysis({ deepening: true }));
    ui.candidate.appendChild(deepen);
  }
  if (decision.identifierWarning) {
    const warning = document.createElement("div");
    warning.className = "help";
    warning.textContent = decision.identifierWarning.message;
    ui.candidate.appendChild(warning);
  }
  const details = document.createElement("details");
  const label = document.createElement("summary");
  label.textContent = "Diagnostic technique";
  details.appendChild(label);
  for (const message of state.diagnostics) {
    const line = document.createElement("div");
    line.className = "choice-detail";
    line.textContent = message;
    details.appendChild(line);
  }
  for (const event of state.trace.filter((item) => item.state !== "start")) {
    const line = document.createElement("div");
    line.className = "choice-detail";
    line.textContent = `${event.source} : ${event.state} — ${event.elapsedMs ?? 0} ms${event.budgetMs ? ` / budget ${event.budgetMs} ms` : ""}`;
    details.appendChild(line);
  }
  ui.candidate.appendChild(details);
}

function updateApplyButton() {
  const button = ui.proposalPanel?.querySelector("#identity-apply-proposals");
  if (!button) return;
  const inputs = [
    ...ui.proposalPanel.querySelectorAll("input[data-identity-proposal-field]"),
  ];
  const siretSelected = inputs.some(
    (input) =>
      input.dataset.identityProposalField === "SirenSiret" &&
      input.checked &&
      !input.disabled,
  );
  const coordinateInput = inputs.find(
    (input) => input.dataset.identityProposalField === "Coordinates",
  );
  const coordinateProposal = state.proposals.find(
    (item) => item.field === "Coordinates",
  );
  if (coordinateInput)
    coordinateInput.disabled =
      coordinateInput.dataset.writable !== "true" ||
      (coordinateProposal.requiresSiteId
        ? Boolean(coordinateProposal.currentRegistration)
        : !(
            siretSelected ||
            coordinateProposal.currentSiret === coordinateProposal.requiresSiret
          ));
  button.disabled = !Object.keys(
    selectedChanges(
      state.proposals,
      inputs
        .filter((input) => input.checked && !input.disabled)
        .map((input) => input.dataset.identityProposalField),
    ),
  ).length;
}

function renderProposalPanel() {
  clearNode(ui.proposalPanel);
  const row = selectedRow();
  if (!row) return;
  if (state.candidate && isRejectedGuidance(state.guidance, state.candidate)) {
    state.proposals = [];
    ui.proposalPanel.append(emptyMessage("Cette piste a été écartée : aucune modification ne peut être appliquée."));
    return;
  }
  state.proposals = buildEnrichmentProposals(row, state.candidate, {
    identityStatus: state.decision?.status ?? "",
  });
  if (!state.proposals.length) {
    ui.proposalPanel.append(
      emptyMessage(
        "Aucune modification supplémentaire à proposer avec les preuves disponibles.",
      ),
    );
    return;
  }

  const title = document.createElement("h3");
  title.textContent = "Modifications proposées";
  ui.proposalPanel.appendChild(title);
  const help = document.createElement("div");
  help.className = "help";
  help.textContent =
    state.decision?.status === IDENTITY_STATES.MATCH_PROBABLE
      ? "L’identité est probable : les champs juridiques restent décochés par défaut."
      : "Les améliorations confirmées sont cochées par défaut. Décochez celles que vous ne souhaitez pas appliquer.";
  ui.proposalPanel.appendChild(help);

  const list = document.createElement("div");
  list.className = "proposal-list";
  for (const item of state.proposals) {
    const fields = item.fields ?? [item.field];
    const mapped = fields.every(
      (field) => state.snapshot?.resolvedMappings?.[field],
    );
    const writable =
      fields.every((field) => state.snapshot?.writableMappings?.[field]) &&
      (!item.requiresSiret ||
        item.currentSiret === item.requiresSiret ||
        state.snapshot?.writableMappings?.SirenSiret);
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
    source.textContent =
      item.field === "Coordinates"
        ? "Position du lieu vérifiée"
        : "Valeur proposée pour cette structure";
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
    [
      ...ui.proposalPanel.querySelectorAll(
        "input[data-identity-proposal-field]:checked:not(:disabled)",
      ),
    ].map((input) => input.dataset.identityProposalField),
  );
  const changes = selectedChanges(state.proposals, selectedFields);
  if (!Object.keys(changes).length) return;

  const button = ui.proposalPanel.querySelector("#identity-apply-proposals");
  if (button) button.disabled = true;
  setStatus("Mise à jour de la structure dans Grist…");
  try {
    const result = await applyEnrichmentChanges(
      row.id,
      changes,
      state.mappings,
      {
        verifiedIdentity:
          state.decision?.status === IDENTITY_STATES.MATCH_VERIFIED,
        positionSiret: state.candidate?.siret,
        publicSitePosition:
          state.candidate?.identityScope === "PUBLIC_SITE"
            ? state.candidate.position
            : null,
        expectedRow: state.analyzedRow,
      },
    );
    state.snapshot = result.snapshot;
    const skippedMessage = result.skipped.length
      ? ` Champs ignorés : ${result.skipped.join(", ")}.`
      : "";
    const duplicateMessage = result.duplicateRowId
      ? ` Une fiche du même lieu existe aussi (ligne ${result.duplicateRowId}).`
      : "";
    setStatus(
      `Structure mise à jour.${skippedMessage}${duplicateMessage}`,
      "success",
    );
    clearNode(ui.proposalPanel);
  } catch (error) {
    console.error(error);
    setStatus(
      error.message || "Impossible de mettre à jour la structure.",
      "error",
    );
    updateApplyButton();
  }
}

async function runIdentityAnalysis({ deepening = false } = {}) {
  const row = selectedRow();
  if (!row || !canAnalyze() || state.controller) return;
  const key = [row.id, row.NomCommercial, row.Adresse, row.SirenSiret].join("|");
  const retained = state.progressKey === key ? state.progress : null;
  const retainedGuidance = state.progressKey === key ? state.guidance : null;
  const retainedVisibleCount = state.progressKey === key ? state.visibleHintCount : 5;
  resetAnalysis();
  state.visibleHintCount = retainedVisibleCount;
  state.guidance = retainedGuidance ?? emptyDiscoveryGuidance();
  state.isDeepening = deepening;
  const generation = ++state.generation;
  const controller = new AbortController();
  let settled = false;
  state.controller = controller;
  state.progressKey = key;
  state.progress = mergeDiscoveryProgress(emptyDiscoveryProgress(), retained, { reference: row, guidance: state.guidance });
  const timeout = setTimeout(() => {
    controller.abort(
      new DOMException(
        "Le délai maximal de l’analyse a été atteint.",
        "TimeoutError",
      ),
    );
  }, deepening ? 46000 : ESTABLISHMENT_BUDGET.deadlineMs);
  ui.enrichButton.disabled = true;
  setStatus(deepening ? "Recherche approfondie en cours : variantes de noms et identifiants…" : "Analyse de l’identité puis de la position du site…");
  renderDiscoveryProgress();

  try {
    const result = await resolveEstablishmentForEnrichment({
      row,
      signal: controller.signal,
      deepening,
      guidance: state.guidance,
      geocode: geocodeAddress,
      fetchOfficial: fetchOfficialRequest,
      onProgress: (checkpoint) => {
        if (settled || generation !== state.generation || controller.signal.aborted) return;
        state.progress = mergeDiscoveryProgress(state.progress, checkpoint, { reference: row, guidance: state.guidance });
        renderDiscoveryProgress();
      },
      onEvent: (event) => {
        if (settled || generation !== state.generation || controller.signal.aborted) return;
        state.progress = recordDiscoverySourceEvent(state.progress, event);
        renderDiscoveryProgress();
      },
      resolveFallback: (options) =>
        resolveStructureIdentity({
          ...options,
          findPoiLinks: findOsmIdentityPois,
        }),
    });
    settled = true;
    if (generation !== state.generation) return;

    state.decision = result.decision;
    state.candidate = result.candidate;
    state.diagnostics = result.diagnostics ?? [];
    state.trace = result.trace ?? [];
    state.analyzedRow = Object.fromEntries(
      [
        "NomCommercial",
        "RaisonSociale",
        "Adresse",
        "SirenSiret",
        "Latitude",
        "Longitude",
      ].map((field) => [field, row[field]]),
    );

    renderEstablishment();
    renderProposalPanel();

    const diagnostics = (result.diagnostics ?? []).slice(0, 2);
    const message = [result.decision?.reason, ...diagnostics]
      .filter(Boolean)
      .join(" ");
    setStatus(
      message || "Analyse terminée.",
      result.decision?.status === IDENTITY_STATES.INCOMPLETE ? "error" : "",
    );
  } catch (error) {
    settled = true;
    if (generation !== state.generation) return;
    if (
      controller.signal.reason?.name === "TimeoutError" ||
      error?.name === "TimeoutError"
    ) {
      setStatus(controller.signal.reason?.message || error.message, "error");
      renderDiscoveryProgress({ stopped: true });
      return;
    }
    if (error?.name === "AbortError") {
      setStatus("Recherche interrompue. Les pistes restent visibles ; relancez pour approfondir.");
      renderDiscoveryProgress({ stopped: true });
      if (ui.enrichButton) ui.enrichButton.textContent = "Analyser / compléter";
      return;
    }
    console.error(error);
    setStatus(
      error.message || "Impossible d’analyser cette structure.",
      "error",
    );
  } finally {
    settled = true;
    clearTimeout(timeout);
    if (generation === state.generation) {
      state.controller = null;
      ui.enrichButton.disabled = !canAnalyze();
      if (state.guidedRestart) {
        state.guidedRestart = false;
        runIdentityAnalysis({ deepening: true });
      }
    }
  }
}

ui.enrichButton?.addEventListener("click", (event) => {
  event.preventDefault();
  runIdentityAnalysis();
});

watchTable((mappings) => refreshSnapshot(mappings));
watchSelection((rowId, mappings) => {
  if (mappings && Object.keys(mappings).length) state.mappings = mappings;
  const changed = String(rowId) !== String(state.selectedRowId);
  state.selectedRowId = rowId;
  if (changed) resetAnalysis();
  refreshSnapshot(state.mappings);
});
