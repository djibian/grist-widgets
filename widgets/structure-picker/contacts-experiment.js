import { applyEnrichmentChanges, fetchFullSnapshot } from "./grist.js";
import {
  availableContactSources,
  searchContactSources,
} from "./contact-search.js";
import {
  contactSourceSummary,
  isExactSiretCandidate,
} from "./contact-model.js";
import {
  CONTACT_CONFIDENCE,
  contactConfidence,
  resolveContactCandidates,
} from "./contact-ranking.js";
import { identifierParts } from "./search.js";

const FIELD_CONFIG = Object.freeze([
  { logical: "Telephone", key: "telephone", label: "Téléphone" },
  { logical: "Courriel", key: "courriel", label: "Courriel" },
  { logical: "SiteWeb", key: "siteWeb", label: "Site web" },
]);

const ui = {
  panel: document.getElementById("contact-experiment"),
  searchButton: document.getElementById("contact-search"),
  current: document.getElementById("contact-current"),
  status: document.getElementById("contact-status"),
  sources: document.getElementById("contact-sources"),
  results: document.getElementById("contact-results"),
};

let currentRecord = null;
let currentMappings = {};
let controller = null;
let generation = 0;
let writableMappings = {};

function clearNode(node) {
  node?.replaceChildren();
}

function setStatus(message = "", type = "") {
  if (!ui.status) return;
  ui.status.textContent = message;
  ui.status.className = "substatus contact-status";
  if (type) ui.status.classList.add(type);
}

function mappedColumn(logicalName) {
  const explicit = currentMappings?.[logicalName];
  if (explicit) return explicit;
  if (currentRecord && Object.prototype.hasOwnProperty.call(currentRecord, logicalName)) return logicalName;
  return "";
}

function valueOf(logicalName) {
  const columnId = mappedColumn(logicalName);
  if (!columnId) return "";
  return currentRecord?.[columnId] ?? "";
}

function hasText(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function currentContext() {
  const identifier = identifierParts(valueOf("SirenSiret"));
  const name = String(valueOf("NomCommercial") ?? "").trim();
  const address = String(valueOf("Adresse") ?? "").trim();
  const siteWeb = String(valueOf("SiteWeb") ?? "").trim();
  const rawLatitude = valueOf("Latitude");
  const rawLongitude = valueOf("Longitude");
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  const hasCoordinates = hasText(rawLatitude) && hasText(rawLongitude) && Number.isFinite(latitude) && Number.isFinite(longitude);
  return {
    siret: identifier.siret,
    name,
    address,
    siteWeb,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
  };
}

function renderCurrentContacts() {
  clearNode(ui.current);
  if (!currentRecord || currentRecord.id === "new") return;
  const list = document.createElement("div");
  list.className = "contact-current-grid";
  for (const field of FIELD_CONFIG) {
    const item = document.createElement("div");
    item.className = "contact-current-item";
    const label = document.createElement("span");
    label.className = "contact-current-label";
    label.textContent = field.label;
    const value = document.createElement("span");
    value.className = "contact-current-value";
    value.textContent = String(valueOf(field.logical) || "—");
    item.append(label, value);
    list.appendChild(item);
  }
  ui.current.appendChild(list);
}

function renderSourceStates(states = []) {
  clearNode(ui.sources);
  if (!ui.sources || !states.length) return;

  const list = document.createElement("div");
  list.className = "contact-source-list";
  for (const state of states) {
    const item = document.createElement("span");
    const empty = state.status === "success" && state.candidateCount === 0;
    item.className = `contact-source-state ${state.status}${empty ? " empty" : ""}`;

    const label = document.createElement("strong");
    label.textContent = state.label;
    const detail = document.createElement("span");
    if (state.status === "error") {
      detail.textContent = "indisponible";
      if (state.error) item.title = state.error;
    } else if (state.candidateCount === 0) {
      detail.textContent = "aucun résultat";
    } else {
      detail.textContent = `${state.candidateCount} résultat${state.candidateCount > 1 ? "s" : ""}`;
    }
    item.append(label, detail);
    list.appendChild(item);
  }
  ui.sources.appendChild(list);
}

function refreshAvailability() {
  renderCurrentContacts();
  clearNode(ui.results);
  clearNode(ui.sources);
  writableMappings = {};
  const context = currentContext();
  const sources = currentRecord && currentRecord.id !== "new" ? availableContactSources(context) : [];
  const available = sources.length > 0;
  if (ui.searchButton) ui.searchButton.disabled = !available;

  if (!currentRecord || currentRecord.id === "new") {
    setStatus("Sélectionne une structure existante pour rechercher ses contacts publics.");
  } else if (!available) {
    setStatus("Complète d’abord le SIRET ou les coordonnées de la structure avec l’analyse ci-dessus.");
  } else {
    setStatus(`${sources.length} source${sources.length > 1 ? "s" : ""} publique${sources.length > 1 ? "s" : ""} disponible${sources.length > 1 ? "s" : ""}.`);
  }
}

function confidenceClass(candidate, context) {
  const confidence = contactConfidence(candidate, context);
  if (confidence.level === CONTACT_CONFIDENCE.VERY_RELIABLE) return "exact";
  if (confidence.level === CONTACT_CONFIDENCE.PROBABLE) return "probable";
  return "verify";
}

function candidateContact(candidate, key) {
  return candidate.contacts?.[key] ?? "";
}

function makeContactLine(field, candidate, cardIndex) {
  const proposed = candidateContact(candidate, field.key);
  if (!proposed) return null;

  const current = valueOf(field.logical);
  const writable = Boolean(writableMappings[field.logical]);
  const row = document.createElement("label");
  row.className = "contact-field-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.contactField = field.logical;
  checkbox.dataset.contactCard = String(cardIndex);
  checkbox.checked = Boolean(isExactSiretCandidate(candidate) && !hasText(current) && writable);
  checkbox.disabled = !writable;

  const content = document.createElement("div");
  const title = document.createElement("div");
  title.className = "contact-field-label";
  title.textContent = writable ? field.label : `${field.label} — non mappé ou non modifiable`;
  const currentNode = document.createElement("div");
  currentNode.className = "contact-field-current";
  currentNode.textContent = `Actuel : ${hasText(current) ? current : "—"}`;
  const proposedNode = document.createElement("div");
  proposedNode.className = "contact-field-proposed";
  proposedNode.textContent = `Proposé : ${proposed}`;
  content.append(title, currentNode, proposedNode);
  row.append(checkbox, content);
  return row;
}

function selectedChangesForCard(card, candidate) {
  const changes = {};
  for (const field of FIELD_CONFIG) {
    const checkbox = card.querySelector(`input[data-contact-field="${field.logical}"]:checked:not(:disabled)`);
    const proposed = candidateContact(candidate, field.key);
    if (checkbox && proposed) changes[field.logical] = proposed;
  }
  return changes;
}

function renderCandidateProvenance(candidate) {
  const provenance = Array.isArray(candidate?.source?.provenance) ? candidate.source.provenance : [];
  const labels = [...new Set(provenance.map(source => source?.label || source?.id).filter(Boolean))];
  const row = document.createElement("div");
  row.className = "contact-provenance";
  for (const labelText of labels) {
    const badge = document.createElement("span");
    badge.className = "contact-provenance-badge";
    badge.textContent = labelText;
    row.appendChild(badge);
  }
  return row;
}

function renderCandidates(candidates, context) {
  clearNode(ui.results);
  if (!candidates.length) return;

  candidates.forEach((candidate, index) => {
    const card = document.createElement("article");
    card.className = "contact-card";

    const heading = document.createElement("div");
    heading.className = "contact-card-heading";
    const nameBlock = document.createElement("div");
    nameBlock.className = "contact-card-identity";
    const name = document.createElement("div");
    name.className = "contact-card-name";
    name.textContent = candidate.identity?.name || String(valueOf("NomCommercial") || "Structure");
    nameBlock.append(name, renderCandidateProvenance(candidate));

    const confidence = document.createElement("span");
    confidence.className = `contact-confidence ${confidenceClass(candidate, context)}`;
    confidence.textContent = contactConfidence(candidate, context).label;
    heading.append(nameBlock, confidence);

    const source = document.createElement("div");
    source.className = "contact-source";
    source.textContent = contactSourceSummary(candidate);
    card.append(heading, source);

    const fields = document.createElement("div");
    fields.className = "contact-fields";
    for (const field of FIELD_CONFIG) {
      const line = makeContactLine(field, candidate, index);
      if (line) fields.appendChild(line);
    }
    card.appendChild(fields);

    const actions = document.createElement("div");
    actions.className = "contact-actions";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "button button-secondary";
    apply.textContent = "Appliquer les contacts cochés";
    apply.addEventListener("click", async () => {
      const changes = selectedChangesForCard(card, candidate);
      if (!Object.keys(changes).length) {
        setStatus("Coche au moins une information à appliquer.");
        return;
      }
      apply.disabled = true;
      setStatus("Mise à jour des contacts dans Grist…");
      try {
        await applyEnrichmentChanges(currentRecord.id, changes, currentMappings);
        setStatus("Contacts mis à jour. Vérifie les valeurs dans Grist.", "success");
      } catch (error) {
        console.error(error);
        setStatus(error.message || "Impossible de mettre à jour les contacts.", "error");
      } finally {
        apply.disabled = false;
      }
    });
    actions.appendChild(apply);
    card.appendChild(actions);
    ui.results.appendChild(card);
  });
}

function finalSearchStatus(candidates, states, context) {
  const failures = states.filter(state => state.status === "error").length;
  const successful = states.length - failures;
  const suffix = failures ? ` ${failures} source${failures > 1 ? "s" : ""} indisponible${failures > 1 ? "s" : ""}.` : "";

  if (candidates.length) {
    const best = contactConfidence(candidates[0], context);
    if (best.level === CONTACT_CONFIDENCE.VERY_RELIABLE) {
      return { message: `Contact très fiable trouvé. Les champs vides modifiables du meilleur candidat sont présélectionnés.${suffix}`, type: "success" };
    }
    return { message: `${candidates.length} proposition${candidates.length > 1 ? "s" : ""} classée${candidates.length > 1 ? "s" : ""} par fiabilité. Vérifie avant d’appliquer.${suffix}`, type: "" };
  }

  if (!successful && failures) return { message: "Les sources publiques disponibles sont temporairement indisponibles.", type: "error" };
  return { message: `Aucun contact public suffisamment fiable trouvé.${suffix}`, type: "" };
}

async function searchContacts() {
  if (!currentRecord || currentRecord.id === "new") return;
  const context = currentContext();
  const sources = availableContactSources(context);
  if (!sources.length) return;

  generation += 1;
  const requestGeneration = generation;
  controller?.abort();
  controller = new AbortController();
  ui.searchButton.disabled = true;
  clearNode(ui.results);
  clearNode(ui.sources);
  setStatus(`Recherche dans ${sources.length} source${sources.length > 1 ? "s" : ""} publique${sources.length > 1 ? "s" : ""}…`);

  try {
    const snapshot = await fetchFullSnapshot(currentMappings);
    if (requestGeneration !== generation) return;
    writableMappings = snapshot.writableMappings ?? {};

    const result = await searchContactSources(context, { signal: controller.signal, sources });
    if (requestGeneration !== generation) return;
    renderSourceStates(result.states);

    const candidates = resolveContactCandidates(result.candidates, context);
    renderCandidates(candidates, context);
    const finalStatus = finalSearchStatus(candidates, result.states, context);
    setStatus(finalStatus.message, finalStatus.type);
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    setStatus(error.message || "Recherche de contacts indisponible.", "error");
  } finally {
    if (requestGeneration === generation) ui.searchButton.disabled = !availableContactSources(currentContext()).length;
  }
}

ui.searchButton?.addEventListener("click", searchContacts);

grist.onRecord((record, mappings) => {
  generation += 1;
  controller?.abort();
  currentRecord = record ?? null;
  currentMappings = mappings ?? {};
  refreshAvailability();
});

grist.onNewRecord(mappings => {
  generation += 1;
  controller?.abort();
  currentRecord = { id: "new" };
  currentMappings = mappings ?? {};
  refreshAvailability();
});

refreshAvailability();
