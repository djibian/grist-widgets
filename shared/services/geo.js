export const EARTH_MEAN_RADIUS_KM = 6371.0088;

export function validCoordinates(latitude, longitude) {
  return typeof latitude === "number"
    && Number.isFinite(latitude)
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

export function haversineDistanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  if (!validCoordinates(latitudeA, longitudeA) || !validCoordinates(latitudeB, longitudeB)) return null;
  const toRadians = value => value * Math.PI / 180;
  const lat1 = toRadians(latitudeA);
  const lat2 = toRadians(latitudeB);
  const dLat = lat2 - lat1;
  const dLon = toRadians(longitudeB) - toRadians(longitudeA);
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
  return EARTH_MEAN_RADIUS_KM * centralAngle;
}
