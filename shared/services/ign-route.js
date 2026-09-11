export const IGN_ROUTE_API_URL = 'https://data.geopf.fr/navigation/itineraire';

export function validCoordinates(latitude, longitude) {
  return typeof latitude === 'number' && Number.isFinite(latitude) &&
    typeof longitude === 'number' && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180;
}

export function buildIgnRoutePayload({
  startLatitude,
  startLongitude,
  endLatitude,
  endLongitude,
  optimization = 'fastest',
  profile = 'car'
}) {
  if (!validCoordinates(startLatitude, startLongitude)) {
    throw new Error('Coordonnées de départ invalides.');
  }
  if (!validCoordinates(endLatitude, endLongitude)) {
    throw new Error('Coordonnées de destination invalides.');
  }

  return {
    resource: 'bdtopo-osrm',
    start: `${startLongitude},${startLatitude}`,
    end: `${endLongitude},${endLatitude}`,
    profile,
    optimization: optimization === 'shortest' ? 'shortest' : 'fastest',
    geometryFormat: 'geojson',
    getSteps: false,
    getBbox: false,
    distanceUnit: 'kilometer',
    timeUnit: 'minute',
    crs: 'EPSG:4326'
  };
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function safeDecimals(value) {
  return [0, 1, 2, 3].includes(value) ? value : 2;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

export async function requestIgnRoute({
  startLatitude,
  startLongitude,
  endLatitude,
  endLongitude,
  optimization = 'fastest',
  profile = 'car',
  decimals = 2,
  signal
}, {
  fetchFn = globalThis.fetch,
  waitFn = defaultWait,
  maxRetries = 3,
  apiUrl = IGN_ROUTE_API_URL
} = {}) {
  if (typeof fetchFn !== 'function') {
    throw new Error('Service réseau indisponible.');
  }

  const payload = buildIgnRoutePayload({
    startLatitude,
    startLongitude,
    endLatitude,
    endLongitude,
    optimization,
    profile
  });

  let attempt = 0;
  while (true) {
    let response;
    try {
      response = await fetchFn(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload),
        signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('Impossible de joindre le service IGN. Vérifiez la connexion réseau.');
    }

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = Math.max(
        1,
        Number(response.headers?.get?.('retry-after')) || 2
      );
      attempt += 1;
      await waitFn(retryAfter * 1000);
      continue;
    }

    const data = await readJson(response);

    if (!response.ok) {
      const apiMessage = data?.error?.message || data?.message;
      throw new Error(
        apiMessage || `Le service IGN a répondu avec l’erreur HTTP ${response.status}.`
      );
    }

    if (typeof data?.distance !== 'number' || !Number.isFinite(data.distance)) {
      throw new Error('Aucun itinéraire routier n’a été trouvé pour ces coordonnées.');
    }

    const distanceDecimals = safeDecimals(decimals);
    return {
      distance: Number(data.distance.toFixed(distanceDecimals)),
      duration: typeof data.duration === 'number' && Number.isFinite(data.duration)
        ? Number(data.duration.toFixed(1))
        : null
    };
  }
}
