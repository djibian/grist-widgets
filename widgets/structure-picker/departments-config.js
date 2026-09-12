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

function node(tagName, { id = "", className = "", text = "", type = "" } = {}) {
  const element = document.createElement(tagName);
  if (id) element.id = id;
  if (className) element.className = className;
  if (text) element.textContent = text;
  if (type) element.type = type;
  return element;
}

function ensureSettingsUi() {
  const externalTitle = document.getElementById("external-title");
  const externalHelp = externalTitle?.parentElement?.querySelector(".gw-step-heading__help");
  if (externalHelp && !externalHelp.id) externalHelp.id = "external-scope-help";

  const header = document.querySelector(".gw-widget-header");
  if (header && !document.getElementById("department-settings-open")) {
    let tools = header.querySelector(".gw-widget-tools");
    if (!tools) {
      tools = node("div", { className: "gw-widget-tools" });
      header.appendChild(tools);
    }
    const open = node("button", { id: "department-settings-open", className: "gw-tool-button", type: "button" });
    open.setAttribute("aria-controls", "department-settings");
    open.setAttribute("aria-expanded", "false");
    const icon = node("span", { text: "⚙" });
    icon.setAttribute("aria-hidden", "true");
    const label = node("span", { id: "department-settings-label", className: "gw-tool-button__label", text: "Départements" });
    open.append(icon, label);
    tools.appendChild(open);
  }

  if (!document.getElementById("department-settings")) {
    const panel = node("section", { id: "department-settings", className: "gw-work-grid" });
    panel.hidden = true;
    panel.setAttribute("aria-labelledby", "department-settings-title");

    const main = node("section", { className: "gw-work-main" });
    const mainHeading = node("div", { className: "gw-step-heading" });
    mainHeading.append(
      node("span", { className: "gw-step-heading__index", text: "Configuration" }),
      node("h2", { id: "department-settings-title", className: "gw-step-heading__title", text: "Départements recherchés" }),
      node("p", { className: "gw-step-heading__help", text: "Ces départements limitent les recherches dans l’Annuaire des Entreprises et prépareront le chargement des futurs index locaux." }),
    );
    const selected = node("div", { id: "department-selected", className: "meta" });
    selected.setAttribute("aria-live", "polite");
    const searchLabel = node("label", { className: "search-label", text: "Ajouter un département" });
    searchLabel.htmlFor = "department-search";
    const search = node("input", { id: "department-search", className: "gw-input", type: "search" });
    search.autocomplete = "off";
    search.placeholder = "Ex. 49 ou Maine-et-Loire";
    const status = node("div", { id: "department-config-status", className: "substatus" });
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    main.append(mainHeading, selected, searchLabel, search, status);

    const aside = node("aside", { className: "gw-decision-panel" });
    const asideHeading = node("div", { className: "gw-step-heading" });
    asideHeading.append(
      node("span", { className: "gw-step-heading__index", text: "Ajouter / retirer" }),
      node("h2", { className: "gw-step-heading__title", text: "Résultats" }),
      node("p", { className: "gw-step-heading__help", text: "Recherche par numéro ou nom. Au moins un département doit rester sélectionné." }),
    );
    const results = node("div", { id: "department-results", className: "results" });
    const footer = node("div", { className: "tab-footer" });
    footer.append(
      node("button", { id: "department-cancel", className: "gw-button gw-button--secondary", text: "Annuler", type: "button" }),
      node("button", { id: "department-save", className: "gw-button gw-button--primary", text: "Enregistrer", type: "button" }),
    );
    aside.append(asideHeading, results, footer);
    panel.append(main, aside);

    const context = document.querySelector(".gw-context-strip");
    if (context) context.insertAdjacentElement("afterend", panel);
    else document.querySelector(".app")?.prepend(panel);
  }
}

ensureSettingsUi();

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

function clearNode(nodeToClear) {
  nodeToClear?.replaceChildren();
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
    const button = node("button", { className: "gw-button gw-button--secondary", type: "button", text: `${code} · ${info?.name ?? code} ×` });
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
  if (!draftDepartments.length) ui.selected?.appendChild(node("div", { className: "empty", text: "Aucun département sélectionné." }));
  if (ui.save) ui.save.disabled = !draftDepartments.length;
}

function renderResults() {
  clearNode(ui.results);
  const query = ui.search?.value ?? "";
  if (!query.trim()) {
    ui.results?.appendChild(node("div", { className: "empty", text: "Recherche par numéro ou nom de département." }));
    return;
  }

  const matches = searchDepartments(query, { exclude: draftDepartments, limit: 10 });
  if (!matches.length) {
    ui.results?.appendChild(node("div", { className: "empty", text: "Aucun autre département correspondant." }));
    return;
  }

  for (const item of matches) {
    const card = node("article", { className: "result-card" });
    const content = node("div");
    content.appendChild(node("div", { className: "result-name", text: `${item.code} — ${item.name}` }));
    const add = node("button", { className: "button button-secondary", type: "button", text: "Ajouter" });
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
