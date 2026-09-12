const VARIANTS = Object.freeze({
  bare: {
    label: "A · Icônes nues",
    description: "Aucun cadre au repos : les commandes existent surtout par leurs pictogrammes et le survol."
  },
  soft: {
    label: "B · Soft",
    description: "Petites surfaces gris très clair, angles doux et icônes de synchronisation / réglage par curseurs."
  },
  outline: {
    label: "C · Contour",
    description: "Boutons compacts à bordure fine, avec une icône d’actualisation circulaire et une roue dentée."
  },
  segment: {
    label: "D · Segment",
    description: "Les deux commandes forment un unique contrôle segmenté très compact."
  },
  floating: {
    label: "E · Flottantes",
    description: "Deux boutons circulaires légèrement surélevés, plus tactiles sans alourdir l’en-tête."
  },
  labeled: {
    label: "F · Icône + texte",
    description: "Les pictogrammes restent présents mais sont accompagnés de libellés courts pour maximiser l’évidence."
  }
});

const ICONS = Object.freeze({
  bare: {
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66L20 8"/><path d="M20 3v5h-5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h7M15 6h5M4 12h3M11 12h9M4 18h9M17 18h3"/><circle cx="13" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/></svg>'
  },
  soft: {
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 3 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 21-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v16M12 4v16M18 4v16"/><circle cx="6" cy="9" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="18" cy="7" r="2"/></svg>'
  },
  outline: {
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1a1.7 1.7 0 0 0-.4-1.1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 3.8 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.1a1.7 1.7 0 0 0 1.1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.2 3.8a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4v.1a1.7 1.7 0 0 0 .4 1.1 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.2a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.1.4 1.7 1.7 0 0 0-.6 1Z"/></svg>'
  },
  segment: {
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6M20 20v-6h-6"/><path d="M5.1 15a8 8 0 0 0 13.5 2.7L20 14M4 10l1.4-3.7A8 8 0 0 1 18.9 9"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/><circle cx="10" cy="12" r="2"/></svg>'
  },
  floating: {
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5"/><path d="M6.2 9a7 7 0 0 1 11.6-2.5L20 11M4 13l2.2 4.5A7 7 0 0 0 17.8 15"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h4M11 6h10M3 12h10M17 12h4M3 18h7M14 18h7"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="12" cy="18" r="2"/></svg>'
  },
  labeled: {
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M16 9h-4v4"/><path d="M15.4 9.6A5 5 0 1 0 17 14"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/><circle cx="9" cy="5" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="19" r="2"/></svg>'
  }
});

const params = new URLSearchParams(location.search);
const requested = params.get("variant");
const variant = Object.hasOwn(VARIANTS, requested) ? requested : "bare";
document.body.dataset.variant = variant;
document.title = `Assistant Structures — Linear ${VARIANTS[variant].label}`;
document.getElementById("variant-description").textContent = `${VARIANTS[variant].label} · ${VARIANTS[variant].description}`;

document.querySelectorAll("[data-variant-link]").forEach(link => {
  const active = link.dataset.variantLink === variant;
  link.classList.toggle("active", active);
  if (active) link.setAttribute("aria-current", "page");
});

document.querySelectorAll("[data-icon-button]").forEach(button => {
  const slot = button.querySelector(".action-icon");
  if (slot) slot.innerHTML = ICONS[variant][button.dataset.iconButton] ?? "";
});

const tabs = [...document.querySelectorAll(".tab")];
const panels = [...document.querySelectorAll(".panel")];

function activateTab(tab) {
  tabs.forEach(item => {
    const active = item === tab;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });
  panels.forEach(panel => {
    const active = panel.dataset.panel === tab.dataset.tab;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateTab(tab));
  tab.addEventListener("keydown", event => {
    let next = null;
    if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
    if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
    if (event.key === "Home") next = tabs[0];
    if (event.key === "End") next = tabs.at(-1);
    if (!next) return;
    event.preventDefault();
    activateTab(next);
    next.focus();
  });
});
