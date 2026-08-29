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
  initializeGrist,
  prepareManualRow,
  selectRow,
  watchTable,
} from "./grist.js";

const MIN_QUERY_LENGTH = 3;
const EXTERNAL_DEBOUNCE_MS = 1200;
const CLASSROOM_JITTER_MS = 5000;
const MIN_EXTERNAL_INTERVAL_MS = 1800;
const CACHE_TTL_MS = 20 * 60 * 1000;
const CACHE_PREFIX = "structure-picker:v2:";

const ui = {
  search: document.getElementById("search"),
  manualCreate: document.getElementById("manual-create"),
  configStatus: document.getElementById("config-status"),
  globalStatus: document.getElementById("global-status"),
  localResults: document.getElementById("local-results"),
  externalResults: document.getElementById("external-results"),
  externalStatus: document.getElementById("external-status"),
  localCount: document.getElementById("local-count"),
  externalCount: document.getElementById("external-count"),
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

function setConfigured(configured, message = "", warning = "") {
  state.configured = configured;
  ui.search.disabled = !configured;
  ui.manualCreate.disabled = !configured;
  ui.configStatus.textContent = [message, warning].filter(Boolean).join(" ");
  ui.configStatus.className = `configuration ${configured ? (warning ? "warning" : "ok") : "error"}`;
}

function addMeta(container, label, value) {
  if (value === undefined || value === null || value === "") return;
  const span = document.createElement("span");
  span.textContent = `${label} : ${value}`;
  container.appendChild(span);
}

function makeCard({ name, legalName, address, identifier, identifierLabel = "SIRET", commune, ape, buttonLabel, onClick }) {
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
  if (commune && !String(address || "").toLowerCase().includes(String(commune).toLowerCase())) {
    addMeta(meta, "Commune", commune);
  }
  addMeta(meta, "APE", ape);
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
      address: row.AdresseNormalisee || row.Adresse,
      identifier: row.SirenSiret,
      identifierLabel: "SIREN/SIRET",
      commune: row.Commune,
      ape: row.APE,
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
  return candidates
    .filter(candidate => !candidateIsAlreadyLocal(candidate, existing))
    .slice(0, EXTERNAL_LIMIT);
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
      ape: candidate.ape,
      buttonLabel: "Ajouter",
      onClick: button => addExternal(candidate, button),
    }));
  }
}

function cacheKey(query) {
  return `${CACHE_PREFIX}${normalize(query)}`;
}

function readCache(query) {
  try {
    const raw = sessionStorage.getItem(cacheKey(query));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.at || !Array.isArray(entry.items) || Date.now() - entry.at > CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKey(query));
      return null;
    }
    return entry.items;
  } catch {
    return null;
  }
}

function writeCache(query, items) {
  try {
    sessionStorage.setItem(cacheKey(query), JSON.stringify({ at: Date.now(), items }));
  } catch {
    // Le cache est un confort, jamais une dépendance fonctionnelle.
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

async function fetchExternal(query, signal) {
  const cached = readCache(query);
  if (cached) return { items: cached, cached: true };

  const now = Date.now();
  const intervalWait = Math.max(0, state.lastExternalRequestAt + MIN_EXTERNAL_INTERVAL_MS - now);
  const backoffWait = Math.max(0, state.backoffUntil - now);
  await waitWithAbort(Math.max(intervalWait, backoffWait), signal);

  state.lastExternalRequestAt = Date.now();
  const response = await fetch(buildExternalSearchUrl(query), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });

  if (response.status === 429) {
    const delay = retryDelayMs(response);
    state.backoffUntil = Date.now() + delay;
    throw new Error(`L'Annuaire limite temporairement les requêtes. Réessaie dans ${Math.ceil(delay / 1000)} s.`);
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.erreur ? ` : ${body.erreur}` : "";
    } catch {
      // Pas de corps JSON exploitable.
    }
    throw new Error(`Recherche externe indisponible (HTTP ${response.status})${detail}`);
  }

  const payload = await response.json();
  const items = flattenExternalResults(payload, new Set(), EXTERNAL_LIMIT);
  writeCache(query, items);
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
    ui.externalResults.append(emptyMessage("À partir de 3 caractères, la recherche externe complète la recherche Grist."));
    return;
  }

  setStatus(ui.externalStatus, "Recherche externe programmée…");
  const classroomJitter = Math.floor(Math.random() * CLASSROOM_JITTER_MS);
  state.timer = setTimeout(
    () => runExternalSearch(query, generation),
    EXTERNAL_DEBOUNCE_MS + classroomJitter,
  );
}

async function addExternal(candidate, button) {
  button.textContent = "Vérification…";
  setStatus(ui.globalStatus, "Vérification du SIREN/SIRET dans la table complète Grist…");
  try {
    const result = await addCandidateSafely(candidate, state.mappings);
    state.snapshot = result.snapshot;
    if (result.status === "created") {
      setStatus(ui.globalStatus, `${candidate.nomCommercial} a été ajoutée à Grist.`, "success");
    } else if (result.reconciled) {
      setStatus(ui.globalStatus, "Un ajout concurrent a été détecté : le doublon a été supprimé et la structure existante sélectionnée.", "success");
    } else {
      setStatus(ui.globalStatus, "Cette structure existait déjà : elle a été sélectionnée sans créer de doublon.", "success");
    }
    scheduleSearch();
  } catch (error) {
    console.error(error);
    setStatus(ui.globalStatus, error.message || "Impossible d'ajouter la structure.", "error");
  } finally {
    button.textContent = "Ajouter";
  }
}

async function refreshFullTable(mappings) {
  state.mappings = mappings ?? {};
  const generation = ++state.refreshGeneration;
  try {
    const snapshot = await fetchFullSnapshot(state.mappings);
    if (generation !== state.refreshGeneration) return;
    state.snapshot = snapshot;

    const blocking = snapshot.missing.length || snapshot.nonWritableRequired.length;
    if (blocking) {
      setConfigured(false, configurationMessage(snapshot));
      setStatus(
        ui.globalStatus,
        "Le widget est bloqué tant que Nom commercial, Adresse et SIREN/SIRET ne sont pas mappés vers des colonnes de données modifiables.",
        "error",
      );
    } else {
      const warning = configurationWarning(snapshot);
      setConfigured(
        true,
        `Configuration valide — ${snapshot.rows.length} structure${snapshot.rows.length > 1 ? "s" : ""} indexée${snapshot.rows.length > 1 ? "s" : ""} depuis la table complète.`,
        warning,
      );
      if (ui.globalStatus.classList.contains("error")) setStatus(ui.globalStatus, "");
    }
    scheduleSearch();
  } catch (error) {
    console.error(error);
    setConfigured(false, "Impossible de lire la table Grist complète.");
    setStatus(ui.globalStatus, error.message || "Erreur de lecture Grist.", "error");
  }
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

setConfigured(false, "Connexion à Grist…");
initializeGrist();
watchTable(refreshFullTable);
