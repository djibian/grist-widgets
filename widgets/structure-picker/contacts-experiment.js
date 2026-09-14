import { applyEnrichmentChanges, fetchFullSnapshot } from "./grist.js";
import { availableContactSources, searchContactSources } from "./contact-search.js";
import { isExactSiretCandidate } from "./contact-model.js";
import { selectContactSuggestions } from "./contact-presentation.js";
import { identifierParts } from "./search.js";

const FIELD_CONFIG = Object.freeze([
  { logical: "Telephone", key: "telephone", label: "Téléphone" },
  { logical: "Courriel", key: "courriel", label: "Courriel" },
  { logical: "SiteWeb", key: "siteWeb", label: "Site web" },
]);

const ui = {
  searchButton: document.getElementById("contact-search"),
  applyButton: document.getElementById("contact-apply"),
  current: document.getElementById("contact-current"),
  status: document.getElementById("contact-status"),
  results: document.getElementById("contact-results"),
};

let currentRecord = null;
let currentMappings = {};
let controller = null;
let generation = 0;
let writableMappings = {};
let currentSuggestions = [];

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

function refreshApplyButton() {
  if (!ui.applyButton) return;
  ui.applyButton.disabled = !ui.results?.querySelector('input[data-contact-field]:checked:not(:disabled)');
}

function refreshAvailability() {
  renderCurrentContacts();
  clearNode(ui.results);
  currentSuggestions = [];
  writableMappings = {};
  refreshApplyButton();

  const context = currentContext();
  const sources = currentRecord && currentRecord.id !== "new" ? availableContactSources(context) : [];
  const available = sources.length > 0;
  if (ui.searchButton) ui.searchButton.disabled = !available;

  if (!currentRecord || currentRecord.id === "new") {
    setStatus("Sélectionne une structure existante pour rechercher ses contacts publics.");
  } else if (!available) {
    setStatus("Complète d’abord le SIRET ou les coordonnées de la structure avec l’analyse ci-dessus.");
  } else {
    setStatus("Prêt à rechercher les contacts publics.");
  }
}

function fieldConfig(key) {
  return FIELD_CONFIG.find(field => field.key === key);
}

function confidenceClass(confidence) {
  return confidence?.level === "very-reliable" ? "exact" : "probable";
}

function renderProvenance(provenance = []) {
  const row = document.createElement("div");
  row.className = "contact-provenance";
  const labels = [...new Set(provenance.map(source => source?.label || source?.id).filter(Boolean))];
  for (const labelText of labels) {
    const badge = document.createElement("span");
    badge.className = "contact-provenance-badge";
    badge.textContent = labelText;
    row.appendChild(badge);
  }
  return row;
}

function renderSuggestions(suggestions) {
  clearNode(ui.results);
  currentSuggestions = suggestions;

  if (!suggestions.length) {
    const empty = document.createElement("div");
    empty.className = "contact-empty";
    empty.textContent = "Aucun téléphone, courriel ou site web suffisamment fiable n’a été trouvé.";
    ui.results.appendChild(empty);
    refreshApplyButton();
    return;
  }

  for (const suggestion of suggestions) {
    const field = fieldConfig(suggestion.key);
    if (!field) continue;

    const row = document.createElement("label");
    row.className = "contact-result-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.contactField = field.logical;
    checkbox.dataset.contactKey = field.key;
    const writable = Boolean(writableMappings[field.logical]);
    checkbox.disabled = !writable;
    checkbox.checked = Boolean(isExactSiretCandidate(suggestion.candidate) && !hasText(valueOf(field.logical)) && writable);
    checkbox.addEventListener("change", refreshApplyButton);

    const main = document.createElement("div");
    main.className = "contact-result-main";

    const heading = document.createElement("div");
    heading.className = "contact-result-heading";
    const label = document.createElement("div");
    label.className = "contact-result-label";
    label.textContent = writable ? field.label : `${field.label} — non mappé ou non modifiable`;
    const confidence = document.createElement("span");
    confidence.className = `contact-confidence ${confidenceClass(suggestion.confidence)}`;
    confidence.textContent = suggestion.confidence.label;
    heading.append(label, confidence);

    const value = document.createElement("div");
    value.className = "contact-result-value";
    value.textContent = suggestion.value;

    main.append(heading, value, renderProvenance(suggestion.provenance));
    row.append(checkbox, main);
    ui.results.appendChild(row);
  }

  refreshApplyButton();
}

function selectedChanges() {
  const changes = {};
  for (const checkbox of ui.results?.querySelectorAll('input[data-contact-field]:checked:not(:disabled)') ?? []) {
    const suggestion = currentSuggestions.find(item => item.key === checkbox.dataset.contactKey);
    if (suggestion) changes[checkbox.dataset.contactField] = suggestion.value;
  }
  return changes;
}

function finalSearchStatus(suggestions, states) {
  const failures = states.filter(state => state.status === "error").length;
  if (suggestions.length) {
    return {
      message: failures ? "Contacts suffisamment fiables trouvés. Certaines sources sont indisponibles." : "Contacts suffisamment fiables trouvés.",
      type: "success",
    };
  }
  if (failures === states.length && states.length) {
    return { message: "Les sources publiques disponibles sont temporairement indisponibles.", type: "error" };
  }
  return {
    message: failures ? "Aucun contact suffisamment fiable trouvé. Certaines sources sont indisponibles." : "Aucun contact suffisamment fiable trouvé.",
    type: "",
  };
}

async function applySelectedContacts() {
  const changes = selectedChanges();
  if (!Object.keys(changes).length) return;
  ui.applyButton.disabled = true;
  setStatus("Mise à jour des contacts dans Grist…");
  try {
    await applyEnrichmentChanges(currentRecord.id, changes, currentMappings);
    setStatus("Contacts mis à jour. Vérifie les valeurs dans Grist.", "success");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Impossible de mettre à jour les contacts.", "error");
  } finally {
    refreshApplyButton();
  }
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
  currentSuggestions = [];
  refreshApplyButton();
  setStatus("Recherche des contacts publics…");

  try {
    const snapshot = await fetchFullSnapshot(currentMappings);
    if (requestGeneration !== generation) return;
    writableMappings = snapshot.writableMappings ?? {};

    const result = await searchContactSources(context, { signal: controller.signal, sources });
    if (requestGeneration !== generation) return;

    const suggestions = selectContactSuggestions(result.candidates, context);
    renderSuggestions(suggestions);
    const finalStatus = finalSearchStatus(suggestions, result.states);
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
ui.applyButton?.addEventListener("click", applySelectedContacts);

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
