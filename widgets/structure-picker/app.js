import {
  EXTERNAL_LIMIT,
  buildExternalSearchUrl,
  candidateIsAlreadyLocal,
  flattenExternalResults,
  localIdentifierSet,
  normalize,
  searchLocal,
} from "./search.js";
import {
  addCandidateSafely,
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
import { diagnoseRow } from "./enrichment.js";
import {
  formatDepartmentCodes,
  formatDepartmentScope,
  getActiveDepartments,
  onDepartmentsChanged,
} from "./departments.js";

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
  externalScopeHelp: document.getElementById("external-scope-help"),
  localCount: document.getElementById("local-count"),
  externalCount: document.getElementById("external-count"),
  selectedSummary: document.getElementById("selected-summary"),
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
  node.className = node === ui.externalStatus ? "substatus" : "status";
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
    ui.externalResults.append(emptyMessage(`Aucune nouvelle structure active trouvée dans ${formatDepartmentScope(getActiveDepartments())}.`));
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
  const departments = getActiveDepartments().join(",");
  return `${CACHE_PREFIX}${departments}:${normalize(query)}:${String(options.codePostal ?? "")}`;
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
  setStatus(ui.externalStatus, `Recherche dans l’Annuaire des Entreprises (${formatDepartmentCodes(getActiveDepartments())})…`);
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

function renderSelectedSummary() {
  clearNode(ui.selectedSummary);
  const row = selectedRow();

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
  title.textContent = row.NomCommercial || "Structure sans nom usuel";
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
    healthItem("Nom usuel", row.NomCommercial, diagnosis.hasName),
    healthItem("SIREN / SIRET", row.SirenSiret, diagnosis.hasIdentifier),
    healthItem("Raison sociale", row.RaisonSociale, diagnosis.hasLegalName),
    healthItem("Adresse", row.Adresse, diagnosis.hasAddress),
    healthItem("Coordonnées carte", diagnosis.hasCoordinates ? `${row.Latitude}, ${row.Longitude}` : "", diagnosis.hasCoordinates),
  );
  ui.selectedSummary.appendChild(grid);
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
      setStatus(ui.globalStatus, "Le widget est bloqué tant que Nom usuel, Adresse et SIREN/SIRET ne sont pas mappés vers des colonnes de données modifiables.", "error");
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
  state.selectedRowId = rowId;
  renderSelectedSummary();
}

function updateDepartmentScope() {
  if (!ui.externalScopeHelp) return;
  ui.externalScopeHelp.textContent = `Résultats actifs de l’Annuaire des Entreprises dans ${formatDepartmentScope(getActiveDepartments())}.`;
}

ui.search.addEventListener("input", scheduleSearch);
ui.manualCreate.addEventListener("click", async () => {
  try {
    await prepareManualRow();
    setStatus(ui.globalStatus, "Nouvelle ligne Grist prête pour une saisie manuelle.", "success");
  } catch (error) {
    console.error(error);
    setStatus(ui.globalStatus, "Impossible de préparer une nouvelle ligne dans Grist.", "error");
  }
});

onDepartmentsChanged(() => {
  updateDepartmentScope();
  scheduleSearch();
});
updateDepartmentScope();

setConfigured(false, "Connexion à Grist…");
initializeGrist();
watchTable(refreshFullTable);
watchSelection(selectionChanged);
