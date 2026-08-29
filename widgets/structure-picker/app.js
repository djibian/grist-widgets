import {
  EXTERNAL_LIMIT,
  buildExternalSearchUrl,
  candidateIsAlreadyLocal,
  candidateMatchesIdentifier,
  flattenExternalResults,
  localIdentifierSet,
  normalize,
  searchLocal,
} from "./search.js";
import {
  addCandidateSafely,
  applyEnrichmentChanges,
  configurationMessage,
  configurationWarning,
  fetchFullSnapshot,
  findRowById,
  initializeGrist,
  prepareManualRow,
  selectRow,
  watchSelection,
  watchTable,
} from "./grist.js";
import { geocodeAddress } from "./geocode.js";
import {
  buildEnrichmentProposals,
  diagnoseRow,
  enterpriseSearchContext,
  selectedChanges,
} from "./enrichment.js";

const MIN_QUERY_LENGTH = 3;
const EXTERNAL_DEBOUNCE_MS = 1200;
const CLASSROOM_JITTER_MS = 5000;
const MIN_EXTERNAL_INTERVAL_MS = 1800;
const CACHE_TTL_MS = 20 * 60 * 1000;
const CACHE_PREFIX = "structure-assistant:v1:";

const ui = {
  search: document.getElementById("search"),
  manualCreate: document.getElementById("manual-create"),
  configStatus: document.getElementById("config-status"),
  tableCounter: document.getElementById("table-counter"),
  tableCount: document.getElementById("table-count"),
  globalStatus: document.getElementById("global-status"),
  localResults: document.getElementById("local-results"),
  externalResults: document.getElementById("external-results"),
  externalStatus: document.getElementById("external-status"),
  localCount: document.getElementById("local-count"),
  externalCount: document.getElementById("external-count"),
  enrichButton: document.getElementById("enrich-button"),
  selectedSummary: document.getElementById("selected-summary"),
  enrichStatus: document.getElementById("enrich-status"),
  enterpriseChoices: document.getElementById("enterprise-choices"),
  geocodeChoices: document.getElementById("geocode-choices"),
  proposalPanel: document.getElementById("proposal-panel"),
};

const state = {
  mappings: {},
  snapshot: null,
  configured: false,
  refreshGeneration: 0,
  searchGeneration: 0,
  timer: null,
  controller: null,
  lastExternalRequestAt: 0,
  backoffUntil: 0,
  selectedRowId: null,
  enrichmentGeneration: 0,
  enrichmentController: null,
  enterpriseCandidates: [],
  geocodeCandidates: [],
  selectedEnterprise: null,
  selectedGeocode: null,
  proposals: [],
};

function clearNode(node) {
  node.replaceChildren();
}

function emptyMessage(message) {
  const node = document.createElement("div");
  node.className = "empty";
  node.textContent = message;
  return node;
}

function setStatus(node, message = "", type = "") {
  node.textContent = message;
  node.className = node === ui.externalStatus || node === ui.enrichStatus ? "substatus" : "status";
  if (type) node.classList.add(type);
}

function setTableCount(count = null) {
  if (!ui.tableCounter || !ui.tableCount) return;
  if (!Number.isFinite(count)) {
    ui.tableCounter.hidden = true;
    ui.tableCount.textContent = "";
    ui.tableCounter.removeAttribute("data-tooltip");
    ui.tableCounter.removeAttribute("aria-label");
    return;
  }
  const label = `${count} structure${count > 1 ? "s" : ""} dans la table`;
  ui.tableCount.textContent = String(count);
  ui.tableCounter.dataset.tooltip = label;
  ui.tableCounter.setAttribute("aria-label", label);
  ui.tableCounter.hidden = false;
}

function setConfigured(configured, message = "", warning = "") {
  state.configured = configured;
  ui.search.disabled = !configured;
  ui.manualCreate.disabled = !configured;

  const pending = !configured && /^Connexion à Grist/.test(message);
  const notice = configured ? warning : message;
  ui.configStatus.hidden = configured && !warning;
  ui.configStatus.textContent = notice;
  ui.configStatus.className = `configuration ${pending ? "pending" : configured ? "warning" : "error"}`;
  renderSelectedSummary();
}

function addMeta(container, label, value) {
  if (value === undefined || value === null || value === "") return;
  const span = document.createElement("span");
  span.textContent = `${label} : ${value}`;
  container.appendChild(span);
}

function makeCard({ name, legalName, address, identifier, identifierLabel = "SIRET", commune, buttonLabel, onClick }) {
  const card = document.createElement("article");
  card.className = "result-card";
  const content = document.createElement("div");
  const title = document.createElement("div");
  title.className = "result-name";
  title.textContent = name || legalName || "Structure sans nom";
  content.appendChild(title);

  if (legalName && normalize(legalName) !== normalize(name)) {
    const legal = document.createElement("div");
    legal.className = "result-legal";
    legal.textContent = legalName;
    content.appendChild(legal);
  }
  if (address) {
    const addressNode = document.createElement("div");
    addressNode.className = "result-address";
    addressNode.textContent = address;
    content.appendChild(addressNode);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  addMeta(meta, identifierLabel, identifier);
  if (commune && !String(address || "").toLowerCase().includes(String(commune).toLowerCase())) addMeta(meta, "Commune", commune);
  content.appendChild(meta);

  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${buttonLabel === "Ajouter" ? "button-primary" : "button-secondary"}`;
  button.textContent = buttonLabel;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await onClick(button);
    } finally {
      button.disabled = false;
    }
  });
  card.append(content, button);
  return card;
}

function localRows() {
  return state.snapshot?.rows ?? [];
}

function selectedRow() {
  if (!state.snapshot || !state.selectedRowId || state.selectedRowId === "new") return null;
  return findRowById(state.snapshot, state.selectedRowId);
}

function renderLocal(query) {
  clearNode(ui.localResults);
  ui.localCount.textContent = "";
  if (!state.configured) {
    ui.localResults.append(emptyMessage("Configure d'abord les colonnes indispensables."));
    return [];
  }
  if (normalize(query).length < 2) {
    ui.localResults.append(emptyMessage("Saisis au moins 2 caractères pour rechercher dans Grist."));
    return [];
  }

  const results = searchLocal(localRows(), query);
  ui.localCount.textContent = results.length ? `${results.length} résultat${results.length > 1 ? "s" : ""}` : "";
  if (!results.length) {
    ui.localResults.append(emptyMessage("Aucune structure correspondante dans la table complète Grist."));
    return results;
  }

  for (const row of results) {
    ui.localResults.append(makeCard({
      name: row.NomCommercial,
      legalName: row.RaisonSociale,
      address: row.Adresse,
      identifier: row.SirenSiret,
      identifierLabel: "SIREN/SIRET",
      commune: row.Commune,
      buttonLabel: "Ouvrir",
      onClick: async () => {
        await selectRow(row.id);
        setStatus(ui.globalStatus, "Structure sélectionnée dans Grist.", "success");
      },
    }));
  }
  return results;
}

function filterAgainstCurrentTable(candidates) {
  const existing = localIdentifierSet(localRows());
  return candidates.filter(candidate => !candidateIsAlreadyLocal(candidate, existing)).slice(0, EXTERNAL_LIMIT);
}

function renderExternal(candidates) {
  clearNode(ui.externalResults);
  const results = filterAgainstCurrentTable(candidates);
  ui.externalCount.textContent = results.length ? `${results.length} résultat${results.length > 1 ? "s" : ""}` : "";
  if (!results.length) {
    ui.externalResults.append(emptyMessage("Aucune nouvelle structure active trouvée en Loire-Atlantique ou Vendée."));
    return;
  }

  for (const candidate of results) {
    ui.externalResults.append(makeCard({
      name: candidate.nomCommercial,
      legalName: candidate.raisonSociale,
      address: candidate.adresse,
      identifier: candidate.siret,
      commune: candidate.commune,
      buttonLabel: "Ajouter",
      onClick: button => addExternal(candidate, button),
    }));
  }
}

function cacheKey(query, options = {}) {
  return `${CACHE_PREFIX}${normalize(query)}:${String(options.codePostal ?? "")}`;
}

function readCache(query, options) {
  try {
    const raw = sessionStorage.getItem(cacheKey(query, options));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.at || !Array.isArray(entry.items) || Date.now() - entry.at > CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKey(query, options));
      return null;
    }
    return entry.items;
  } catch {
    return null;
  }
}

function writeCache(query, options, items) {
  try {
    sessionStorage.setItem(cacheKey(query, options), JSON.stringify({ at: Date.now(), items }));
  } catch {
    // Le cache reste un confort.
  }
}

function waitWithAbort(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function retryDelayMs(response) {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) return 5000;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 5000;
}

async function fetchExternal(query, signal, options = {}) {
  const cached = readCache(query, options);
  if (cached) return { items: cached, cached: true };

  const now = Date.now();
  const intervalWait = Math.max(0, state.lastExternalRequestAt + MIN_EXTERNAL_INTERVAL_MS - now);
  const backoffWait = Math.max(0, state.backoffUntil - now);
  await waitWithAbort(Math.max(intervalWait, backoffWait), signal);
  state.lastExternalRequestAt = Date.now();

  const response = await fetch(buildExternalSearchUrl(query, options), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (response.status === 429) {
    const delay = retryDelayMs(response);
    state.backoffUntil = Date.now() + delay;
    throw new Error(`L'Annuaire limite temporairement les requêtes. Réessaie dans ${Math.ceil(delay / 1000)} s.`);
  }
  if (!response.ok) throw new Error(`Recherche Annuaire indisponible (HTTP ${response.status}).`);

  const items = flattenExternalResults(await response.json(), new Set(), options.limit ?? EXTERNAL_LIMIT);
  writeCache(query, options, items);
  return { items, cached: false };
}

async function runExternalSearch(query, generation) {
  if (!state.configured || normalize(query).length < MIN_QUERY_LENGTH) return;
  state.controller?.abort();
  state.controller = new AbortController();
  setStatus(ui.externalStatus, "Recherche dans l’Annuaire des Entreprises (44 et 85)…");
  try {
    const { items, cached } = await fetchExternal(query, state.controller.signal);
    if (generation !== state.searchGeneration) return;
    setStatus(ui.externalStatus, cached ? "Résultats externes issus du cache de cette session." : "");
    renderExternal(items);
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    if (generation !== state.searchGeneration) return;
    setStatus(ui.externalStatus, error.message || "Recherche externe indisponible.", "error");
    clearNode(ui.externalResults);
    ui.externalResults.append(emptyMessage("La recherche dans Grist reste disponible."));
  }
}

function scheduleSearch() {
  const query = ui.search.value.trim();
  state.searchGeneration += 1;
  const generation = state.searchGeneration;
  clearTimeout(state.timer);
  state.controller?.abort();
  renderLocal(query);
  clearNode(ui.externalResults);
  ui.externalCount.textContent = "";

  if (!state.configured) {
    setStatus(ui.externalStatus, "");
    ui.externalResults.append(emptyMessage("Configure d'abord le widget."));
    return;
  }
  if (normalize(query).length < MIN_QUERY_LENGTH) {
    setStatus(ui.externalStatus, "");
    ui.externalResults.append(emptyMessage("À partir de 3 caractères, l’Annuaire complète la recherche Grist."));
    return;
  }

  setStatus(ui.externalStatus, "Recherche externe programmée…");
  const classroomJitter = Math.floor(Math.random() * CLASSROOM_JITTER_MS);
  state.timer = setTimeout(() => runExternalSearch(query, generation), EXTERNAL_DEBOUNCE_MS + classroomJitter);
}

async function addExternal(candidate, button) {
  button.textContent = "Vérification…";
  setStatus(ui.globalStatus, "Vérification du SIREN/SIRET dans la table complète Grist…");
  try {
    const result = await addCandidateSafely(candidate, state.mappings);
    state.snapshot = result.snapshot;
    if (result.status === "created") setStatus(ui.globalStatus, `${candidate.nomCommercial} a été ajoutée à Grist.`, "success");
    else if (result.reconciled) setStatus(ui.globalStatus, "Un ajout concurrent a été détecté : le doublon a été supprimé et la structure existante sélectionnée.", "success");
    else setStatus(ui.globalStatus, "Cette structure existait déjà : elle a été sélectionnée sans créer de doublon.", "success");
    renderSelectedSummary();
    scheduleSearch();
  } catch (error) {
    console.error(error);
    setStatus(ui.globalStatus, error.message || "Impossible d'ajouter la structure.", "error");
  } finally {
    button.textContent = "Ajouter";
  }
}

function healthItem(label, value, ok) {
  const item = document.createElement("div");
  item.className = `health-item ${ok ? "ok" : "missing"}`;
  const icon = document.createElement("span");
  icon.className = "health-icon";
  icon.textContent = ok ? "✓" : "!";
  const content = document.createElement("div");
  const title = document.createElement("div");
  title.className = "health-label";
  title.textContent = label;
  const detail = document.createElement("div");
  detail.className = "health-value";
  detail.textContent = ok ? String(value) : "manquant";
  content.append(title, detail);
  item.append(icon, content);
  return item;
}

function clearEnrichment() {
  state.enrichmentGeneration += 1;
  state.enrichmentController?.abort();
  state.enrichmentController = null;
  state.enterpriseCandidates = [];
  state.geocodeCandidates = [];
  state.selectedEnterprise = null;
  state.selectedGeocode = null;
  state.proposals = [];
  clearNode(ui.enterpriseChoices);
  clearNode(ui.geocodeChoices);
  clearNode(ui.proposalPanel);
  setStatus(ui.enrichStatus, "");
}

function renderSelectedSummary() {
  clearNode(ui.selectedSummary);
  const row = selectedRow();
  ui.enrichButton.disabled = !(state.configured && row && (row.NomCommercial || row.SirenSiret || row.Adresse));

  if (state.selectedRowId === "new") {
    ui.selectedSummary.append(emptyMessage("Nouvelle ligne sélectionnée : saisis d'abord les informations de base dans Grist."));
    return;
  }
  if (!row) {
    ui.selectedSummary.append(emptyMessage("Sélectionne une structure dans Grist ou ouvre-la depuis les résultats."));
    return;
  }

  const diagnosis = diagnoseRow(row);
  const title = document.createElement("div");
  title.className = "selected-title";
  title.textContent = row.NomCommercial || "Structure sans nom commercial";
  ui.selectedSummary.appendChild(title);
  if (row.Adresse) {
    const address = document.createElement("div");
    address.className = "muted";
    address.textContent = row.Adresse;
    ui.selectedSummary.appendChild(address);
  }

  const grid = document.createElement("div");
  grid.className = "health-grid";
  grid.append(
    healthItem("Nom commercial", row.NomCommercial, diagnosis.hasName),
    healthItem("SIREN / SIRET", row.SirenSiret, diagnosis.hasIdentifier),
    healthItem("Raison sociale", row.RaisonSociale, diagnosis.hasLegalName),
    healthItem("Adresse", row.Adresse, diagnosis.hasAddress),
    healthItem("Coordonnées carte", diagnosis.hasCoordinates ? `${row.Latitude}, ${row.Longitude}` : "", diagnosis.hasCoordinates),
  );
  ui.selectedSummary.appendChild(grid);
}

function makeChoiceBlock(titleText, items, selectedItem, type) {
  const fragment = document.createDocumentFragment();
  const title = document.createElement("h3");
  title.textContent = titleText;
  fragment.appendChild(title);
  const list = document.createElement("div");
  list.className = "choice-list";

  items.forEach((item, index) => {
    const label = document.createElement("label");
    label.className = "choice-card";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `${type}-choice`;
    radio.value = String(index);
    radio.checked = item === selectedItem;
    radio.addEventListener("change", () => {
      if (type === "enterprise") state.selectedEnterprise = item;
      else state.selectedGeocode = item;
      renderProposalPanel();
    });

    const content = document.createElement("div");
    const name = document.createElement("div");
    name.className = "choice-name";
    if (type === "enterprise") {
      name.textContent = item.nomCommercial || item.raisonSociale || "Établissement";
      const detail = document.createElement("div");
      detail.className = "choice-detail";
      detail.textContent = [item.raisonSociale, item.adresse, item.siret ? `SIRET ${item.siret}` : ""].filter(Boolean).join(" — ");
      content.append(name, detail);
    } else {
      name.textContent = item.adresse;
      const detail = document.createElement("div");
      detail.className = "choice-detail";
      const score = Number.isFinite(item.score) ? `score ${item.score.toFixed(2)}` : "";
      detail.textContent = [`${item.latitude}, ${item.longitude}`, score].filter(Boolean).join(" — ");
      content.append(name, detail);
    }
    label.append(radio, content);
    list.appendChild(label);
  });
  fragment.appendChild(list);
  return fragment;
}

function renderEnrichmentChoices() {
  clearNode(ui.enterpriseChoices);
  clearNode(ui.geocodeChoices);
  if (state.enterpriseCandidates.length) {
    ui.enterpriseChoices.appendChild(makeChoiceBlock("Identité officielle — Annuaire des Entreprises", state.enterpriseCandidates, state.selectedEnterprise, "enterprise"));
  }
  if (state.geocodeCandidates.length) {
    ui.geocodeChoices.appendChild(makeChoiceBlock("Localisation — Géocodage IGN", state.geocodeCandidates, state.selectedGeocode, "geocode"));
  }
}

function updateApplyButton() {
  const button = ui.proposalPanel.querySelector("#apply-proposals");
  if (!button) return;
  button.disabled = !ui.proposalPanel.querySelector("input[data-proposal-field]:checked:not(:disabled)");
}

function renderProposalPanel() {
  clearNode(ui.proposalPanel);
  const row = selectedRow();
  if (!row) return;
  state.proposals = buildEnrichmentProposals(row, state.selectedEnterprise, state.selectedGeocode);
  if (!state.proposals.length) {
    ui.proposalPanel.append(emptyMessage("Aucune modification supplémentaire à proposer avec les choix actuels."));
    return;
  }

  const title = document.createElement("h3");
  title.textContent = "Modifications proposées";
  ui.proposalPanel.appendChild(title);
  const help = document.createElement("div");
  help.className = "help";
  help.textContent = "Les champs vides sont cochés par défaut. Remplacer une valeur existante exige une validation explicite.";
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
    checkbox.dataset.proposalField = item.field;
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
  apply.id = "apply-proposals";
  apply.type = "button";
  apply.className = "button button-primary";
  apply.textContent = "Appliquer les modifications cochées";
  apply.addEventListener("click", applySelectedProposals);
  actions.appendChild(apply);
  ui.proposalPanel.appendChild(actions);
  updateApplyButton();
}

async function runEnrichment() {
  const row = selectedRow();
  if (!state.configured || !row) return;
  clearEnrichment();
  const generation = ++state.enrichmentGeneration;
  state.enrichmentController = new AbortController();
  const signal = state.enrichmentController.signal;
  ui.enrichButton.disabled = true;
  setStatus(ui.enrichStatus, "Analyse de la structure sélectionnée…");

  try {
    let geocodeCandidates = [];
    if (String(row.Adresse ?? "").trim()) {
      try {
        geocodeCandidates = await geocodeAddress(row.Adresse, { signal, limit: 3 });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        console.warn(error);
      }
    }
    if (generation !== state.enrichmentGeneration) return;
    state.geocodeCandidates = geocodeCandidates;
    state.selectedGeocode = geocodeCandidates[0] ?? null;

    const context = enterpriseSearchContext(row, state.selectedGeocode);
    let enterpriseCandidates = [];
    if (context.query) {
      const options = { perPage: 6, matchingLimit: 10, codePostal: context.codePostal, limit: 10 };
      let response = await fetchExternal(context.query, signal, options);
      enterpriseCandidates = response.items;
      if (!enterpriseCandidates.length && context.codePostal) {
        response = await fetchExternal(context.query, signal, { ...options, codePostal: "" });
        enterpriseCandidates = response.items;
      }
    }
    if (generation !== state.enrichmentGeneration) return;

    state.enterpriseCandidates = enterpriseCandidates;
    state.selectedEnterprise = enterpriseCandidates.find(candidate => candidateMatchesIdentifier(candidate, row.SirenSiret))
      ?? (enterpriseCandidates.length === 1 ? enterpriseCandidates[0] : null);
    renderEnrichmentChoices();
    renderProposalPanel();

    const messages = [];
    if (!enterpriseCandidates.length) messages.push("Aucune identité officielle certaine trouvée.");
    else if (!state.selectedEnterprise) messages.push("Choisis l’établissement correspondant dans l’Annuaire.");
    if (!geocodeCandidates.length && row.Adresse) messages.push("Aucune proposition de géocodage trouvée.");
    else if (geocodeCandidates.length) messages.push("Vérifie la proposition de localisation avant de remplacer l’adresse.");
    setStatus(ui.enrichStatus, messages.join(" ") || "Des compléments sont disponibles.");
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    setStatus(ui.enrichStatus, error.message || "Impossible d'analyser cette structure.", "error");
  } finally {
    if (generation === state.enrichmentGeneration) ui.enrichButton.disabled = !selectedRow();
  }
}

async function applySelectedProposals() {
  const row = selectedRow();
  if (!row) return;
  const selectedFields = new Set(
    [...ui.proposalPanel.querySelectorAll("input[data-proposal-field]:checked:not(:disabled)")].map(input => input.dataset.proposalField),
  );
  const changes = selectedChanges(state.proposals, selectedFields);
  if (!Object.keys(changes).length) return;

  const button = ui.proposalPanel.querySelector("#apply-proposals");
  if (button) button.disabled = true;
  setStatus(ui.enrichStatus, "Mise à jour de la structure dans Grist…");
  try {
    const result = await applyEnrichmentChanges(row.id, changes, state.mappings);
    state.snapshot = result.snapshot;
    const skippedMessage = result.skipped.length ? ` Champs ignorés : ${result.skipped.join(", ")}.` : "";
    setStatus(ui.enrichStatus, `Structure mise à jour.${skippedMessage}`, "success");
    renderSelectedSummary();
    scheduleSearch();
    state.proposals = [];
    clearNode(ui.proposalPanel);
  } catch (error) {
    console.error(error);
    setStatus(ui.enrichStatus, error.message || "Impossible de mettre à jour la structure.", "error");
    updateApplyButton();
  }
}

async function refreshFullTable(mappings) {
  state.mappings = mappings ?? state.mappings ?? {};
  const generation = ++state.refreshGeneration;
  try {
    const snapshot = await fetchFullSnapshot(state.mappings);
    if (generation !== state.refreshGeneration) return;
    state.snapshot = snapshot;
    setTableCount(snapshot.rows.length);
    const blocking = snapshot.missing.length || snapshot.nonWritableRequired.length;
    if (blocking) {
      setConfigured(false, configurationMessage(snapshot));
      setStatus(ui.globalStatus, "Le widget est bloqué tant que Nom commercial, Adresse et SIREN/SIRET ne sont pas mappés vers des colonnes de données modifiables.", "error");
    } else {
      setConfigured(true, "", configurationWarning(snapshot));
      if (ui.globalStatus.classList.contains("error")) setStatus(ui.globalStatus, "");
    }
    renderSelectedSummary();
    scheduleSearch();
  } catch (error) {
    console.error(error);
    state.snapshot = null;
    setTableCount(null);
    setConfigured(false, "Impossible de lire la table Grist complète.");
    setStatus(ui.globalStatus, error.message || "Erreur de lecture Grist.", "error");
  }
}

function selectionChanged(rowId, mappings) {
  if (mappings && Object.keys(mappings).length) state.mappings = mappings;
  const changed = String(rowId) !== String(state.selectedRowId);
  state.selectedRowId = rowId;
  if (changed) clearEnrichment();
  renderSelectedSummary();
}

ui.search.addEventListener("input", scheduleSearch);
ui.enrichButton.addEventListener("click", runEnrichment);
ui.manualCreate.addEventListener("click", async () => {
  try {
    await prepareManualRow();
    setStatus(ui.globalStatus, "Nouvelle ligne Grist prête pour une saisie manuelle.", "success");
  } catch (error) {
    console.error(error);
    setStatus(ui.globalStatus, "Impossible de préparer une nouvelle ligne dans Grist.", "error");
  }
});

setConfigured(false, "Connexion à Grist…");
initializeGrist();
watchTable(refreshFullTable);
watchSelection(selectionChanged);
