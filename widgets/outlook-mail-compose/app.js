import {
  buildOutlookComposeUrl,
  renderTemplate,
  validateComposeData
} from './compose.js';

const OPTION_KEY = 'outlookMailComposeV1';

const elements = Object.fromEntries([
  'mappingError',
  'recordLabel',
  'recipientValue',
  'subjectValue',
  'composeContextState',
  'bodyPreview',
  'openOutlook',
  'status',
  'subjectTemplate',
  'bodyTemplate',
  'saveTemplates',
  'settingsStatus',
  'availableFields'
].map((id) => [id, document.getElementById(id)]));

const state = {
  selected: null,
  rawRecord: null,
  mappings: null,
  composeUrl: null,
  templatesLoaded: false,
  templates: {
    subject: '',
    body: ''
  }
};

function displayText(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const valueText = String(value).trim();
  return valueText || fallback;
}

function mappingIsComplete() {
  return Boolean(state.mappings && state.mappings.Recipient);
}

function templatesAreComplete() {
  return Boolean(state.templates.subject.trim() && state.templates.body.trim());
}

function setStatus(message, type = '') {
  elements.status.textContent = message;
  elements.status.className = 'status' + (type ? ` ${type}` : '');
}

function setSettingsStatus(message, type = '') {
  elements.settingsStatus.textContent = message;
  elements.settingsStatus.className = 'settings-status' + (type ? ` ${type}` : '');
}

function setContextState(message, type = '') {
  elements.composeContextState.textContent = message;
  elements.composeContextState.className = 'gw-context-value context-state' + (type ? ` ${type}` : '');
}

function disableComposeButton() {
  state.composeUrl = null;
  elements.openOutlook.disabled = true;
}

function enableComposeButton(url) {
  state.composeUrl = url;
  elements.openOutlook.disabled = false;
}

function renderAvailableFields() {
  elements.availableFields.replaceChildren();
  if (!state.rawRecord) {
    elements.availableFields.textContent = 'Sélectionnez une ligne pour afficher les variables disponibles.';
    return;
  }

  const fields = Object.keys(state.rawRecord)
    .filter((field) => field !== 'id')
    .sort((left, right) => left.localeCompare(right, 'fr'));

  if (fields.length === 0) {
    elements.availableFields.textContent = 'Aucune variable disponible.';
    return;
  }

  for (const field of fields) {
    const code = document.createElement('code');
    code.textContent = `{{${field}}}`;
    elements.availableFields.appendChild(code);
  }
}

function renderTemplateInputs() {
  elements.subjectTemplate.value = state.templates.subject;
  elements.bodyTemplate.value = state.templates.body;
}

function prepareMessage() {
  if (!state.selected || !state.rawRecord || !templatesAreComplete()) {
    return null;
  }

  const subjectResult = renderTemplate(state.templates.subject, state.rawRecord);
  const bodyResult = renderTemplate(state.templates.body, state.rawRecord);
  const missingFields = [...new Set([...subjectResult.missingFields, ...bodyResult.missingFields])];

  return {
    recipient: state.selected.Recipient ?? '',
    subject: subjectResult.text,
    body: bodyResult.text,
    missingFields
  };
}

function renderSelected() {
  disableComposeButton();
  renderAvailableFields();

  if (!mappingIsComplete()) {
    elements.recordLabel.textContent = 'Configuration requise';
    elements.recipientValue.textContent = '—';
    elements.subjectValue.textContent = '—';
    elements.bodyPreview.textContent = 'Associez la colonne Destinataire dans Grist.';
    setContextState('Mapping requis', 'error');
    setStatus('Associez la colonne Destinataire dans la configuration du widget.', 'error');
    return;
  }

  if (!state.selected) {
    elements.recordLabel.textContent = 'Sélectionnez une ligne';
    elements.recipientValue.textContent = '—';
    elements.subjectValue.textContent = state.templates.subject || '—';
    elements.bodyPreview.textContent = state.templates.body || 'Configurez le modèle du message ci-dessous.';
    setContextState('Sélection requise');
    setStatus('Sélectionnez une ligne Grist pour préparer le message.');
    return;
  }

  const label = displayText(state.selected.Label, displayText(state.selected.Recipient, 'Ligne sélectionnée'));
  const recipient = state.selected.Recipient ?? '';

  elements.recordLabel.textContent = label;
  elements.recipientValue.textContent = displayText(recipient, 'Destinataire manquant');

  if (!templatesAreComplete()) {
    elements.subjectValue.textContent = 'Modèle à configurer';
    elements.bodyPreview.textContent = 'Renseignez l’objet et le corps dans les réglages du widget.';
    setContextState('Modèle requis');
    setStatus('Configurez l’objet et le corps du message dans le widget.');
    return;
  }

  const message = prepareMessage();
  elements.subjectValue.textContent = displayText(message.subject, 'Objet manquant');
  elements.bodyPreview.textContent = message.body || 'Corps du message manquant';

  if (message.missingFields.length > 0) {
    setContextState('Variable inconnue', 'error');
    setStatus(`Variables absentes de la ligne : ${message.missingFields.join(', ')}.`, 'error');
    return;
  }

  const validation = validateComposeData(message);
  if (!validation.valid) {
    setContextState('Message incomplet', 'error');
    setStatus(`Éléments manquants : ${validation.missing.join(', ')}.`, 'error');
    return;
  }

  try {
    enableComposeButton(buildOutlookComposeUrl(message));
    setContextState('Prêt', 'ready');
    setStatus('Le message est prêt. Ouvrez-le dans Outlook puis vérifiez-le avant envoi.');
  } catch (error) {
    setContextState('Préparation impossible', 'error');
    setStatus(error?.message ? error.message : String(error), 'error');
  }
}

async function saveTemplates() {
  const subject = elements.subjectTemplate.value;
  const body = elements.bodyTemplate.value;

  if (!subject.trim() || !body.trim()) {
    setSettingsStatus('Renseignez un objet et un corps de message.', 'error');
    return;
  }

  elements.saveTemplates.disabled = true;
  setSettingsStatus('Application des réglages…');

  try {
    const value = { version: 1, subject, body };
    await grist.widgetApi.setOption(OPTION_KEY, value);
    state.templates = { subject, body };
    renderSelected();
    setSettingsStatus('Réglages appliqués. Utilisez ensuite Enregistrer dans Grist pour les conserver après rechargement.', 'success');
  } catch (error) {
    setSettingsStatus(error?.message ? error.message : String(error), 'error');
  } finally {
    elements.saveTemplates.disabled = false;
  }
}

function openOutlook() {
  if (!state.composeUrl) return;

  try {
    if (window.parent && window.parent !== window) {
      window.parent.open(state.composeUrl, '_blank');
    } else {
      window.open(state.composeUrl, '_blank');
    }
    setContextState('Ouvert dans Outlook', 'ready');
    setStatus('Outlook a été ouvert. Vérifiez le destinataire, l’objet et le corps puis cliquez sur Envoyer dans Outlook.', 'success');
  } catch (error) {
    setContextState('Ouverture impossible', 'error');
    setStatus('Le navigateur a empêché l’ouverture d’Outlook. Autorisez les fenêtres surgissantes pour ce site.', 'error');
  }
}

elements.openOutlook.addEventListener('click', openOutlook);
elements.saveTemplates.addEventListener('click', saveTemplates);

async function initialize() {
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
        name: 'Label',
        title: 'Libellé de la ligne',
        type: 'Text',
        optional: true,
        description: 'Libellé facultatif affiché dans le widget.'
      }
    ]
  });

  grist.onRecord((record, mappings) => {
    state.rawRecord = record || null;
    state.mappings = mappings || null;
    state.selected = record ? grist.mapColumnNames(record, { mappings }) : null;
    renderSelected();
  });

  try {
    const stored = await grist.widgetApi.getOption(OPTION_KEY);
    if (stored && typeof stored === 'object') {
      state.templates = {
        subject: String(stored.subject ?? ''),
        body: String(stored.body ?? '')
      };
    }
  } catch (error) {
    setSettingsStatus('Impossible de relire les réglages enregistrés.', 'error');
  } finally {
    state.templatesLoaded = true;
    renderTemplateInputs();
    renderSelected();
  }
}

initialize();
