export function captureRouteOperation(record, mappings) {
  if (!record || record.id === null || record.id === undefined) {
    throw new Error('Aucune ligne sélectionnée.');
  }
  if (!mappings?.Distance) {
    throw new Error('La colonne de distance n’est pas associée.');
  }

  return Object.freeze({
    recordId: record.id,
    latitude: record.Latitude,
    longitude: record.Longitude,
    label: String(record.NomPrenom || 'la ligne sélectionnée'),
    distanceColumn: mappings.Distance,
    durationColumn: mappings.Duree || null
  });
}

export function buildRouteUpdate(operation, result) {
  const fields = {
    [operation.distanceColumn]: result.distance
  };

  if (operation.durationColumn && typeof result.duration === 'number' && Number.isFinite(result.duration)) {
    fields[operation.durationColumn] = result.duration;
  }

  return {
    id: operation.recordId,
    fields
  };
}

export function updateSelectedResultIfSameRecord(selected, operation, result) {
  if (!selected || selected.id !== operation.recordId) return false;
  selected.Distance = result.distance;
  selected.Duree = result.duration;
  return true;
}
