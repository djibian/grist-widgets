import { findOsmContacts } from "../osm.js";

function hasCoordinate(value) {
  return value !== undefined && value !== null && String(value).trim() !== "" && Number.isFinite(Number(value));
}

export const osmContactSource = Object.freeze({
  id: "osm",
  label: "OpenStreetMap",

  canSearch(context = {}) {
    const siret = String(context.siret ?? "").trim();
    const name = String(context.name ?? "").trim();
    return Boolean(siret || (name && hasCoordinate(context.latitude) && hasCoordinate(context.longitude)));
  },

  search(context = {}, options = {}) {
    return findOsmContacts({
      ...context,
      ...options,
    });
  },
});
