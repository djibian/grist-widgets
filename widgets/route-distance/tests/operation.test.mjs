import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRouteUpdate,
  captureRouteOperation,
  updateSelectedResultIfSameRecord
} from '../operation.js';

test('captureRouteOperation fige la ligne, les coordonnées et les colonnes cibles', () => {
  const operation = captureRouteOperation(
    { id: 12, NomPrenom: 'Élève A', Latitude: 47.1, Longitude: -1.2 },
    { Distance: 'DistanceKm', Duree: 'DureeMin' }
  );

  assert.deepEqual(operation, {
    recordId: 12,
    latitude: 47.1,
    longitude: -1.2,
    label: 'Élève A',
    distanceColumn: 'DistanceKm',
    durationColumn: 'DureeMin'
  });
  assert.equal(Object.isFrozen(operation), true);
});

test('le résultat reste destiné à la ligne capturée même si la sélection change', () => {
  const operation = captureRouteOperation(
    { id: 12, NomPrenom: 'Élève A', Latitude: 47.1, Longitude: -1.2 },
    { Distance: 'DistanceKm', Duree: 'DureeMin' }
  );

  const currentSelectionAfterNetwork = { id: 99, NomPrenom: 'Élève B' };
  const update = buildRouteUpdate(operation, { distance: 14.2, duration: 21.5 });

  assert.equal(currentSelectionAfterNetwork.id, 99);
  assert.deepEqual(update, {
    id: 12,
    fields: { DistanceKm: 14.2, DureeMin: 21.5 }
  });
});

test('une nouvelle sélection ne reçoit pas en mémoire le résultat de l’ancienne', () => {
  const operation = captureRouteOperation(
    { id: 12, NomPrenom: 'Élève A', Latitude: 47.1, Longitude: -1.2 },
    { Distance: 'DistanceKm', Duree: 'DureeMin' }
  );
  const selected = { id: 99, Distance: null, Duree: null };

  const changed = updateSelectedResultIfSameRecord(
    selected,
    operation,
    { distance: 14.2, duration: 21.5 }
  );

  assert.equal(changed, false);
  assert.deepEqual(selected, { id: 99, Distance: null, Duree: null });
});

test('la durée reste facultative', () => {
  const operation = captureRouteOperation(
    { id: 12, NomPrenom: 'Élève A', Latitude: 47.1, Longitude: -1.2 },
    { Distance: 'DistanceKm' }
  );

  assert.deepEqual(
    buildRouteUpdate(operation, { distance: 8.4, duration: 11.2 }),
    { id: 12, fields: { DistanceKm: 8.4 } }
  );
});
