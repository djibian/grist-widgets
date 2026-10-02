import { addressEvidence, normalizeIdentity, parseSiteAddress, targetNameVariants, usableCoordinates } from "./identity-resolution.js";
import { normalizeIdentifier } from "./search.js";
import { verifiedGeographicFiness } from "./osm-site-positions.js";

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
    const geographic = verifiedGeographicFiness(candidate, [link]).length > 0;
    if (!link.verifiedOfficial || normalizeIdentifier(link.siret) !== candidate.siret
      || !(geographic ? addressEvidence(candidate.adresse, link.adresse).compatible : exactSiteAddress(candidate.adresse, link.adresse))) continue;
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

export function assessSitePosition(candidate, poi, { links = [], requestedAddress = "" } = {}) {
  const coordinates = usableCoordinates(poi.latitude, poi.longitude);
  const assessment = { observation: poi, accepted: false, proof: [], reason: "" };
  const refuse = (reason, conflict = false) => ({ ...assessment, reason, conflict });
  if (!coordinates || poi.kind !== "site") return refuse("La source ne fournit pas un point de lieu utilisable.");
  const siret = normalizeIdentifier(poi.siret);
  const finess = verifiedGeographicFiness(candidate, links);
  const ids = poi.finessIds ?? [];
  const geographic = finess.find(link => ids.includes(link.sourceRecordId));
  const explicitlyLinked = siret === candidate.siret || Boolean(geographic);
  if (poi.identifierError) return refuse("Les identifiants du POI sont invalides.", explicitlyLinked);
  if (siret && siret !== candidate.siret) return refuse("Le POI porte un autre SIRET.", Boolean(geographic));
  if (ids.length && finess.length && (!geographic || ids.some(id => !finess.some(link => link.sourceRecordId === id)))) {
    return refuse("Le FINESS du POI contredit le site revalidé.", explicitlyLinked);
  }
  if (poi.adresse && addressEvidence(candidate.adresse, poi.adresse).conflict) return refuse("L’adresse du POI contredit celle de l’établissement.", explicitlyLinked);
  if (poi.adresse && requestedAddress && addressEvidence(requestedAddress, poi.adresse).conflict) return refuse("L’adresse du POI contredit l’adresse du site demandé.", explicitlyLinked);
  const namedFiness = finess.find(link => link.publicNames.some(name => normalizeIdentity(name) === normalizeIdentity(poi.name)));
  const nameAddressLinked = Boolean(namedFiness && exactSiteAddress(candidate.adresse, poi.adresse));
  const expectedCategory = geographic?.registryEvidence.categoryCode
    || (siret === candidate.siret && finess.length === 1 ? finess[0].registryEvidence.categoryCode : namedFiness?.registryEvidence.categoryCode);
  if (expectedCategory && poi.finessCategory && poi.finessCategory !== expectedCategory) {
    return refuse("La catégorie FINESS du POI contredit celle de l’établissement.", explicitlyLinked || nameAddressLinked);
  }
  // FINESS 500 is a residential nursing home, not a neighbouring home-care
  // service. An abbreviated name is usable only with the exact geographic
  // identifier AND the same sector category and a compatible place type.
  const type = poi.siteType ?? {};
  const nursingHome = [type.socialFacility, type.healthcare, type.amenity].includes("nursing_home")
    && (!type.socialFacility || type.socialFacility === "nursing_home")
    && (!type.healthcare || type.healthcare === "nursing_home")
    && (!type.amenity || ["social_facility", "nursing_home"].includes(type.amenity));
  if (expectedCategory === "500" && !nursingHome) {
    return refuse("Le type du POI ne désigne pas un établissement d’hébergement EHPAD.", explicitlyLinked || nameAddressLinked);
  }

  // Only the place's own name participates. A shared operator/brand on a
  // neighbouring fuel station, ATM or other facility is not a site identity.
  const names = trustedNames(candidate, links);
  const named = names.find(item => normalizeIdentity(item.name) === normalizeIdentity(poi.name));
  const typedName = geographic && poi.finessCategory === geographic.registryEvidence.categoryCode
    && geographic.publicNames.some(name => targetNameVariants({ NomCommercial: name, Adresse: geographic.adresse }).includes(normalizeIdentity(poi.name)));
  if (explicitlyLinked) {
    if (names.length && (!poi.name || (!named && !typedName))) return refuse("Le nom du POI ne désigne pas le site public attesté.", true);
    if (siret === candidate.siret) assessment.proof.push({ kind: "EXPLICIT_SIRET", description: "SIRET du lieu identique à l’établissement revalidé", source: poi.source });
    if (geographic) assessment.proof.push({
      kind: "EXPLICIT_GEOGRAPHIC_FINESS", finess: geographic.sourceRecordId,
      categoryCode: geographic.registryEvidence.categoryCode,
      description: `FINESS géographique ${geographic.sourceRecordId} du POI identique au site FINESS/Annuaire revalidé ; catégorie ${geographic.registryEvidence.categoryCode} et nom public concordants`,
      source: poi.source, registryEvidence: geographic.registryEvidence, officialBinding: geographic.officialBinding,
    });
  } else {
    if (!named) return refuse("Aucun nom public attesté ne relie ce POI au SIRET.");
    if (!exactSiteAddress(candidate.adresse, poi.adresse)) return refuse("L’adresse de site n’est pas suffisamment concordante.");
    assessment.proof.push(
      { kind: "ATTESTED_PUBLIC_NAME", description: `Nom public attesté : ${named.name}`, source: named.source },
      { kind: "EXACT_SITE_ADDRESS", description: "Commune, code postal, voie et numéro de site concordants (ou voie sans numéro dans les deux sources)", source: poi.source },
    );
  }
  assessment.proof.push({ kind: "OFFICIAL_REVALIDATION", description: "Identité et adresse du SIRET revalidées dans l’Annuaire", source: officialSource(candidate) });
  return { ...assessment, accepted: true, coordinates, level: explicitlyLinked ? POSITION_STATES.SITE_CONFIRMED : POSITION_STATES.SITE_CORROBORATED };
}

export function resolveSitePosition(candidate, { observations = [], links = [], discovery = [], coverage = [], requestedAddress = "" } = {}) {
  const assessments = observations.map(poi => assessSitePosition(candidate, poi, { links, requestedAddress }));
  const administrative = usableCoordinates(candidate.latitude, candidate.longitude);
  const evidence = [
    ...(administrative ? [{ kind: "administrative", source: officialSource(candidate), ...administrative, accepted: false, reason: "Précision de site non documentée : point Annuaire conservé comme référence." }] : []),
    ...discovery.map(item => ({ kind: "discovery", source: { id: "ign", label: "Géocodage IGN" }, ...item, accepted: false, reason: "Géocodage d’adresse utilisé uniquement pour la découverte." })),
    ...assessments,
  ];
  const accepted = assessments.filter(item => item.accepted);
  const base = { siret: candidate.siret, latitude: null, longitude: null, source: null, proof: [], evidence, coverage };
  if (assessments.some(item => item.conflict)) return { ...base, status: POSITION_STATES.CONFLICT, reason: "Une preuve liée au site contredit son identité ; aucune coordonnée proposée." };
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
    reason: selected.level === POSITION_STATES.SITE_CONFIRMED ? "Lieu rattaché par ses identifiants d’établissement explicites et revalidés." : "Lieu corroboré par son nom public attesté et son adresse de site.",
  };
}
