const VARIANTS = Object.freeze({
  solid: {
    label: "A · Plein",
    description: "Pictogrammes pleins et compacts, monochromes, avec une présence visuelle nettement plus forte."
  },
  bold: {
    label: "B · Épais",
    description: "Dessins très simples au trait rond épais : moins techniques, plus immédiats et plus lisibles."
  },
  duo: {
    label: "C · Bicolore",
    description: "Forme principale sombre et détail coloré pour donner du relief sans ajouter de cadre."
  },
  color: {
    label: "D · Couleur",
    description: "La couleur identifie directement l’action : bleu pour actualiser, violet pour régler."
  },
  geo: {
    label: "E · Géométrique",
    description: "Pictogrammes très synthétiques faits de formes épaisses et géométriques, presque comme des signes."
  },
  accent: {
    label: "F · Accent",
    description: "Icônes sombres et franches avec un seul petit accent coloré : discret mais moins austère."
  }
});

const ICONS = Object.freeze({
  solid: {
    refresh: '<svg class="icon-solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 1 7.2 3.6L21 4.8V11h-6.2l2-2A6.2 6.2 0 1 0 18 14h3.1A9.2 9.2 0 1 1 12 3Z"/></svg>',
    settings: '<svg class="icon-solid" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="11" height="3" rx="1.5"/><circle cx="17.5" cy="6.5" r="2.5"/><rect x="10" y="10.5" width="11" height="3" rx="1.5"/><circle cx="6.5" cy="12" r="2.5"/><rect x="3" y="16" width="9" height="3" rx="1.5"/><circle cx="15.5" cy="17.5" r="2.5"/><rect x="18" y="16" width="3" height="3" rx="1.5"/></svg>'
  },
  bold: {
    refresh: '<svg class="icon-bold" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 8.5A8 8 0 1 0 20 15"/><path d="M19.5 3.8v4.7h-4.7"/></svg>',
    settings: '<svg class="icon-bold" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h6M15 6h5M4 12h2M11 12h9M4 18h8M17 18h3"/><circle cx="12.5" cy="6" r="2"/><circle cx="8.5" cy="12" r="2"/><circle cx="14.5" cy="18" r="2"/></svg>'
  },
  duo: {
    refresh: '<svg class="icon-duo" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main" d="M12 3.2a8.8 8.8 0 1 0 8.6 10.6h-3.1A5.8 5.8 0 1 1 12 6.2a5.7 5.7 0 0 1 4.2 1.8l2.1-2.1A8.7 8.7 0 0 0 12 3.2Z"/><path class="icon-accent" d="M15.2 4.6H21v5.8l-2.1-2.1-1.1-1.1-2.6-2.6Z"/></svg>',
    settings: '<svg class="icon-duo" viewBox="0 0 24 24" aria-hidden="true"><rect class="icon-main" x="3" y="5.2" width="18" height="2.6" rx="1.3"/><rect class="icon-main" x="3" y="10.7" width="18" height="2.6" rx="1.3"/><rect class="icon-main" x="3" y="16.2" width="18" height="2.6" rx="1.3"/><circle class="icon-accent" cx="8" cy="6.5" r="2.8"/><circle class="icon-accent" cx="15.5" cy="12" r="2.8"/><circle class="icon-accent" cx="11" cy="17.5" r="2.8"/></svg>'
  },
  color: {
    refresh: '<svg class="icon-color icon-refresh-color" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 1 7.4 3.9L21 5.2V11h-5.8l1.9-1.9A6 6 0 1 0 18 15h3A9 9 0 1 1 12 3Z"/></svg>',
    settings: '<svg class="icon-color icon-settings-color" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h3v16H4V4Zm6.5 0h3v16h-3V4ZM17 4h3v16h-3V4Z"/><circle cx="5.5" cy="9" r="3.2"/><circle cx="12" cy="15" r="3.2"/><circle cx="18.5" cy="7" r="3.2"/></svg>'
  },
  geo: {
    refresh: '<svg class="icon-geo" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h7v4H7.8A5.3 5.3 0 0 0 7 12.8 5.5 5.5 0 0 0 17.4 15H22a10 10 0 0 1-19-2.2A9.7 9.7 0 0 1 5.2 6H4Z"/><path d="M20 18h-7v-4h3.2A5.3 5.3 0 0 0 17 11.2 5.5 5.5 0 0 0 6.6 9H2a10 10 0 0 1 19 2.2 9.7 9.7 0 0 1-2.2 6.8H20Z"/></svg>',
    settings: '<svg class="icon-geo" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="5" height="5" rx="1"/><rect x="10" y="5" width="11" height="3" rx="1.5"/><rect x="3" y="11" width="11" height="3" rx="1.5"/><rect x="16" y="10" width="5" height="5" rx="1"/><rect x="3" y="17" width="7" height="3" rx="1.5"/><rect x="12" y="16" width="5" height="5" rx="1"/><rect x="19" y="17" width="2" height="3" rx="1"/></svg>'
  },
  accent: {
    refresh: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main" d="M19.3 8.1A8 8 0 1 0 20 15h-3.1A5 5 0 1 1 12 7a4.9 4.9 0 0 1 3.7 1.6l-2 2H21V3.3l-1.7 1.7v3.1Z"/><circle class="icon-accent" cx="20" cy="15" r="2.1"/></svg>',
    settings: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main" d="M3 5h18v3H3V5Zm0 5.5h18v3H3v-3ZM3 16h18v3H3v-3Z"/><circle class="icon-accent" cx="8" cy="6.5" r="2.7"/><circle class="icon-accent" cx="16" cy="12" r="2.7"/><circle class="icon-accent" cx="11" cy="17.5" r="2.7"/></svg>'
  }
});

const params = new URLSearchParams(location.search);
const requested = params.get("variant");
const variant = Object.hasOwn(VARIANTS, requested) ? requested : "solid";
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
