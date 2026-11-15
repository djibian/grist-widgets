// Active, deterministic diagnosis of what a teacher can usefully clarify.
// A question is an exploration hypothesis, never an identity/site/position proof.
import { discoveryHints } from "./discovery-progress.js";
import { extractLocationFromAddress, fuzzyTextScore, normalize, normalizeIdentifier } from "./search.js";

const ANSWERED = new Set(["name", "commune", "address", "operator", "siret"]);
const chosen = (guidance, field) => guidance?.selected?.find(item => item.field === field)?.value || "";
const placeName = c => c?.nomCommercial || c?.raisonSociale || "";
const municipality = c => c?.commune || extractLocationFromAddress(c?.adresse).commune || "";
const postal = c => c?.codePostal || extractLocationFromAddress(c?.adresse).codePostal || "";
const clueCandidate = row => ({
  nomCommercial: row?.NomCommercial || row?.RaisonSociale || "",
  adresse: row?.Adresse || "",
});

function option(field, candidate, label) {
  return { field, candidate, label: String(label ?? "").slice(0, 200) };
}
function question(kind, field, message, reason, choices, anchor, rank, discriminator) {
  // Identical questions are never repeated after 'Je ne sais pas'.
  // A changed set of contradictory clues may generate a new ID and new question.
  const identity = [kind, field, discriminator, ...choices.map(c => normalize(c.label)).sort()].join("|");
  return { id: identity, kind, field, message, reason, options: choices.slice(0, 3), anchor,
    rank, freeText: true };
}
// Expected fraction of candidates eliminated by asking for a group value.
// Equivalent to Gini partition gain; deterministic, with no corpus-fitted weights.
function partitionGain(groups) {
  const count = groups.reduce((n, group) => n + group.count, 0);
  if (count <= 1 || groups.length < 2) return 0;
  return 1 - groups.reduce((sum, group) => sum + (group.count / count) ** 2, 0);
}

function valueGroups(leads, getValue) {
  const groups = new Map();
  for (const lead of leads) {
    const value = String(getValue(lead.candidate) ?? "").trim();
    const key = normalize(value);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { value, candidate: lead.candidate, count: 0 });
    groups.get(key).count += 1;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "fr"));
}

/**
 * Returns {blocker, question, why} with a single optional question.
 * No contact information or SIRET is ever inferred or certified here.
 * A missing Grist value differs from a missing API result, an API failure,
 * and genuinely competing candidate sites.
 */
export function diagnoseDiscovery({ reference = {}, progress = null, guidance = null,
  decision = null, searching = false } = {}) {
  if (["MATCH_VERIFIED", "MATCH_PROBABLE"].includes(decision?.status))
    return { blocker: "resolved", question: null, why: "Identité suffisamment établie." };

  const failedSources = (progress?.activity ?? []).filter(a => ["timeout", "error"].includes(a.state));
  const raw = discoveryHints(progress, 12, { reference, guidance, excluded: guidance?.rejected ?? [] });
  const chosenName = chosen(guidance, "name") || reference.NomCommercial || reference.RaisonSociale || "";
  // A source can return semantically unrelated businesses. Do not ask teachers
  // to arbitrate arbitrary search results as though these were homonyms.
  let plausible = raw.filter(lead =>
    !chosenName || fuzzyTextScore(chosenName, placeName(lead.candidate)) >= 0.68 ||
    fuzzyTextScore(chosenName, lead.candidate?.raisonSociale) >= 0.68);
  // Human choices narrow which uncertainty is useful to ask about, without
  // deleting any official observation or changing the independent verifier.
  // A corrected address has priority over an older, possibly false commune.
  // If nothing matches a chosen clue, do not pretend a remaining site matches.
  const selectedAddress = chosen(guidance, "address");
  const selectedCommune = chosen(guidance, "commune");
  let locationMismatch = false;
  for (const [value, getValue, threshold] of [
    [selectedAddress, c => c?.adresse, 0.82],
    [selectedCommune, municipality, 1],
  ]) {
    if (!value || !plausible.length) continue;
    const matching = plausible.filter(lead =>
      threshold === 1
        ? normalize(getValue(lead.candidate)) === normalize(value)
        : fuzzyTextScore(getValue(lead.candidate), value) >= threshold);
    if (matching.length) plausible = matching;
    else locationMismatch = true;
  }
  const leads = plausible.length ? plausible : raw;
  const hasCandidates = raw.length > 0;
  const sourceConflicts = raw.filter(lead => {
    const observations = lead.candidate?.observations ?? [];
    const addresses = observations.map(item => String(item?.adresse ?? "").trim()).filter(Boolean);
    return addresses.length > 1 && addresses.some(value => fuzzyTextScore(value, addresses[0]) < 0.70);
  });
  const originalLocation = extractLocationFromAddress(selectedAddress || reference.Adresse);
  const targetCommune = chosen(guidance, "commune") ||
    reference.Commune || originalLocation.commune || "";
  const knownPostal = chosen(guidance, "commune") ? "" : originalLocation.codePostal;
  const anchor = clueCandidate(reference);
  const suggestions = [];

  if (plausible.length >= 2) {
    const communes = valueGroups(plausible, municipality);
    const matching = communes.filter(c => normalize(c.value) === normalize(targetCommune));
    const postals = valueGroups(plausible, postal);
    const postalMatch = postals.filter(c => c.value && c.value === knownPostal);
    // Knowing a commune or a unique matching postal code already separates
    // sites: avoid asking an unnecessary question.
    if (communes.length >= 2 && !chosen(guidance, "commune") &&
      !((targetCommune && matching.length === 1) ||
        (knownPostal && postalMatch.length === 1))) {
      suggestions.push(question("homonyms", "commune",
        "Plusieurs établissements ressemblent à ce nom. Dans quelle commune se trouve le lieu du stage ?",
        "La commune permettra de cibler les prochaines recherches, sans certifier l’établissement.",
        communes.map(c => option("commune", c.candidate, c.value)),
        anchor, 70 + Math.round(70 * partitionGain(communes)), normalize(chosenName)));
    }
    const siblings = valueGroups(plausible, c => normalizeIdentifier(c?.siren || c?.siret).slice(0, 9))
      .filter(c => c.value.length === 9 && c.count >= 2);
    const sites = plausible.filter(lead =>
      siblings.some(group => normalizeIdentifier(lead.candidate?.siren || lead.candidate?.siret).startsWith(group.value)));
    const differentAddresses = valueGroups(sites, c => c?.adresse);
    if (sites.length >= 2 && differentAddresses.length >= 2 && !chosen(guidance, "address")) {
      suggestions.push(question("operator-sites", "address",
        "Cet organisme possède plusieurs établissements. Lequel accueille l’élève ?",
        "Le lieu choisi sera recherché séparément du siège et du gestionnaire.",
        differentAddresses.map(c => option("address", c.candidate, c.value)),
        anchor, 65 + Math.round(70 * partitionGain(differentAddresses)) + (chosen(guidance, "operator") ? 35 : 0), siblings.map(g => g.value).join(",")));
    }
  }

  if (plausible.length && !chosen(guidance, "address")) {
    const addresses = valueGroups(plausible, c => c?.adresse);
    const original = normalize(reference.Adresse);
    const disagree = original && addresses.length && addresses.every(c =>
      fuzzyTextScore(original, c.value) < 0.70);
    // This is a reported contradiction, NOT an assertion that Grist is wrong.
    if (disagree) {
      suggestions.push(question("address-contradiction", "address",
        "L’adresse enregistrée diffère de celles des établissements possibles. Reconnaissez-vous une adresse ?",
        "Une adresse corrigée permettra une nouvelle recherche géographique.",
        addresses.map(c => option("address", c.candidate, c.value)),
        anchor, 80 + Math.round(25 * partitionGain(addresses)), original));
    }
  }

  // A public place can be managed by a legal entity with a completely
  // different name. A candidate with a compatible address but dissimilar
  // public name can supply a *possible manager*, not the site identifier.
  // Keep this below a direct address contradiction and above an open question.
  if (!chosen(guidance, "operator") && reference.Adresse && chosenName) {
    const matches = raw.filter(lead => {
      const c = lead.candidate;
      const siren = normalizeIdentifier(c?.siren || c?.siret).slice(0, 9);
      return siren.length === 9 && c?.raisonSociale &&
        fuzzyTextScore(reference.Adresse, c?.adresse) >= 0.76 &&
        fuzzyTextScore(chosenName, placeName(c)) < 0.58;
    });
    const managers = valueGroups(matches, c => c?.raisonSociale);
    if (managers.length) {
      suggestions.push(question("possible-manager", "operator",
        "Le lieu recherché pourrait dépendre de cet organisme. Reconnaissez-vous son gestionnaire ?",
        "Sa confirmation permettra de rechercher d’autres établissements du même organisme, sans attribuer son SIRET au lieu de stage.",
        managers.map(c => option("operator", c.candidate, c.value)),
        anchor, 85, normalize(reference.Adresse)));
    }
  }

  if (!targetCommune && !knownPostal && !chosen(guidance, "commune")) {
    // Ask once the automatic search has yielded some evidence or has run to completion.
    if (hasCandidates || !searching) {
      const options = valueGroups(leads, municipality).map(c => option("commune", c.candidate, c.value));
      suggestions.push(question("missing-location", "commune",
        "Connaissez-vous la commune où l’élève effectue son stage ?",
        "Cette information permet de distinguer les homonymes et d’orienter la recherche.",
        options, anchor, options.length ? 55 + Math.round(60 * partitionGain(valueGroups(leads, municipality))) : 65, normalize(chosenName)));
    }
  }

  if ((!hasCandidates || !plausible.length) && !searching && !chosen(guidance, "name")) {
    suggestions.push(question("unidentified-name", "name",
      "Le nom indiqué ne suffit pas pour retrouver le lieu. Connaissez-vous un autre nom utilisé sur place ?",
      "Un nom d’enseigne ou un nom public peut être différent de la raison sociale.",
      [], anchor, 40, normalize(chosenName)));
  }

  // A source outage alone is not evidence of a wrong user address or name.
  // Contradictory observations for the same legal identifier demand independent
  // source verification first; a teacher's recognition cannot settle evidence.
  if (sourceConflicts.length) {
    return { blocker: "conflicting-sources", question: null,
      why: "Des sources décrivent différemment le même établissement. Vérification indépendante nécessaire.",
      candidateCount: raw.length, failedSourceCount: failedSources.length };
  }
  if (locationMismatch) {
    return { blocker: "guided-location-unconfirmed", question: null,
      why: searching
        ? "Aucune piste ne correspond encore au lieu indiqué. La recherche continue avec votre précision."
        : "Aucune piste trouvée ne correspond au lieu indiqué. Vous pouvez corriger votre précision ou approfondir la recherche.",
      candidateCount: raw.length, failedSourceCount: failedSources.length };
  }
  const possible = suggestions.filter(item => !ANSWERED.has(item.field) ||
    !chosen(guidance, item.field)).filter(item =>
      !(guidance?.skippedQuestions ?? []).includes(item.id) &&
      (!(guidance?.skippedFields ?? []).includes(item.field) ||
        item.kind === "address-contradiction"));
  possible.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  const next = possible[0] || null;
  const blocker = next?.kind === "homonyms" || next?.kind === "operator-sites"
    ? "ambiguous-sites" : next?.kind === "address-contradiction"
      ? "conflicting-address" : !hasCandidates && failedSources.length
        ? "sources-unavailable" : !hasCandidates ? "not-found" : "verification-needed";
  const why = next ? next.reason : failedSources.length
    ? "Certaines sources n’ont pas répondu. Cela ne signifie pas que les informations saisies sont fausses."
    : searching ? "La recherche automatique se poursuit." : "Les pistes disponibles nécessitent une vérification indépendante.";
  return { blocker, question: next, why, candidateCount: raw.length,
    failedSourceCount: failedSources.length };
}

export function skipDiscoveryQuestion(guidance, questionId) {
  if (!guidance || !questionId || typeof questionId !== "string") return false;
  const skipped = guidance.skippedQuestions ?? [];
  if (skipped.includes(questionId)) return false;
  guidance.skippedQuestions = [...skipped, questionId].slice(-40);
  // "Je ne sais pas" concerns the information, not the exact combination of
  // offered choices. Do not ask for the same field under a different heading.
  // A genuinely new address contradiction remains eligible for verification.
  const field = questionId.split("|")[1];
  if (ANSWERED.has(field)) {
    guidance.skippedFields = [...new Set([...(guidance.skippedFields ?? []), field])];
  }
  guidance.version = (guidance.version ?? 0) + 1;
  return true;
}
