import { geocodeAddress, validCoordinates } from '../../shared/services/ign-route.js';

const OPTION_KEY = 'routeOrigin';

export const DEFAULT_ROUTE_ORIGIN = Object.freeze({
  address: '',
  label: 'Point de départ actuel',
  latitude: 47.057944,
  longitude: -1.521611
});

const elements = {
  input: document.getElementById('originAddress'),
  save: document.getElementById('originSave'),
  current: document.getElementById('originCurrent'),
  status: document.getElementById('originStatus')
};

let currentOrigin = { ...DEFAULT_ROUTE_ORIGIN };
let busy = false;
const listeners = new Set();

function normalizeOrigin(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!validCoordinates(latitude, longitude)) return { ...DEFAULT_ROUTE_ORIGIN };

  const address = String(value?.address ?? value?.label ?? '').trim();
  const label = String(value?.label ?? address).trim() || 'Point de départ configuré';
  return { address, label, latitude, longitude };
}

function sameOrigin(left, right) {
  return left.address === right.address &&
    left.label === right.label &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude;
}

function setStatus(message = '', type = '') {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.className = 'route-origin-status' + (type ? ` ${type}` : '');
}

function renderOrigin() {
  if (elements.current) elements.current.textContent = currentOrigin.label;
  if (elements.input && document.activeElement !== elements.input) {
    elements.input.value = currentOrigin.address;
  }
  if (elements.save) elements.save.disabled = busy;
  if (elements.input) elements.input.disabled = busy;
}

function notifyOriginChange(previousOrigin) {
  if (sameOrigin(previousOrigin, currentOrigin)) return;
  for (const listener of listeners) listener(getRouteOrigin(), previousOrigin);
}

function applyOrigin(value) {
  const previousOrigin = currentOrigin;
  currentOrigin = normalizeOrigin(value);
  renderOrigin();
  notifyOriginChange(previousOrigin);
}

async function saveOrigin() {
  if (busy) return;
  const query = String(elements.input?.value ?? '').trim();
  if (query.length < 3) {
    setStatus('Saisissez une adresse de départ suffisamment précise.', 'error');
    elements.input?.focus();
    return;
  }

  busy = true;
  renderOrigin();
  setStatus('Recherche de l’adresse dans la Base Adresse Nationale…');

  try {
    const result = await geocodeAddress(query);
    const next = {
      address: result.label,
      label: result.label,
      latitude: result.latitude,
      longitude: result.longitude
    };
    await grist.setOption(OPTION_KEY, next);
    applyOrigin(next);
    setStatus('Adresse de départ enregistrée.', 'success');
  } catch (error) {
    setStatus(error?.message ? error.message : String(error), 'error');
  } finally {
    busy = false;
    renderOrigin();
  }
}

export function getRouteOrigin() {
  return { ...currentOrigin };
}

export function onRouteOriginChange(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

elements.save?.addEventListener('click', saveOrigin);
elements.input?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  saveOrigin();
});

grist.onOptions((options) => applyOrigin(options?.[OPTION_KEY]));
renderOrigin();
