export const OUTLOOK_COMPOSE_BASE = 'https://outlook.office.com/mail/deeplink/compose';

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

export function buildOutlookComposeUrl({ recipient, subject, body } = {}) {
  const validation = validateComposeData({ recipient, subject, body });
  if (!validation.valid) {
    throw new Error(`Champs manquants : ${validation.missing.join(', ')}`);
  }

  const query = [
    ['to', text(recipient).trim()],
    ['subject', text(subject)],
    ['body', text(body)]
  ]
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('&');

  return `${OUTLOOK_COMPOSE_BASE}?${query}`;
}
