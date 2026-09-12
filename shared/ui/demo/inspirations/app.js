const THEMES = Object.freeze({
  linear: {
    label: "Linear",
    description: "Dense, silencieux et presque sans chrome : les actions secondaires se font oublier jusqu’au survol."
  },
  vercel: {
    label: "Vercel",
    description: "Très graphique et minimal : beaucoup d’espace, traits fins, contraste net et commandes compactes."
  },
  raycast: {
    label: "Raycast",
    description: "Plus proche d’une application native : surfaces flottantes, contrôles doux et navigation segmentée."
  },
  shadcn: {
    label: "shadcn/ui",
    description: "Minimalisme web contemporain : composants sobres, arrondis mesurés et onglets ligne très lisibles."
  },
  carbon: {
    label: "Carbon",
    description: "Plus institutionnel et systématique : grille forte, angles francs et onglets très structurants."
  },
  atlassian: {
    label: "Atlassian",
    description: "Applicatif et convivial : navigation souple, actions discrètes et surfaces légèrement teintées."
  }
});

const params = new URLSearchParams(location.search);
const requested = params.get("theme");
const theme = Object.hasOwn(THEMES, requested) ? requested : "linear";
document.body.dataset.theme = theme;
document.title = `Assistant Structures — ${THEMES[theme].label}`;
document.getElementById("theme-description").textContent = `${THEMES[theme].label} · ${THEMES[theme].description}`;

document.querySelectorAll("[data-theme-link]").forEach(link => {
  const active = link.dataset.themeLink === theme;
  link.classList.toggle("active", active);
  if (active) link.setAttribute("aria-current", "page");
});

const icons = {
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M6.2 9a7 7 0 0 1 11.6-2.5L20 11M4 13l2.2 4.5A7 7 0 0 0 17.8 15"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.6a7 7 0 0 0-.7-1.7l1-1.8-2.1-2.1-1.8 1a7 7 0 0 0-1.7-.7L11 2H8l-.6 2.1a7 7 0 0 0-1.7.7l-1.8-1-2.1 2.1 1 1.8A7 7 0 0 0 2.1 10L0 10.5v3l2.1.6a7 7 0 0 0 .7 1.7l-1 1.8 2.1 2.1 1.8-1a7 7 0 0 0 1.7.7L8 22h3l.6-2.1a7 7 0 0 0 1.7-.7l1.8 1 2.1-2.1-1-1.8a7 7 0 0 0 .7-1.7Z" transform="translate(2 -0.2) scale(.83)"/></svg>'
};

document.querySelectorAll("[data-icon-button]").forEach(button => {
  button.innerHTML = icons[button.dataset.iconButton] ?? "";
});

const tabs = [...document.querySelectorAll(".tab")];
const panels = [...document.querySelectorAll(".panel")];

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(item => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    panels.forEach(panel => {
      const active = panel.dataset.panel === tab.dataset.tab;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  });
});
