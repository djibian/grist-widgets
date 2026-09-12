const VARIANTS = Object.freeze({
  points: {
    label: "A · Points",
    description: "Référence retenue : accents circulaires francs, exactement comme la variante Minimal choisie au cycle 1."
  },
  squares: {
    label: "B · Carrés",
    description: "Même position et même quantité, mais avec de petits carrés arrondis plus graphiques."
  },
  pills: {
    label: "C · Capsules",
    description: "Accents courts et oblongs, plus intégrés aux formes principales sans devenir dominants."
  },
  rings: {
    label: "D · Anneaux",
    description: "Accents évidés : la couleur reste présente mais devient plus légère et plus précise."
  },
  micro: {
    label: "E · Micro",
    description: "Accents réduits au minimum pour garder presque toute l’icône monochrome."
  },
  segments: {
    label: "F · Segments",
    description: "La couleur devient un petit morceau du symbole lui-même plutôt qu’un élément posé dessus."
  }
});

const MAIN_REFRESH = '<path class="icon-main-stroke icon-main-stroke--heavy" d="M18.2 7.2A8 8 0 1 0 19.2 15"/>';
const MAIN_SETTINGS = '<rect class="icon-main" x="4" y="5" width="8" height="3" rx="1.5"/><rect class="icon-main" x="12" y="10.5" width="8" height="3" rx="1.5"/><rect class="icon-main" x="4" y="16" width="8" height="3" rx="1.5"/>';

const ICONS = Object.freeze({
  points: {
    refresh: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_REFRESH}<circle class="icon-accent" cx="18.4" cy="6.8" r="2.2"/></svg>`,
    settings: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_SETTINGS}<circle class="icon-accent" cx="15.5" cy="6.5" r="2.2"/><circle class="icon-accent" cx="8.5" cy="12" r="2.2"/><circle class="icon-accent" cx="15.5" cy="17.5" r="2.2"/></svg>`
  },
  squares: {
    refresh: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_REFRESH}<rect class="icon-accent" x="16.3" y="4.7" width="4.2" height="4.2" rx="1.1"/></svg>`,
    settings: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_SETTINGS}<rect class="icon-accent" x="13.4" y="4.4" width="4.2" height="4.2" rx="1.1"/><rect class="icon-accent" x="6.4" y="9.9" width="4.2" height="4.2" rx="1.1"/><rect class="icon-accent" x="13.4" y="15.4" width="4.2" height="4.2" rx="1.1"/></svg>`
  },
  pills: {
    refresh: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_REFRESH}<rect class="icon-accent" x="15.7" y="5.25" width="5.4" height="3.1" rx="1.55" transform="rotate(-32 18.4 6.8)"/></svg>`,
    settings: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_SETTINGS}<rect class="icon-accent" x="12.9" y="5" width="5.2" height="3" rx="1.5"/><rect class="icon-accent" x="5.9" y="10.5" width="5.2" height="3" rx="1.5"/><rect class="icon-accent" x="12.9" y="16" width="5.2" height="3" rx="1.5"/></svg>`
  },
  rings: {
    refresh: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_REFRESH}<circle class="icon-accent-stroke" cx="18.4" cy="6.8" r="2.35"/></svg>`,
    settings: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_SETTINGS}<circle class="icon-accent-stroke" cx="15.5" cy="6.5" r="2.3"/><circle class="icon-accent-stroke" cx="8.5" cy="12" r="2.3"/><circle class="icon-accent-stroke" cx="15.5" cy="17.5" r="2.3"/></svg>`
  },
  micro: {
    refresh: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_REFRESH}<circle class="icon-accent" cx="18.4" cy="6.8" r="1.2"/></svg>`,
    settings: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_SETTINGS}<circle class="icon-accent" cx="15.5" cy="6.5" r="1.2"/><circle class="icon-accent" cx="8.5" cy="12" r="1.2"/><circle class="icon-accent" cx="15.5" cy="17.5" r="1.2"/></svg>`
  },
  segments: {
    refresh: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_REFRESH}<path class="icon-accent-stroke icon-accent-stroke--heavy" d="M18.2 7.2A8 8 0 0 0 15.7 5"/></svg>`,
    settings: `<svg class="icon-accented" viewBox="0 0 24 24" aria-hidden="true">${MAIN_SETTINGS}<rect class="icon-accent" x="13.6" y="5.25" width="4.1" height="2.5" rx="1.25"/><rect class="icon-accent" x="6.45" y="10.75" width="4.1" height="2.5" rx="1.25"/><rect class="icon-accent" x="13.6" y="16.25" width="4.1" height="2.5" rx="1.25"/></svg>`
  }
});

const params = new URLSearchParams(location.search);
const requested = params.get("variant");
const variant = Object.hasOwn(VARIANTS, requested) ? requested : "points";
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
