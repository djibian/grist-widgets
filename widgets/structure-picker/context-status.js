const status = document.getElementById("config-status");

function compactState(sourceText, classList, hidden) {
  const text = String(sourceText ?? "").trim();
  if (classList.contains("pending") || /^Connexion à Grist/.test(text)) {
    return { text: "Connexion à Grist…", kind: "pending", detail: "" };
  }
  if (classList.contains("error")) {
    if (/Mappe les champs obligatoires/.test(text)) {
      return { text: "Champs obligatoires à mapper.", kind: "error", detail: text };
    }
    if (/colonnes calculées/.test(text)) {
      return { text: "Colonnes obligatoires non modifiables.", kind: "error", detail: text };
    }
    if (/Impossible de lire la table Grist/.test(text)) {
      return { text: "Lecture Grist impossible.", kind: "error", detail: text };
    }
    return { text: "Configuration requise.", kind: "error", detail: text };
  }
  if (hidden || !text) {
    return { text: "Données Grist à jour.", kind: "success", detail: "" };
  }
  if (classList.contains("warning")) {
    return { text: "Compléments recommandés.", kind: "warning", detail: text };
  }
  return { text, kind: "success", detail: "" };
}

function renderCompactState() {
  if (!status || status.classList.contains("context-state-normalized")) return;
  const state = compactState(status.textContent, status.classList, status.hidden);
  status.hidden = false;
  status.textContent = state.text;
  status.className = `configuration context-configuration ${state.kind} context-state-normalized`;
  status.style.color = state.kind === "success" ? "var(--gw-color-success)" : "";
  if (state.detail && state.detail !== state.text) status.title = state.detail;
  else status.removeAttribute("title");
}

if (status) {
  new MutationObserver(renderCompactState).observe(status, {
    attributes: true,
    attributeFilter: ["class", "hidden"],
    childList: true,
    characterData: true,
    subtree: true,
  });
  renderCompactState();
}
