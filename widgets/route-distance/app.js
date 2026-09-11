import { requestIgnRoute, validCoordinates } from '../../shared/services/ign-route.js';
import {
  buildRouteUpdate,
  captureRouteOperation,
  updateSelectedResultIfSameRecord
} from './operation.js';

// ---------------------------------------------------------------------------
// RÉGLAGES — origine volontairement codée en dur pour cette première version.
// Une saisie d'adresse avec géocodage/validation sera traitée séparément.
// ---------------------------------------------------------------------------
const DOMICILE_LATITUDE = 47.057944;
const DOMICILE_LONGITUDE = -1.521611;
const ITINERAIRE = 'fastest'; // 'fastest' = plus rapide ; 'shortest' = plus court
const NOMBRE_DECIMALES = 2;   // distance enregistrée en kilomètres

const elements = Object.fromEntries([
  'mappingError',
  'appCard',
  'recordTitle',
  'recordAddress',
  'distanceValue',
  'durationValue',
  'calculateSelected',
  'status'
].map((id) => [id, document.getElementById(id)]));

const state = {
  selected: null,
  mappings: null,
  busy: false
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function displayText(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function mappingIsComplete() {
  return Boolean(
    state.mappings &&
    state.mappings.NomPrenom &&
    state.mappings.Adresse &&
    state.mappings.Latitude &&
    state.mappings.Longitude &&
    state.mappings.Distance
  );
}

function setStatus(message, type = '') {
  elements.status.textContent = message;
  elements.status.className = 'status' + (type ? ' ' + type : '');
}

function setBusy(busy) {
  state.busy = busy;
  elements.calculateSelected.disabled =
    busy ||
    !state.selected ||
    !mappingIsComplete() ||
    !validCoordinates(state.selected.Latitude, state.selected.Longitude);
}

function renderSelected() {
  const row = state.selected;

  if (!row) {
    elements.recordTitle.textContent = 'Sélectionnez une ligne';
    elements.recordAddress.textContent = 'L’adresse apparaîtra ici.';
    elements.distanceValue.textContent = '—';
    elements.durationValue.textContent = '';
    elements.calculateSelected.disabled = true;
    return;
  }

  elements.recordTitle.textContent = displayText(row.NomPrenom, 'Nom non renseigné');
  elements.recordAddress.textContent = displayText(row.Adresse, 'Adresse non renseignée');

  elements.distanceValue.textContent = isFiniteNumber(row.Distance)
    ? row.Distance.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
    : '—';

  elements.durationValue.textContent = isFiniteNumber(row.Duree)
    ? Math.round(row.Duree) + ' min'
    : '';

  setBusy(state.busy);
}

function renderMappingState() {
  const configured = mappingIsComplete();
  elements.mappingError.classList.toggle('visible', !configured);
  elements.appCard.style.display = configured ? '' : 'none';
  if (configured) renderSelected();
}

async function calculateSelected() {
  if (
    !state.selected ||
    state.busy ||
    !validCoordinates(state.selected.Latitude, state.selected.Longitude)
  ) {
    return;
  }

  // Capture immuable du contexte AVANT l'appel réseau. Le résultat restera ainsi
  // attaché à cette ligne même si l'utilisateur sélectionne une autre ligne.
  const operation = captureRouteOperation(state.selected, state.mappings);

  setBusy(true);
  setStatus('Calcul de l’itinéraire…');

  try {
    const result = await requestIgnRoute({
      startLatitude: DOMICILE_LATITUDE,
      startLongitude: DOMICILE_LONGITUDE,
      endLatitude: operation.latitude,
      endLongitude: operation.longitude,
      optimization: ITINERAIRE,
      decimals: NOMBRE_DECIMALES
    });

    const table = grist.getTable();
    await table.update(buildRouteUpdate(operation, result));

    if (updateSelectedResultIfSameRecord(state.selected, operation, result)) {
      renderSelected();
    }

    setStatus(`Distance enregistrée dans Grist pour ${operation.label}.`, 'success');
  } catch (error) {
    setStatus(error?.message ? error.message : String(error), 'error');
  } finally {
    setBusy(false);
  }
}

elements.calculateSelected.addEventListener('click', calculateSelected);

/*
 * Les associations restent techniquement optionnelles pour préserver
 * l’état du Custom Widget Builder pendant sa configuration.
 * Le widget exige néanmoins les cinq associations principales avant affichage.
 */
grist.ready({
  requiredAccess: 'full',
  columns: [
    {
      name: 'NomPrenom',
      title: 'Nom et prénom',
      type: 'Text',
      optional: true,
      description: 'Nom et prénom affichés pour la ligne sélectionnée.'
    },
    {
      name: 'Adresse',
      title: 'Adresse normalisée',
      type: 'Text',
      optional: true,
      description: 'Adresse affichée sous le nom.'
    },
    {
      name: 'Latitude',
      title: 'Latitude de destination',
      type: 'Numeric,Int',
      optional: true,
      description: 'Latitude décimale de l’élève.'
    },
    {
      name: 'Longitude',
      title: 'Longitude de destination',
      type: 'Numeric,Int',
      optional: true,
      description: 'Longitude décimale de l’élève.'
    },
    {
      name: 'Distance',
      title: 'Distance routière (km)',
      type: 'Numeric,Int',
      optional: true,
      description: 'Colonne ordinaire dans laquelle écrire la distance.'
    },
    {
      name: 'Duree',
      title: 'Durée estimée (min)',
      type: 'Numeric,Int',
      optional: true,
      description: 'Colonne facultative pour enregistrer la durée.'
    }
  ]
});

grist.onRecord((record, mappings) => {
  state.mappings = mappings || null;
  state.selected = record ? grist.mapColumnNames(record, { mappings }) : null;
  renderMappingState();
});

renderMappingState();
