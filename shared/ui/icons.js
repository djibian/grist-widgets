const ICONS = Object.freeze({
  refresh: '<path class="gw-icon-main-stroke" d="M13.663 4.175A8 8 0 1 0 19.417 14.997"/><circle class="gw-icon-accent" cx="18.128" cy="6.858" r="2.1"/>',
  settings: '<rect class="gw-icon-main" x="2.5" y="4.5" width="10.5" height="3.4" rx="1.7"/><rect class="gw-icon-main" x="11" y="10.3" width="10.5" height="3.4" rx="1.7"/><rect class="gw-icon-main" x="2.5" y="16.1" width="10.5" height="3.4" rx="1.7"/><circle class="gw-icon-accent" cx="17.2" cy="6.2" r="2.3"/><circle class="gw-icon-accent" cx="7" cy="12" r="2.3"/><circle class="gw-icon-accent" cx="17.2" cy="17.8" r="2.3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  location: '<path d="M12 21s7-5.1 7-12a7 7 0 1 0-14 0c0 6.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/>'
});

const ACCENTED_ICONS = new Set(['refresh', 'settings']);

export function icon(name, { size = 18, label = "" } = {}) {
  const content = ICONS[name];
  if (!content) throw new Error(`Icône inconnue : ${name}`);

  const aria = label
    ? `role="img" aria-label="${escapeAttribute(label)}"`
    : 'aria-hidden="true"';

  const classes = ACCENTED_ICONS.has(name) ? ' class="gw-icon--accented"' : '';
  return `<svg${classes} ${aria} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export const iconNames = Object.freeze(Object.keys(ICONS));
