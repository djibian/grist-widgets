const VARIANTS = Object.freeze({
  current: {
    label: "A · Azur + ambre",
    description: "Référence précédente : azur pour Actualiser et ambre pour Réglages."
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
    label: "E · Bleu unique — retenu",
    description: "Variante retenue : bleu unique, point d’Actualiser détaché de l’anneau et taille optique harmonisée avec Réglages."
  },
  graphite: {
    label: "F · Graphite",
    description: "Aucune couleur chromatique : les points restent visibles uniquement par une nuance de gris."
  }
});

const ICONS = Object.freeze({
  refresh: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><path class="icon-main-stroke icon-main-stroke--heavy" d="M15.7 5.1A8 8 0 1 0 19.2 15"/><circle class="icon-accent" cx="20" cy="7" r="2.1"/></svg>',
  settings: '<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true"><rect class="icon-main" x="2.5" y="4.5" width="10.5" height="3.4" rx="1.7"/><rect class="icon-main" x="11" y="10.3" width="10.5" height="3.4" rx="1.7"/><rect class="icon-main" x="2.5" y="16.1" width="10.5" height="3.4" rx="1.7"/><circle class="icon-accent" cx="17.2" cy="6.2" r="2.3"/><circle class="icon-accent" cx="7" cy="12" r="2.3"/><circle class="icon-accent" cx="17.2" cy="17.8" r="2.3"/></svg>'
});

const params = new URLSearchParams(location.search);
const requested = params.get("variant");
const variant = Object.hasOwn(VARIANTS, requested) ? requested : "unified";
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
