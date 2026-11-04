// Ordinal evidence index, never a calibrated probability. The weakest unresolved
// dimension caps the result; contacts or proximity never erase a contradiction.
export function establishmentConfidence(decision, candidate) {
  const status = decision?.status;
  if (status === "AMBIGUOUS")
    return { score: 35, tone: "low", label: "Plusieurs lieux possibles" };
  if (status === "INCOMPLETE")
    return { score: 25, tone: "low", label: "Vérification incomplète" };
  if (status === "NO_MATCH" || !candidate)
    return { score: 0, tone: "low", label: "Informations insuffisantes" };
  if (candidate.position?.status === "CONFLICT")
    return { score: 40, tone: "low", label: "Localisation contradictoire" };
  if (status === "MATCH_PROBABLE")
    return { score: 55, tone: "medium", label: "À confirmer" };
  if (candidate.position?.status === "SITE_CONFIRMED")
    return { score: 95, tone: "high", label: "Lieu et position confirmés" };
  if (candidate.position?.status === "SITE_CORROBORATED")
    return {
      score: 85,
      tone: "high",
      label: "Lieu confirmé, position corroborée",
    };
  return {
    score: 75,
    tone: "medium",
    label: "Lieu confirmé, position à vérifier",
  };
}
