const VARIANTS = Object.freeze({
  loop: {
    label: "A · Boucle",
    description: "Référence du cycle : flèche circulaire pleine et trois curseurs horizontaux."
  },
  sync: {
    label: "B · Synchroniser",
    description: "Deux flèches opposées pour l’actualisation et trois réglages verticaux."
  },
  orbit: {
    label: "C · Radial",
    description: "Actualisation en anneau ouvert et réglages sous forme de cadran radial."
  },
  toggle: {
    label: "D · Bascules",
    description: "Deux arcs de rotation opposés et trois interrupteurs compacts."
  },
  technical: {
    label: "E · Technique",
    description: "Cycle angulaire plus construit et égaliseur vertical pour les réglages."
  },
  minimal: {
    label: "F · Minimal",
    description: "Symboles réduits à quelques formes essentielles, avec un accent très ponctuel."
  }
});

const ICONS = Object.freeze({
  loop: {
    refresh: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main" d="M19.3 8.1A8 8 0 1 0 20 15h-3.1A5 5 0 1 1 12 7a4.9 4.9 0 0 1 3.7 1.6l-2 2H21V3.3l-1.7 1.7v3.1Z"/><circle class="icon-accent" cx="20" cy="15" r="2.1"/></svg>',
    settings: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main" d="M3 5h18v3H3V5Zm0 5.5h18v3H3v-3ZM3 16h18v3H3v-3Z"/><circle class="icon-accent" cx="8" cy="6.5" r="2.7"/><circle class="icon-accent" cx="16" cy="12" r="2.7"/><circle class="icon-accent" cx="11" cy="17.5" r="2.7"/></svg>'
  },
  sync: {
    refresh: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><rect class="icon-main" x="3" y="6" width="13" height="3" rx="1.5"/><path class="icon-accent" d="M15 3.5 21 7.5 15 11.5Z"/><rect class="icon-main" x="8" y="15" width="13" height="3" rx="1.5"/><path class="icon-accent" d="M9 12.5 3 16.5 9 20.5Z"/></svg>',
    settings: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><rect class="icon-main" x="4" y="3" width="3" height="18" rx="1.5"/><rect class="icon-main" x="10.5" y="3" width="3" height="18" rx="1.5"/><rect class="icon-main" x="17" y="3" width="3" height="18" rx="1.5"/><circle class="icon-accent" cx="5.5" cy="8" r="2.5"/><circle class="icon-accent" cx="12" cy="15.5" r="2.5"/><circle class="icon-accent" cx="18.5" cy="6.5" r="2.5"/></svg>'
  },
  orbit: {
    refresh: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main-stroke" d="M18.4 7.1A8 8 0 1 0 19.4 15"/><path class="icon-accent" d="m17.2 3.8 4.9 3.5-5.4 1.8Z"/></svg>',
    settings: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><circle class="icon-main-stroke" cx="12" cy="12" r="6"/><rect class="icon-main" x="10.6" y="2.5" width="2.8" height="4.2" rx="1.4"/><rect class="icon-main" x="10.6" y="17.3" width="2.8" height="4.2" rx="1.4"/><rect class="icon-main" x="2.5" y="10.6" width="4.2" height="2.8" rx="1.4"/><rect class="icon-main" x="17.3" y="10.6" width="4.2" height="2.8" rx="1.4"/><circle class="icon-accent" cx="12" cy="12" r="2.6"/></svg>'
  },
  toggle: {
    refresh: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main-stroke" d="M5 9a7.5 7.5 0 0 1 11.8-3.2"/><path class="icon-accent" d="m15.7 2.8 5 2.6-4.5 3.4Z"/><path class="icon-main-stroke" d="M19 15a7.5 7.5 0 0 1-11.8 3.2"/><path class="icon-accent" d="m8.3 21.2-5-2.6 4.5-3.4Z"/></svg>',
    settings: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><rect class="icon-main" x="3" y="4" width="15" height="4" rx="2"/><circle class="icon-accent" cx="16" cy="6" r="2.6"/><rect class="icon-main" x="6" y="10" width="15" height="4" rx="2"/><circle class="icon-accent" cx="8" cy="12" r="2.6"/><rect class="icon-main" x="3" y="16" width="15" height="4" rx="2"/><circle class="icon-accent" cx="16" cy="18" r="2.6"/></svg>'
  },
  technical: {
    refresh: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main" d="M4 4h11v3H7v5H4V4Zm16 16H9v-3h8v-5h3v8Z"/><path class="icon-accent" d="M14 2.8 21 5.5 14 8.2Z"/><path class="icon-accent" d="M10 15.8 3 18.5l7 2.7Z"/></svg>',
    settings: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><rect class="icon-main" x="4" y="3" width="3" height="18" rx="1.5"/><rect class="icon-main" x="10.5" y="3" width="3" height="18" rx="1.5"/><rect class="icon-main" x="17" y="3" width="3" height="18" rx="1.5"/><rect class="icon-accent" x="2.7" y="7" width="5.6" height="3" rx="1.5"/><rect class="icon-accent" x="9.2" y="13.5" width="5.6" height="3" rx="1.5"/><rect class="icon-accent" x="15.7" y="5" width="5.6" height="3" rx="1.5"/></svg>'
  },
  minimal: {
    refresh: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main-stroke icon-main-stroke--heavy" d="M18.2 7.2A8 8 0 1 0 19.2 15"/><circle class="icon-accent" cx="18.4" cy="6.8" r="2.2"/></svg>',
    settings: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><rect class="icon-main" x="4" y="5" width="8" height="3" rx="1.5"/><rect class="icon-main" x="12" y="10.5" width="8" height="3" rx="1.5"/><rect class="icon-main" x="4" y="16" width="8" height="3" rx="1.5"/><circle class="icon-accent" cx="15.5" cy="6.5" r="2.2"/><circle class="icon-accent" cx="8.5" cy="12" r="2.2"/><circle class="icon-accent" cx="15.5" cy="17.5" r="2.2"/></svg>'
  }
});

const params = new URLSearchParams(location.search);
const requested = params.get("variant");
const variant = Object.hasOwn(VARIANTS, requested) ? requested : "loop";
document.body.dataset.variant = variant;
document.title = `Assistant Structures — Linear Accent ${VARIANTS[variant].label}`;
document.getElementById("variant-description").textContent = `${VARIANTS[variant].label} · ${VARIANTS[variant].description}`;
const variantChip = document.getElementById("variant-chip");
if (variantChip) variantChip.textContent = `Variante chargée : ${VARIANTS[variant].label}`;

document.querySelectorAll("[data-variant-link]").forEach(link => {
  const active = link.dataset.variantLink === variant;
  link.classList.toggle("active", active);
  if (active) link.setAttribute("aria-current", "page");
  else link.removeAttribute("aria-current");
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
