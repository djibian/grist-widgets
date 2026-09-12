import {
  DEFAULT_DEPARTMENTS,
  departmentInfo,
  formatDepartmentCodes,
  getActiveDepartments,
  normalizeDepartments,
  searchDepartments,
  setActiveDepartments,
} from "./departments.js";

const OPTION_KEY = "departments";

const ui = {
  open: document.getElementById("department-settings-open"),
  openLabel: document.getElementById("department-settings-label"),
  panel: document.getElementById("department-settings"),
  selected: document.getElementById("department-selected"),
  search: document.getElementById("department-search"),
  results: document.getElementById("department-results"),
  status: document.getElementById("department-config-status"),
  save: document.getElementById("department-save"),
  cancel: document.getElementById("department-cancel"),
};

let savedDepartments = [...DEFAULT_DEPARTMENTS];
let draftDepartments = [...savedDepartments];

function clearNode(node) {
  node?.replaceChildren();
}

function setStatus(message = "", type = "") {
  if (!ui.status) return;
  ui.status.textContent = message;
  ui.status.className = "substatus";
  if (type) ui.status.classList.add(type);
}

function updateOpenLabel() {
  if (!ui.openLabel) return;
  ui.openLabel.textContent = `Départements · ${formatDepartmentCodes(savedDepartments)}`;
}

function renderSelected() {
  clearNode(ui.selected);
  for (const code of draftDepartments) {
    const info = departmentInfo(code);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gw-button gw-button--secondary";
    button.textContent = `${code} · ${info?.name ?? code} ×`;
    button.title = `Retirer ${info?.name ?? code}`;
    button.addEventListener("click", () => {
      draftDepartments = draftDepartments.filter(value => value !== code);
      renderSelected();
      renderResults();
      if (!draftDepartments.length) setStatus("Ajoute au moins un département avant d'enregistrer.", "error");
      else setStatus("");
      if (ui.save) ui.save.disabled = !draftDepartments.length;
    });
    ui.selected?.appendChild(button);
  }
  if (!draftDepartments.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Aucun département sélectionné.";
    ui.selected?.appendChild(empty);
  }
  if (ui.save) ui.save.disabled = !draftDepartments.length;
}

function renderResults() {
  clearNode(ui.results);
  const query = ui.search?.value ?? "";
  if (!query.trim()) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Recherche par numéro ou nom de département.";
    ui.results?.appendChild(empty);
    return;
  }

  const matches = searchDepartments(query, { exclude: draftDepartments, limit: 10 });
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Aucun autre département correspondant.";
    ui.results?.appendChild(empty);
    return;
  }

  for (const item of matches) {
    const card = document.createElement("article");
    card.className = "result-card";
    const content = document.createElement("div");
    const name = document.createElement("div");
    name.className = "result-name";
    name.textContent = `${item.code} — ${item.name}`;
    content.appendChild(name);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "button button-secondary";
    add.textContent = "Ajouter";
    add.addEventListener("click", () => {
      draftDepartments = normalizeDepartments([...draftDepartments, item.code], []);
      if (ui.search) ui.search.value = "";
      setStatus("");
      renderSelected();
      renderResults();
    });
    card.append(content, add);
    ui.results?.appendChild(card);
  }
}

function openSettings() {
  draftDepartments = getActiveDepartments();
  if (ui.search) ui.search.value = "";
  setStatus("");
  renderSelected();
  renderResults();
  if (ui.panel) ui.panel.hidden = false;
  ui.open?.setAttribute("aria-expanded", "true");
  ui.search?.focus();
}

function closeSettings() {
  if (ui.panel) ui.panel.hidden = true;
  ui.open?.setAttribute("aria-expanded", "false");
  setStatus("");
}

function applyOptions(options) {
  const next = normalizeDepartments(options?.[OPTION_KEY], DEFAULT_DEPARTMENTS);
  savedDepartments = next;
  setActiveDepartments(next);
  updateOpenLabel();
  if (!ui.panel?.hidden) {
    draftDepartments = [...next];
    renderSelected();
    renderResults();
  }
}

async function saveSettings() {
  if (!draftDepartments.length) {
    setStatus("Ajoute au moins un département avant d'enregistrer.", "error");
    return;
  }
  if (ui.save) ui.save.disabled = true;
  setStatus("Enregistrement dans les options du widget…");
  try {
    const next = normalizeDepartments(draftDepartments, DEFAULT_DEPARTMENTS);
    await grist.setOption(OPTION_KEY, next);
    applyOptions({ [OPTION_KEY]: next });
    closeSettings();
  } catch (error) {
    console.error(error);
    setStatus("Impossible d'enregistrer les départements dans les options Grist.", "error");
    if (ui.save) ui.save.disabled = false;
  }
}

ui.open?.addEventListener("click", openSettings);
ui.cancel?.addEventListener("click", closeSettings);
ui.save?.addEventListener("click", saveSettings);
ui.search?.addEventListener("input", renderResults);
ui.search?.addEventListener("keydown", event => {
  if (event.key === "Escape") closeSettings();
});

grist.onOptions(options => applyOptions(options));
updateOpenLabel();
