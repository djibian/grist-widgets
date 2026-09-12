const VARIANTS = Object.freeze({
  current: {
    label: "A · Azur + ambre",
    description: "Référence retenue : azur pour Actualiser et ambre pour Réglages."
  },
  cool: {
    label: "B · Bleu + violet",
    description: "Palette plus froide et numérique : bleu franc pour Actualiser, violet pour Réglages."
  },
  coral: {
    label: "C · Turquoise + corail",
    description: "Contraste chaud/froid plus vivant : turquoise pour Actualiser et corail orangé pour Réglages."
  },
  vivid: {
    label: "D · Indigo + rose",
    description: "Palette plus expressive et contemporaine, avec deux accents nettement différenciés."
  },
  unified: {
    label: "E · Bleu unique",
    description: "Une seule couleur d’accent pour les deux actions afin de maximiser la cohérence visuelle."
  },
  graphite: {
    label: "F · Graphite",
    description: "Aucune couleur chromatique : les points restent visibles uniquement par une nuance de gris."
  }
});

const ICONS = Object.freeze({
  refresh: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main-stroke icon-main-stroke--heavy" d="M18.2 7.2A8 8 0 1 0 19.2 15"/><circle class="icon-accent" cx="18.4" cy="6.8" r="2.2"/></svg>',
  settings: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><rect class="icon-main" x="4" y="5" width="8" height="3" rx="1.5"/><rect class="icon-main" x="12" y="10.5" width="8" height="3" rx="1.5"/><rect class="icon-main" x="4" y="16" width="8" height="3" rx="1.5"/><circle class="icon-accent" cx="15.5" cy="6.5" r="2.2"/><circle class="icon-accent" cx="8.5" cy="12" r="2.2"/><circle class="icon-accent" cx="15.5" cy="17.5" r="2.2"/></svg>'
});

const params = new URLSearchParams(location.search);
const requested = params.get("variant");
const variant = Object.hasOwn(VARIANTS, requested) ? requested : "current";
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
  if (slot) slot.innerHTML = ICONS[button.dataset.iconButton] ?? "";
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
