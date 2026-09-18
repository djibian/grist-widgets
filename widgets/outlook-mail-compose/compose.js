export const OUTLOOK_COMPOSE_BASE = 'https://outlook.office.com/mail/0/deeplink/compose';

function text(value) {
  return value === null || value === undefined ? '' : String(value);
}

export function validateComposeData({ recipient, subject, body } = {}) {
  const missing = [];
  if (!text(recipient).trim()) missing.push('Destinataire');
  if (!text(subject).trim()) missing.push('Objet');
  if (!text(body).trim()) missing.push('Corps');

  return {
    valid: missing.length === 0,
    missing
  };
}

export function renderTemplate(template, record = {}) {
  const missingFields = [];
  const seen = new Set();

  const rendered = text(template).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, rawField) => {
    const field = String(rawField).trim();
    const hasField = Object.prototype.hasOwnProperty.call(record ?? {}, field);
    const value = hasField ? record[field] : undefined;

    if (!hasField || value === null || value === undefined) {
      if (!seen.has(field)) {
        seen.add(field);
        missingFields.push(field);
      }
      return '';
    }

    return text(value);
  });

  return { text: rendered, missingFields };
}

export function buildOutlookComposeUrl({ recipient, subject, body } = {}) {
  const validation = validateComposeData({ recipient, subject, body });
  if (!validation.valid) {
    throw new Error(`Champs manquants : ${validation.missing.join(', ')}`);
  }

  const query = [
    ['popoutv2', '1'],
    ['to', text(recipient).trim()],
    ['subject', text(subject)],
    ['body', text(body)]
  ]
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('&');

  return `${OUTLOOK_COMPOSE_BASE}?${query}`;
}
