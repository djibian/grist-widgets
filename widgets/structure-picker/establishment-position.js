import { addressEvidence, normalizeIdentity, parseSiteAddress, usableCoordinates } from "./identity-resolution.js";
import { normalizeIdentifier } from "./search.js";

export const POSITION_STATES = Object.freeze({
  SITE_CONFIRMED: "SITE_CONFIRMED",
  SITE_CORROBORATED: "SITE_CORROBORATED",
  UNRESOLVED: "UNRESOLVED",
  CONFLICT: "CONFLICT",
});

// A disagreement between linked site observations is a reason to abstain,
// never a rule for joining a nearby POI to a legal identity.
export const MAX_SITE_DISAGREEMENT_METERS = 75;

export function siteDistanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const radians = value => value * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function exactSiteAddress(left, right) {
  const a = parseSiteAddress(left);
  const b = parseSiteAddress(right);
  const relation = addressEvidence(left, right);
  const street = value => [...new Set(value.streetTokens)].sort().join(" ");
  return !relation.conflict
    && a.codePostal && a.codePostal === b.codePostal
    && a.commune && a.commune === b.commune
    && a.streetTokens.length && street(a) === street(b)
    && a.number === b.number
    && ((!a.repetition && !b.repetition) || ["same", "compatible"].includes(relation.repetition));
}

function officialSource(candidate) {
  return {
    id: "annuaire", label: "Annuaire des Entreprises", recordId: candidate.siret,
    url: `https://annuaire-entreprises.data.gouv.fr/etablissement/${candidate.siret}`,
  };
}

function trustedNames(candidate, links) {
  const names = (candidate.aliases ?? []).map(name => ({ name, source: officialSource(candidate) }));
  if (candidate.nomUsuelDistinct && candidate.nomCommercial) names.push({ name: candidate.nomCommercial, source: officialSource(candidate) });
  for (const link of links ?? []) {
    if (!link.verifiedOfficial || normalizeIdentifier(link.siret) !== candidate.siret
      || !exactSiteAddress(candidate.adresse, link.adresse)) continue;
    for (const name of link.publicNames ?? []) {
      names.push({ name, source: {
        id: link.source, label: link.sourceLabel, recordId: link.sourceRecordId,
        url: link.sourceUrl || "", publishedAt: link.sourcePublishedAt || null,
        historical: Boolean(link.historical),
      } });
    }
  }
  return names;
}

export function assessSitePosition(candidate, poi, { links = [] } = {}) {
  const coordinates = usableCoordinates(poi.latitude, poi.longitude);
  const assessment = { observation: poi, accepted: false, proof: [], reason: "" };
  const refuse = reason => ({ ...assessment, reason });
  if (!coordinates || poi.kind !== "site") return refuse("La source ne fournit pas un point de lieu utilisable.");
  const siret = normalizeIdentifier(poi.siret);
  if (siret && siret !== candidate.siret) return refuse("Le POI porte un autre SIRET.");
  if (poi.adresse && addressEvidence(candidate.adresse, poi.adresse).conflict) return refuse("L’adresse du POI contredit celle de l’établissement.");

  // Only the place's own name participates. A shared operator/brand on a
  // neighbouring fuel station, ATM or other facility is not a site identity.
  const names = trustedNames(candidate, links);
  const named = names.find(item => normalizeIdentity(item.name) === normalizeIdentity(poi.name));
  if (siret === candidate.siret) {
    if (names.length && poi.name && !named) return refuse("Le nom du POI ne désigne pas le site public attesté.");
    assessment.proof.push({ kind: "EXPLICIT_SIRET", description: "SIRET du lieu identique à l’établissement revalidé", source: poi.source });
  } else {
    if (!named) return refuse("Aucun nom public attesté ne relie ce POI au SIRET.");
    if (!exactSiteAddress(candidate.adresse, poi.adresse)) return refuse("L’adresse de site n’est pas suffisamment concordante.");
    assessment.proof.push(
      { kind: "ATTESTED_PUBLIC_NAME", description: `Nom public attesté : ${named.name}`, source: named.source },
      { kind: "EXACT_SITE_ADDRESS", description: "Commune, code postal, voie et numéro de site concordants (ou voie sans numéro dans les deux sources)", source: poi.source },
    );
  }
  assessment.proof.push({ kind: "OFFICIAL_REVALIDATION", description: "Identité et adresse du SIRET revalidées dans l’Annuaire", source: officialSource(candidate) });
  return { ...assessment, accepted: true, coordinates, level: siret ? POSITION_STATES.SITE_CONFIRMED : POSITION_STATES.SITE_CORROBORATED };
}

export function resolveSitePosition(candidate, { observations = [], links = [], discovery = [], coverage = [] } = {}) {
  const assessments = observations.map(poi => assessSitePosition(candidate, poi, { links }));
  const administrative = usableCoordinates(candidate.latitude, candidate.longitude);
  const evidence = [
    ...(administrative ? [{ kind: "administrative", source: officialSource(candidate), ...administrative, accepted: false, reason: "Précision de site non documentée : point Annuaire conservé comme référence." }] : []),
    ...discovery.map(item => ({ kind: "discovery", source: { id: "ign", label: "Géocodage IGN" }, ...item, accepted: false, reason: "Géocodage d’adresse utilisé uniquement pour la découverte." })),
    ...assessments,
  ];
  const accepted = assessments.filter(item => item.accepted);
  const base = { siret: candidate.siret, latitude: null, longitude: null, source: null, proof: [], evidence, coverage };
  if (!accepted.length) return { ...base, status: POSITION_STATES.UNRESOLVED, reason: "Position précise du site non démontrée ; aucune coordonnée proposée." };
  if (accepted.some((a, index) => accepted.slice(index + 1).some(b => siteDistanceMeters(a.coordinates, b.coordinates) > MAX_SITE_DISAGREEMENT_METERS))) {
    return { ...base, status: POSITION_STATES.CONFLICT, reason: "Les positions rattachées au site se contredisent ; aucune coordonnée proposée." };
  }
  // Existence confidence is deliberately not a linkage/accuracy score.
  const rank = { "all-the-places": 0, osm: 1, overture: 2 };
  accepted.sort((a, b) => Number(b.level === POSITION_STATES.SITE_CONFIRMED) - Number(a.level === POSITION_STATES.SITE_CONFIRMED)
    || (rank[a.observation.source.id] ?? 9) - (rank[b.observation.source.id] ?? 9)
    || String(a.observation.source.recordId).localeCompare(String(b.observation.source.recordId)));
  const selected = accepted[0];
  return {
    ...base, ...selected.coordinates, status: selected.level,
    source: selected.observation.source, proof: selected.proof,
    reason: selected.level === POSITION_STATES.SITE_CONFIRMED ? "Lieu rattaché par un SIRET explicite." : "Lieu corroboré par son nom public attesté et son adresse de site.",
  };
}
