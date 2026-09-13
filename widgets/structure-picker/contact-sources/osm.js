import {
  CONTACT_MATCH_KINDS,
  createContactCandidate,
} from "../contact-model.js";
import { findOsmContacts } from "../osm.js";

function hasCoordinate(value) {
  return value !== undefined && value !== null && String(value).trim() !== "" && Number.isFinite(Number(value));
}

function matchKind(candidate) {
  if (candidate?.confidence === "siret") return CONTACT_MATCH_KINDS.EXACT_SIRET;
  if (candidate?.confidence === "nearby") return CONTACT_MATCH_KINDS.NEARBY_NAME;
  return CONTACT_MATCH_KINDS.UNKNOWN;
}

function toCanonicalCandidate(candidate) {
  return createContactCandidate({
    source: {
      id: "osm",
      label: "OpenStreetMap",
      recordType: candidate?.osmType,
      recordId: candidate?.osmId,
    },
    identity: {
      name: candidate?.nom,
      siret: candidate?.siret,
      address: candidate?.adresse,
      latitude: candidate?.latitude,
      longitude: candidate?.longitude,
    },
    contacts: {
      telephone: candidate?.telephone,
      courriel: candidate?.courriel,
      siteWeb: candidate?.siteWeb,
    },
    match: {
      kind: matchKind(candidate),
      score: candidate?.score,
      nameScore: candidate?.nameScore,
      distanceMeters: candidate?.distanceMeters,
    },
  });
}

export const osmContactSource = Object.freeze({
  id: "osm",
  label: "OpenStreetMap",

  canSearch(context = {}) {
    const siret = String(context.siret ?? "").trim();
    const name = String(context.name ?? "").trim();
    return Boolean(siret || (name && hasCoordinate(context.latitude) && hasCoordinate(context.longitude)));
  },

  async search(context = {}, options = {}) {
    const result = await findOsmContacts({
      ...context,
      ...options,
    });
    return Object.freeze({
      source: Object.freeze({ id: this.id, label: this.label }),
      candidates: Object.freeze(result.candidates.map(toCanonicalCandidate)),
    });
  },
});
