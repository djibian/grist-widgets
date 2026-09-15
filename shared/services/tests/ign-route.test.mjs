import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIgnRoutePayload,
  geocodeAddress,
  requestIgnRoute,
  validCoordinates
} from '../ign-route.js';

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] ?? null;
      }
    },
    async json() {
      return body;
    }
  };
}

test('validCoordinates accepte uniquement des coordonnées finies dans les bornes', () => {
  assert.equal(validCoordinates(47.1, -1.5), true);
  assert.equal(validCoordinates(NaN, -1.5), false);
  assert.equal(validCoordinates(91, -1.5), false);
  assert.equal(validCoordinates(47.1, 181), false);
});

test('geocodeAddress interroge la BAN Géoplateforme et normalise le meilleur résultat', async () => {
  let capturedUrl = null;
  const result = await geocodeAddress('5 rue des Lilas 44000 Nantes', {
    fetchFn: async (url) => {
      capturedUrl = url;
      return response(200, {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-1.55, 47.22] },
          properties: { label: '5 Rue des Lilas 44000 Nantes', score: 0.92 }
        }]
      });
    }
  });

  const url = new URL(capturedUrl);
  assert.equal(url.origin + url.pathname, 'https://data.geopf.fr/geocodage/search');
  assert.equal(url.searchParams.get('q'), '5 rue des Lilas 44000 Nantes');
  assert.equal(url.searchParams.get('index'), 'address');
  assert.equal(url.searchParams.get('limit'), '1');
  assert.deepEqual(result, {
    label: '5 Rue des Lilas 44000 Nantes',
    latitude: 47.22,
    longitude: -1.55,
    score: 0.92
  });
});

test('geocodeAddress refuse une saisie trop courte et une réponse sans adresse', async () => {
  await assert.rejects(geocodeAddress('a'), /adresse de départ suffisamment précise/);
  await assert.rejects(
    geocodeAddress('adresse inconnue', {
      fetchFn: async () => response(200, { type: 'FeatureCollection', features: [] })
    }),
    /Aucune adresse exploitable/
  );
});

test('buildIgnRoutePayload utilise longitude,latitude et le profil voiture', () => {
  const payload = buildIgnRoutePayload({
    startLatitude: 47.057944,
    startLongitude: -1.521611,
    endLatitude: 47.2,
    endLongitude: -1.7
  });

  assert.equal(payload.resource, 'bdtopo-osrm');
  assert.equal(payload.start, '-1.521611,47.057944');
  assert.equal(payload.end, '-1.7,47.2');
  assert.equal(payload.profile, 'car');
  assert.equal(payload.optimization, 'fastest');
});

test('requestIgnRoute envoie la requête et arrondit distance et durée', async () => {
  let capturedUrl = null;
  let capturedOptions = null;
  const result = await requestIgnRoute({
    startLatitude: 47.057944,
    startLongitude: -1.521611,
    endLatitude: 47.2,
    endLongitude: -1.7,
    decimals: 2
  }, {
    fetchFn: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return response(200, { distance: 12.3456, duration: 17.84 });
    }
  });

  assert.match(capturedUrl, /data\.geopf\.fr\/navigation\/itineraire/);
  assert.equal(capturedOptions.method, 'POST');
  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.start, '-1.521611,47.057944');
  assert.equal(body.end, '-1.7,47.2');
  assert.deepEqual(result, { distance: 12.35, duration: 17.8 });
});

test('requestIgnRoute respecte Retry-After après un 429', async () => {
  let calls = 0;
  const waits = [];
  const result = await requestIgnRoute({
    startLatitude: 47,
    startLongitude: -1,
    endLatitude: 48,
    endLongitude: -2
  }, {
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) return response(429, { message: 'rate limit' }, { 'retry-after': '3' });
      return response(200, { distance: 10, duration: 12 });
    },
    waitFn: async (ms) => waits.push(ms)
  });

  assert.equal(calls, 2);
  assert.deepEqual(waits, [3000]);
  assert.equal(result.distance, 10);
});

test('requestIgnRoute remonte une erreur réseau compréhensible', async () => {
  await assert.rejects(
    requestIgnRoute({
      startLatitude: 47,
      startLongitude: -1,
      endLatitude: 48,
      endLongitude: -2
    }, {
      fetchFn: async () => { throw new Error('offline'); }
    }),
    /Impossible de joindre le service IGN/
  );
});

test('requestIgnRoute remonte le message HTTP de l’API', async () => {
  await assert.rejects(
    requestIgnRoute({
      startLatitude: 47,
      startLongitude: -1,
      endLatitude: 48,
      endLongitude: -2
    }, {
      fetchFn: async () => response(400, { error: { message: 'route impossible' } })
    }),
    /route impossible/
  );
});

test('requestIgnRoute refuse une réponse sans distance exploitable', async () => {
  await assert.rejects(
    requestIgnRoute({
      startLatitude: 47,
      startLongitude: -1,
      endLatitude: 48,
      endLongitude: -2
    }, {
      fetchFn: async () => response(200, { duration: 12 })
    }),
    /Aucun itinéraire routier/
  );
});
