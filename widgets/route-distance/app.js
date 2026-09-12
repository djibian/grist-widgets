import { requestIgnRoute, validCoordinates } from '../../shared/services/ign-route.js';
import {
  buildRouteUpdate,
  captureRouteOperation,
  updateSelectedResultIfSameRecord
} from './operation.js';

const DOMICILE_LATITUDE = 47.057944;
const DOMICILE_LONGITUDE = -1.521611;
const ITINERAIRE = 'fastest';
const NOMBRE_DECIMALES = 2;

const elements = Object.fromEntries([
  'mappingError',
  'appCard',
  'recordTitle',
  'recordAddress',
  'routeContextState',
  'destinationTitle',
  'destinationAddress',
  'distanceValue',
  'durationValue',
  'calculateSelected',
  'saveSelected',
  'status'
].map((id) => [id, document.getElementById(id)]));

const state = {
  selected: null,
  mappings: null,
  busy: false,
  pending: null
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

function setContextState(message, type = '') {
  elements.routeContextState.textContent = message;
  elements.routeContextState.className = 'gw-context-value context-state' + (type ? ' ' + type : '');
}

function pendingMatchesSelection() {
  return Boolean(state.pending && state.selected && state.pending.operation.recordId === state.selected.id);
}

function setBusy(busy) {
  state.busy = busy;
  const usableSelection = Boolean(
    state.selected &&
    mappingIsComplete() &&
    validCoordinates(state.selected.Latitude, state.selected.Longitude)
  );
  elements.calculateSelected.disabled = busy || !usableSelection;
  elements.saveSelected.disabled = busy || !pendingMatchesSelection();
}

function renderResult(result) {
  elements.distanceValue.textContent = isFiniteNumber(result?.distance)
    ? result.distance.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
    : '—';
  elements.durationValue.textContent = isFiniteNumber(result?.duration)
    ? Math.round(result.duration) + ' min'
    : '';
}

function renderStoredResult() {
  const row = state.selected;
  renderResult({
    distance: row?.Distance,
    duration: row?.Duree
  });
}

function clearPending() {
  state.pending = null;
  elements.saveSelected.textContent = 'Enregistrer dans Grist';
}

function renderSelected() {
  const row = state.selected;
  clearPending();

  if (!row) {
    elements.recordTitle.textContent = 'Sélectionnez une ligne';
    elements.recordAddress.textContent = 'L’adresse apparaîtra ici.';
    elements.destinationTitle.textContent = 'Aucune ligne sélectionnée';
    elements.destinationAddress.textContent = 'Sélectionnez une ligne Grist.';
    renderResult(null);
    setContextState('Sélection requise');
    setStatus('Aucun itinéraire calculé.');
    setBusy(false);
    return;
  }

  const title = displayText(row.NomPrenom, 'Nom non renseigné');
  const address = displayText(row.Adresse, 'Adresse non renseignée');
  elements.recordTitle.textContent = title;
  elements.recordAddress.textContent = address;
  elements.destinationTitle.textContent = title;
  elements.destinationAddress.textContent = address;
  renderStoredResult();

  if (!validCoordinates(row.Latitude, row.Longitude)) {
    setContextState('Coordonnées invalides', 'error');
    setStatus('La destination ne possède pas de coordonnées utilisables.', 'error');
  } else {
    setContextState('Coordonnées prêtes', 'ready');
    setStatus(isFiniteNumber(row.Distance) ? 'Distance actuellement enregistrée dans Grist.' : 'Prêt à calculer.');
  }
  setBusy(false);
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
  ) return;

  const operation = captureRouteOperation(state.selected, state.mappings);
  clearPending();
  setBusy(true);
  setContextState('Calcul en cours', 'pending');
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

    if (!state.selected || state.selected.id !== operation.recordId) {
      setStatus(`Calcul terminé pour ${operation.label}, mais la sélection a changé. Recalculez sur la ligne active.`);
      renderStoredResult();
      setContextState('Sélection modifiée');
      return;
    }

    state.pending = { operation, result };
    renderResult(result);
    elements.saveSelected.textContent = `Enregistrer ${result.distance.toLocaleString('fr-FR')} km`;
    setContextState('Résultat à valider', 'pending');
    setStatus('Itinéraire calculé. Vérifiez le résultat puis enregistrez-le.', 'success');
  } catch (error) {
    clearPending();
    renderStoredResult();
    setContextState('Calcul impossible', 'error');
    setStatus(error?.message ? error.message : String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function saveSelected() {
  if (!pendingMatchesSelection() || state.busy) return;

  const { operation, result } = state.pending;
  setBusy(true);
  setContextState('Enregistrement', 'pending');
  setStatus('Enregistrement dans Grist…');

  try {
    const table = grist.getTable();
    await table.update(buildRouteUpdate(operation, result));
    updateSelectedResultIfSameRecord(state.selected, operation, result);
    clearPending();
    renderStoredResult();
    setContextState('Enregistré', 'ready');
    setStatus(`Distance enregistrée dans Grist pour ${operation.label}.`, 'success');
  } catch (error) {
    setContextState('Écriture impossible', 'error');
    setStatus(error?.message ? error.message : String(error), 'error');
  } finally {
    setBusy(false);
  }
}

elements.calculateSelected.addEventListener('click', calculateSelected);
elements.saveSelected.addEventListener('click', saveSelected);

grist.ready({
  requiredAccess: 'full',
  columns: [
    { name: 'NomPrenom', title: 'Nom et prénom', type: 'Text', optional: true, description: 'Nom et prénom affichés pour la ligne sélectionnée.' },
    { name: 'Adresse', title: 'Adresse normalisée', type: 'Text', optional: true, description: 'Adresse affichée sous le nom.' },
    { name: 'Latitude', title: 'Latitude de destination', type: 'Numeric,Int', optional: true, description: 'Latitude décimale de l’élève.' },
    { name: 'Longitude', title: 'Longitude de destination', type: 'Numeric,Int', optional: true, description: 'Longitude décimale de l’élève.' },
    { name: 'Distance', title: 'Distance routière (km)', type: 'Numeric,Int', optional: true, description: 'Colonne ordinaire dans laquelle écrire la distance.' },
    { name: 'Duree', title: 'Durée estimée (min)', type: 'Numeric,Int', optional: true, description: 'Colonne facultative pour enregistrer la durée.' }
  ]
});

grist.onRecord((record, mappings) => {
  state.pending = null;
  state.mappings = mappings || null;
  state.selected = record ? grist.mapColumnNames(record, { mappings }) : null;
  renderMappingState();
});

renderMappingState();
