import {
  buildOutlookComposeUrl,
  renderTemplate,
  validateComposeData
} from './compose.js';

const OPTION_KEY = 'outlookMailComposeV1';
const DEFAULT_TEMPLATES = Object.freeze({
  subject: "Votre lien d'accès",
  body: "Bonjour,\n\nVoici votre lien d'accès :\n{{Lien}}\n\nCordialement"
});

const elements = Object.fromEntries([
  'mappingError',
  'recipientValue',
  'subjectValue',
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
  templates: { ...DEFAULT_TEMPLATES }
};

function displayText(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const valueText = String(value).trim();
  return valueText || fallback;
}

function mappingIsComplete() {
  return Boolean(
    state.mappings &&
    state.mappings.Recipient &&
    state.mappings.Link
  );
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

function templateContext() {
  if (!state.rawRecord || !state.selected) return {};
  return {
    ...state.rawRecord,
    Destinataire: state.selected.Recipient ?? '',
    Lien: state.selected.Link ?? ''
  };
}

function renderAvailableFields() {
  elements.availableFields.replaceChildren();
  if (!state.rawRecord || !state.selected) {
    elements.availableFields.textContent = 'Sélectionnez une ligne pour afficher les variables disponibles.';
    return;
  }

  const fields = Object.keys(templateContext())
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

  const context = templateContext();
  const subjectResult = renderTemplate(state.templates.subject, context);
  const bodyResult = renderTemplate(state.templates.body, context);
  const missingFields = [...new Set([...subjectResult.missingFields, ...bodyResult.missingFields])];

  return {
    recipient: state.selected.Recipient ?? '',
    subject: subjectResult.text,
    body: bodyResult.text,
    missingFields
  };
}

function renderSelected() {
  disableComposeLink();
  renderAvailableFields();

  if (!mappingIsComplete()) {
    elements.mappingError.classList.add('visible');
    elements.recipientValue.textContent = '—';
    elements.subjectValue.textContent = state.templates.subject || '—';
    elements.bodyPreview.textContent = state.templates.body || '—';
    setStatus('Associez les colonnes Destinataire et Lien dans la configuration du widget.', 'error');
    return;
  }

  elements.mappingError.classList.remove('visible');

  if (!state.selected) {
    elements.recipientValue.textContent = '—';
    elements.subjectValue.textContent = state.templates.subject || '—';
    elements.bodyPreview.textContent = state.templates.body || '—';
    setStatus('Sélectionnez une ligne Grist pour préparer le message.');
    return;
  }

  const recipient = state.selected.Recipient ?? '';
  elements.recipientValue.textContent = displayText(recipient, 'Destinataire manquant');

  if (!templatesAreComplete()) {
    elements.subjectValue.textContent = 'Modèle à configurer';
    elements.bodyPreview.textContent = 'Renseignez l’objet et le corps dans le modèle du message.';
    setStatus('Configurez l’objet et le corps du message.', 'error');
    return;
  }

  const message = prepareMessage();
  elements.subjectValue.textContent = displayText(message.subject, 'Objet manquant');
  elements.bodyPreview.textContent = message.body || 'Corps du message manquant';

  if (message.missingFields.length > 0) {
    setStatus(`Variables absentes de la ligne : ${message.missingFields.join(', ')}.`, 'error');
    return;
  }

  const validation = validateComposeData(message);
  if (!validation.valid) {
    setStatus(`Éléments manquants : ${validation.missing.join(', ')}.`, 'error');
    return;
  }

  try {
    enableComposeLink(buildOutlookComposeUrl(message));
    setStatus('Le message ci-dessus est prêt à être ouvert dans Outlook.', 'success');
  } catch (error) {
    setStatus(error?.message ? error.message : String(error), 'error');
  }
}

function updateTemplatesFromInputs() {
  state.templates = {
    subject: elements.subjectTemplate.value,
    body: elements.bodyTemplate.value
  };
  renderSelected();
}

async function saveTemplates() {
  updateTemplatesFromInputs();

  if (!templatesAreComplete()) {
    setSettingsStatus('Renseignez un objet et un corps de message.', 'error');
    return;
  }

  elements.saveTemplates.disabled = true;
  setSettingsStatus('Application du modèle…');

  try {
    const value = {
      version: 2,
      subject: state.templates.subject,
      body: state.templates.body
    };
    await grist.widgetApi.setOption(OPTION_KEY, value);
    setSettingsStatus('Modèle appliqué. Pour le conserver après rechargement, utilisez ensuite Enregistrer dans Grist.', 'success');
  } catch (error) {
    setSettingsStatus(error?.message ? error.message : String(error), 'error');
  } finally {
    elements.saveTemplates.disabled = false;
  }
}

elements.subjectTemplate.addEventListener('input', updateTemplatesFromInputs);
elements.bodyTemplate.addEventListener('input', updateTemplatesFromInputs);
elements.saveTemplates.addEventListener('click', saveTemplates);
elements.openOutlook.addEventListener('click', (event) => {
  if (!state.composeUrl) {
    event.preventDefault();
    return;
  }
  setStatus('Outlook va s’ouvrir avec ce message. Vérifiez-le puis cliquez sur Envoyer dans Outlook.', 'success');
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
      name: 'Link',
      title: 'Lien',
      type: 'Text',
      optional: true,
      description: 'Lien personnalisé à insérer dans le message avec la variable {{Lien}}.'
    }
  ]
});

grist.onRecord((record, mappings) => {
  state.rawRecord = record || null;
  state.mappings = mappings || null;
  state.selected = record ? grist.mapColumnNames(record, { mappings }) : null;
  renderSelected();
});

async function loadStoredTemplates() {
  try {
    const stored = await grist.widgetApi.getOption(OPTION_KEY);
    if (stored && typeof stored === 'object') {
      const subject = String(stored.subject ?? '').trim();
      const body = String(stored.body ?? '').trim();
      if (subject && body) {
        state.templates = {
          subject: String(stored.subject),
          body: String(stored.body)
        };
      }
    }
  } catch {
    setSettingsStatus('Impossible de relire le modèle enregistré ; le modèle par défaut est utilisé.', 'error');
  }

  renderTemplateInputs();
  renderSelected();
}

renderTemplateInputs();
renderSelected();
loadStoredTemplates();
