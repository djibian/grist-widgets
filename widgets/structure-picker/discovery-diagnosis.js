// Active, deterministic diagnosis of what a teacher can usefully clarify.
// A question is an exploration hypothesis, never an identity/site/position proof.
import { discoveryHints } from "./discovery-progress.js";
import { extractLocationFromAddress, fuzzyTextScore, normalize, normalizeIdentifier } from "./search.js";

const ANSWERED = new Set(["name", "commune", "address", "operator", "siret"]);
const unique = values => [...new Map(values.filter(Boolean).map(value => [normalize(value), value])).values()];
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
  const plausible = raw.filter(lead =>
    !chosenName || fuzzyTextScore(chosenName, placeName(lead.candidate)) >= 0.68 ||
    fuzzyTextScore(chosenName, lead.candidate?.raisonSociale) >= 0.68);
  const leads = plausible.length ? plausible : raw;
  const hasCandidates = raw.length > 0;
  const originalLocation = extractLocationFromAddress(reference.Adresse);
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
        anchor, 100, normalize(chosenName)));
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
        anchor, chosen(guidance, "operator") ? 110 : 75, siblings.map(g => g.value).join(",")));
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
        anchor, 90, original));
    }
  }

  if (!targetCommune && !knownPostal && !chosen(guidance, "commune")) {
    // Ask once the automatic search has yielded some evidence or has run to completion.
    if (hasCandidates || !searching) {
      const options = valueGroups(leads, municipality).map(c => option("commune", c.candidate, c.value));
      suggestions.push(question("missing-location", "commune",
        "Connaissez-vous la commune où l’élève effectue son stage ?",
        "Cette information permet de distinguer les homonymes et d’orienter la recherche.",
        options, anchor, options.length ? 80 : 65, normalize(chosenName)));
    }
  }

  if (!hasCandidates && !searching && !chosen(guidance, "name")) {
    suggestions.push(question("unidentified-name", "name",
      "Le nom indiqué ne suffit pas pour retrouver le lieu. Connaissez-vous un autre nom utilisé sur place ?",
      "Un nom d’enseigne ou un nom public peut être différent de la raison sociale.",
      [], anchor, 40, normalize(chosenName)));
  }

  // A source outage alone is not evidence of a wrong user address or name.
  const possible = suggestions.filter(item => !ANSWERED.has(item.field) ||
    !chosen(guidance, item.field)).filter(item =>
      !(guidance?.skippedQuestions ?? []).includes(item.id));
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
  guidance.version = (guidance.version ?? 0) + 1;
  return true;
}
