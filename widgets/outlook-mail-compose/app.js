import { buildOutlookComposeUrl, validateComposeData } from './compose.js';

const elements = Object.fromEntries([
  'mappingError',
  'appCard',
  'recordLabel',
  'recipientValue',
  'subjectValue',
  'composeContextState',
  'bodyPreview',
  'openOutlook',
  'status'
].map((id) => [id, document.getElementById(id)]));

const state = {
  selected: null,
  mappings: null,
  composeUrl: null
};

function displayText(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function mappingIsComplete() {
  return Boolean(
    state.mappings &&
    state.mappings.Recipient &&
    state.mappings.Subject &&
    state.mappings.Body
  );
}

function setStatus(message, type = '') {
  elements.status.textContent = message;
  elements.status.className = 'status' + (type ? ` ${type}` : '');
}

function setContextState(message, type = '') {
  elements.composeContextState.textContent = message;
  elements.composeContextState.className = 'gw-context-value context-state' + (type ? ` ${type}` : '');
}

function disableComposeLink() {
  state.composeUrl = null;
  elements.openOutlook.removeAttribute('href');
  elements.openOutlook.setAttribute('aria-disabled', 'true');
  elements.openOutlook.classList.add('is-disabled');
}

function enableComposeLink(url) {
  state.composeUrl = url;
  elements.openOutlook.href = url;
  elements.openOutlook.setAttribute('aria-disabled', 'false');
  elements.openOutlook.classList.remove('is-disabled');
}

function renderSelected() {
  const row = state.selected;
  disableComposeLink();

  if (!row) {
    elements.recordLabel.textContent = 'Sélectionnez une ligne';
    elements.recipientValue.textContent = '—';
    elements.subjectValue.textContent = '—';
    elements.bodyPreview.textContent = 'Le contenu du message apparaîtra ici.';
    setContextState('Sélection requise');
    setStatus('Sélectionnez une ligne Grist pour préparer le message.');
    return;
  }

  const label = displayText(row.Label, displayText(row.Recipient, 'Ligne sélectionnée'));
  const recipient = row.Recipient ?? '';
  const subject = row.Subject ?? '';
  const body = row.Body ?? '';

  elements.recordLabel.textContent = label;
  elements.recipientValue.textContent = displayText(recipient, 'Destinataire manquant');
  elements.subjectValue.textContent = displayText(subject, 'Objet manquant');
  elements.bodyPreview.textContent = String(body || 'Corps du message manquant');

  const validation = validateComposeData({ recipient, subject, body });
  if (!validation.valid) {
    setContextState('Message incomplet', 'error');
    setStatus(`Complétez dans Grist : ${validation.missing.join(', ')}.`, 'error');
    return;
  }

  try {
    enableComposeLink(buildOutlookComposeUrl({ recipient, subject, body }));
    setContextState('Prêt', 'ready');
    setStatus('Le message est prêt. Ouvrez-le dans Outlook puis vérifiez-le avant envoi.');
  } catch (error) {
    setContextState('Préparation impossible', 'error');
    setStatus(error?.message ? error.message : String(error), 'error');
  }
}

function renderMappingState() {
  const configured = mappingIsComplete();
  elements.mappingError.classList.toggle('visible', !configured);
  elements.appCard.style.display = configured ? '' : 'none';
  if (configured) renderSelected();
}

elements.openOutlook.addEventListener('click', (event) => {
  if (!state.composeUrl) {
    event.preventDefault();
    return;
  }

  setContextState('Ouvert dans Outlook', 'ready');
  setStatus('Outlook a été ouvert avec le message prérempli. L’envoi reste à confirmer dans Outlook.', 'success');
});

grist.ready({
  requiredAccess: 'read table',
  columns: [
    {
      name: 'Recipient',
      title: 'Destinataire',
      type: 'Text',
      optional: true,
      description: 'Adresse de courriel du destinataire.'
    },
    {
      name: 'Subject',
      title: 'Objet',
      type: 'Text',
      optional: true,
      description: 'Objet du message à préparer.'
    },
    {
      name: 'Body',
      title: 'Corps',
      type: 'Text',
      optional: true,
      description: 'Corps texte du message à préparer.'
    },
    {
      name: 'Label',
      title: 'Libellé de la ligne',
      type: 'Text',
      optional: true,
      description: 'Libellé facultatif affiché dans le widget.'
    }
  ]
});

grist.onRecord((record, mappings) => {
  state.mappings = mappings || null;
  state.selected = record ? grist.mapColumnNames(record, { mappings }) : null;
  renderMappingState();
});

renderMappingState();
