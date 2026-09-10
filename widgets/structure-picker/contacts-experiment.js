import { applyEnrichmentChanges, fetchFullSnapshot } from "./grist.js";
import { findOsmContacts } from "./osm.js";
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
  const rawLatitude = valueOf("Latitude");
  const rawLongitude = valueOf("Longitude");
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  const hasCoordinates = hasText(rawLatitude) && hasText(rawLongitude) && Number.isFinite(latitude) && Number.isFinite(longitude);
  return {
    siret: identifier.siret,
    name,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
  };
}

function canSearch(context) {
  return Boolean(context.siret || (context.name && Number.isFinite(context.latitude) && Number.isFinite(context.longitude)));
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

function refreshAvailability() {
  renderCurrentContacts();
  clearNode(ui.results);
  writableMappings = {};
  const context = currentContext();
  const available = Boolean(currentRecord && currentRecord.id !== "new" && canSearch(context));
  if (ui.searchButton) ui.searchButton.disabled = !available;

  if (!currentRecord || currentRecord.id === "new") {
    setStatus("Sélectionne une structure existante pour tester la recherche de contacts.");
  } else if (!available) {
    setStatus("Pour tester les contacts, complète d’abord le SIRET ou les coordonnées de la structure avec l’analyse ci-dessus.");
  } else {
    setStatus("");
  }
}

function confidenceText(candidate) {
  return candidate.confidence === "siret" ? "Correspondance SIRET" : "Correspondance probable";
}

function makeContactLine(field, candidate, cardIndex) {
  const proposed = candidate[field.key];
  if (!proposed) return null;

  const current = valueOf(field.logical);
  const writable = Boolean(writableMappings[field.logical]);
  const row = document.createElement("label");
  row.className = "contact-field-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.contactField = field.logical;
  checkbox.dataset.contactCard = String(cardIndex);
  checkbox.checked = Boolean(candidate.confidence === "siret" && !hasText(current) && writable);
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
    if (checkbox && candidate[field.key]) changes[field.logical] = candidate[field.key];
  }
  return changes;
}

function renderCandidates(candidates) {
  clearNode(ui.results);
  if (!candidates.length) return;

  candidates.forEach((candidate, index) => {
    const card = document.createElement("article");
    card.className = "contact-card";

    const heading = document.createElement("div");
    heading.className = "contact-card-heading";
    const name = document.createElement("div");
    name.className = "contact-card-name";
    name.textContent = candidate.nom || String(valueOf("NomCommercial") || "Structure");
    const confidence = document.createElement("span");
    confidence.className = `contact-confidence ${candidate.confidence === "siret" ? "exact" : "nearby"}`;
    confidence.textContent = confidenceText(candidate);
    heading.append(name, confidence);

    const source = document.createElement("div");
    source.className = "contact-source";
    source.textContent = candidate.source;
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

async function searchContacts() {
  if (!currentRecord || currentRecord.id === "new") return;
  const context = currentContext();
  if (!canSearch(context)) return;

  generation += 1;
  const requestGeneration = generation;
  controller?.abort();
  controller = new AbortController();
  ui.searchButton.disabled = true;
  clearNode(ui.results);
  setStatus("Recherche de contacts publics dans OpenStreetMap…");

  try {
    const snapshot = await fetchFullSnapshot(currentMappings);
    if (requestGeneration !== generation) return;
    writableMappings = snapshot.writableMappings ?? {};

    const result = await findOsmContacts({ ...context, signal: controller.signal });
    if (requestGeneration !== generation) return;
    renderCandidates(result.candidates);

    if (result.mode === "siret") {
      setStatus("Contact public trouvé avec le même SIRET. Les champs vides modifiables sont présélectionnés.", "success");
    } else if (result.mode === "nearby") {
      setStatus("Contact possible trouvé par proximité et similitude du nom. Rien n’est présélectionné : vérifie avant d’appliquer.");
    } else {
      setStatus("Aucun contact public suffisamment fiable trouvé dans OpenStreetMap.");
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    setStatus(error.message || "Recherche de contacts indisponible.", "error");
  } finally {
    if (requestGeneration === generation) ui.searchButton.disabled = !canSearch(currentContext());
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
