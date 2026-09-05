export const PRIORITY_WEIGHTS = Object.freeze({ faible: 1, moyenne: 4, forte: 12 });

export class AssignmentError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "AssignmentError";
    this.issues = issues;
  }
}

const int = value => Number.isInteger(Number(value)) ? Number(value) : null;
const id = value => { const n = int(value); return n && n > 0 ? n : null; };
const key = (a, b) => String(a) + ":" + String(b);
const issue = (code, message) => ({ code, message });

export function periodsForClass(row) {
  const n = int(row?.periodCount);
  return n && n >= 1 && n <= 4 ? Array.from({ length: n }, (_, i) => i + 1) : [];
}

export function classOptions(snapshot) {
  return snapshot.classes.map(row => ({
    id: row.id,
    label: String(row.label || ("Classe #" + row.id)),
    periodCount: row.periodCount,
    periods: periodsForClass(row),
  })).sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export function analyzeClass(snapshot, classId, selectedPeriods) {
  const cid = id(classId);
  const cls = snapshot.classes.find(row => row.id === cid);
  const errors = [];
  if (!cls) return { errors: [issue("CLASS_NOT_FOUND", "La classe sélectionnée n'existe plus.")], periods: [], periodStates: [] };

  const available = periodsForClass(cls);
  const selected = [...new Set((selectedPeriods || []).map(int).filter(p => available.includes(p)))].sort((a, b) => a - b);
  if (!available.length) errors.push(issue("INVALID_PERIOD_COUNT", "Le nombre de périodes de " + cls.label + " doit être un entier entre 1 et 4."));
  if (!selected.length) errors.push(issue("NO_PERIOD_SELECTED", "Sélectionne au moins une période à traiter."));

  const teachers = new Map(snapshot.teachers.map(row => [row.id, row]));
  const students = new Map(snapshot.students.map(row => [row.id, row]));
  const stages = snapshot.stages.filter(row => row.classId === cid);
  const quotas = snapshot.quotas.filter(row => row.classId === cid);

  const stagePairs = new Set();
  for (const stage of stages) {
    const student = students.get(stage.studentId);
    if (!student) { errors.push(issue("INVALID_STAGE_STUDENT", "Le stage #" + stage.id + " n'a pas d'élève valide.")); continue; }
    if (student.classId !== cid) errors.push(issue("STAGE_CLASS_MISMATCH", "Le stage #" + stage.id + " et son élève n'appartiennent pas à la même classe."));
    if (!available.includes(stage.period)) { errors.push(issue("INVALID_STAGE_PERIOD", "Le stage de " + student.label + " possède une période inexistante.")); continue; }
    const k = key(stage.studentId, stage.period);
    if (stagePairs.has(k)) errors.push(issue("DUPLICATE_STAGE", student.label + " possède plusieurs stages en période " + stage.period + "."));
    stagePairs.add(k);
  }

  const quotaPairs = new Set();
  for (const quota of quotas) {
    if (!teachers.has(quota.teacherId)) errors.push(issue("INVALID_QUOTA_TEACHER", "L'affectation #" + quota.id + " ne référence aucun enseignant valide."));
    if (!available.includes(quota.period)) errors.push(issue("INVALID_QUOTA_PERIOD", "L'affectation #" + quota.id + " possède une période inexistante."));
    if (!Number.isInteger(quota.target) || quota.target < 0) errors.push(issue("INVALID_QUOTA_TARGET", "Le quota de l'affectation #" + quota.id + " doit être un entier positif ou nul."));
    const k = key(quota.teacherId, quota.period);
    if (quotaPairs.has(k)) errors.push(issue("DUPLICATE_QUOTA", "Un enseignant apparaît plusieurs fois dans Affectation pour la période " + quota.period + "."));
    quotaPairs.add(k);
  }

  const periodStates = [];
  for (const period of selected) {
    const ps = stages.filter(row => row.period === period);
    const pq = quotas.filter(row => row.period === period);
    const targetTotal = pq.reduce((sum, row) => sum + (Number.isInteger(row.target) ? row.target : 0), 0);
    if (targetTotal !== ps.length) errors.push(issue("QUOTA_TOTAL_MISMATCH", cls.label + " — période " + period + " : " + ps.length + " stage(s), mais " + targetTotal + " suivi(s) prévus."));

    const quotaByTeacher = new Map(pq.map(row => [row.teacherId, row]));
    const existing = new Map();
    for (const stage of ps) {
      if (!stage.teacherId) continue;
      if (!quotaByTeacher.has(stage.teacherId)) errors.push(issue("EXISTING_ASSIGNMENT_NOT_ALLOWED", stage.studentLabel + " est déjà suivi par un enseignant non affecté à cette classe/période."));
      existing.set(stage.teacherId, (existing.get(stage.teacherId) || 0) + 1);
    }

    const capacities = pq.map(row => {
      const already = existing.get(row.teacherId) || 0;
      if (already > row.target) errors.push(issue("EXISTING_ASSIGNMENT_OVER_QUOTA", (teachers.get(row.teacherId)?.label || ("Enseignant #" + row.teacherId)) + " dépasse déjà son quota en période " + period + "."));
      return { teacherId: row.teacherId, teacherLabel: teachers.get(row.teacherId)?.label || ("Enseignant #" + row.teacherId), target: row.target, existing: already, remaining: Math.max(0, row.target - already) };
    });
    const unassignedStages = ps.filter(row => !row.teacherId);
    periodStates.push({ period, stages: ps, quotas: pq, capacities, unassignedStages });
  }

  const selectedSet = new Set(selected);
  const selectedStages = stages.filter(row => selectedSet.has(row.period));
  const existingSelectedCount = selectedStages.filter(row => row.teacherId).length;
  return {
    classRow: cls, errors, warnings: [], periods: selected, availablePeriods: available,
    classStages: stages, classQuotas: quotas, periodStates,
    selectedStageCount: selectedStages.length,
    existingSelectedCount,
    unassignedSelectedCount: selectedStages.length - existingSelectedCount,
  };
}

function minCostPeriod(stages, capacities, cost) {
  const remaining = new Map(capacities.map(row => [row.teacherId, row.remaining]));
  const result = [];
  const rows = [...stages].sort((a, b) => a.id - b.id);
  for (const stage of rows) {
    const candidates = capacities.filter(row => (remaining.get(row.teacherId) || 0) > 0)
      .map(row => ({ teacherId: row.teacherId, cost: cost(stage, row.teacherId), remaining: remaining.get(row.teacherId) }))
      .sort((a, b) => a.cost - b.cost || b.remaining - a.remaining || a.teacherId - b.teacherId);
    if (!candidates.length) throw new AssignmentError("Impossible de satisfaire les quotas.");
    const chosen = candidates[0];
    remaining.set(chosen.teacherId, chosen.remaining - 1);
    result.push({ stageId: stage.id, teacherId: chosen.teacherId });
  }
  return result;
}

function permutations(values) {
  if (values.length < 2) return [values.slice()];
  const out = [];
  values.forEach((value, i) => {
    for (const tail of permutations(values.slice(0, i).concat(values.slice(i + 1)))) out.push([value].concat(tail));
  });
  return out;
}

export function configurationFingerprint(snapshot, classId) {
  const cid = id(classId);
  const cls = snapshot.classes.find(row => row.id === cid);
  const stages = snapshot.stages.filter(row => row.classId === cid).map(row => [row.id, row.studentId, row.period, row.teacherId || 0]).sort((a, b) => a[0] - b[0]);
  const quotas = snapshot.quotas.filter(row => row.classId === cid).map(row => [row.id, row.teacherId, row.period, row.target]).sort((a, b) => a[0] - b[0]);
  return JSON.stringify({ class: cls ? [cls.id, cls.periodCount] : null, stages, quotas });
}

export function generatePlan(snapshot, options) {
  const cid = id(options?.classId);
  const analysis = analyzeClass(snapshot, cid, options?.periods || []);
  if (analysis.errors.length) throw new AssignmentError("Les données doivent être corrigées avant le calcul.", analysis.errors);

  const diversity = options?.criteria?.diversity?.enabled !== false;
  const priority = PRIORITY_WEIGHTS[options?.criteria?.diversity?.priority] ? options.criteria.diversity.priority : "moyenne";
  const weight = PRIORITY_WEIGHTS[priority];
  const stagesById = new Map(snapshot.stages.map(row => [row.id, row]));
  const teachers = new Map(snapshot.teachers.map(row => [row.id, row]));
  const basePairs = new Map();
  for (const stage of analysis.classStages) if (stage.studentId && stage.teacherId) basePairs.set(key(stage.studentId, stage.teacherId), (basePairs.get(key(stage.studentId, stage.teacherId)) || 0) + 1);

  let best = null;
  const stateByPeriod = new Map(analysis.periodStates.map(row => [row.period, row]));
  for (const order of permutations(analysis.periods)) {
    const pairs = new Map(basePairs);
    const assignments = [];
    let score = 0;
    for (const period of order) {
      const state = stateByPeriod.get(period);
      const rows = minCostPeriod(state.unassignedStages, state.capacities, (stage, teacherId) => diversity ? (pairs.get(key(stage.studentId, teacherId)) || 0) * weight : 0);
      for (const row of rows) {
        const stage = stagesById.get(row.stageId);
        const c = diversity ? (pairs.get(key(stage.studentId, row.teacherId)) || 0) * weight : 0;
        score += c;
        assignments.push({ ...row, period });
        pairs.set(key(stage.studentId, row.teacherId), (pairs.get(key(stage.studentId, row.teacherId)) || 0) + 1);
      }
    }
    const signature = assignments.map(row => row.stageId + ":" + row.teacherId).sort().join("|");
    if (!best || score < best.score || (score === best.score && signature < best.signature)) best = { score, signature, assignments };
  }

  const assignments = (best?.assignments || []).map(row => {
    const stage = stagesById.get(row.stageId);
    return { ...row, studentId: stage.studentId, studentLabel: stage.studentLabel, teacherLabel: teachers.get(row.teacherId)?.label || ("Enseignant #" + row.teacherId) };
  }).sort((a, b) => a.period - b.period || a.studentLabel.localeCompare(b.studentLabel, "fr") || a.stageId - b.stageId);

  const summary = [];
  for (const state of analysis.periodStates) for (const cap of state.capacities) {
    const proposed = assignments.filter(row => row.period === state.period && row.teacherId === cap.teacherId).length;
    summary.push({ period: state.period, teacherId: cap.teacherId, teacherLabel: cap.teacherLabel, target: cap.target, existing: cap.existing, proposed, total: cap.existing + proposed });
  }

  const proposedPairs = new Map();
  let repeats = 0;
  for (const row of assignments) {
    const k = key(row.studentId, row.teacherId);
    if ((basePairs.get(k) || 0) > 0 || (proposedPairs.get(k) || 0) > 0) repeats += 1;
    proposedPairs.set(k, (proposedPairs.get(k) || 0) + 1);
  }

  return {
    classId: cid, classLabel: analysis.classRow.label, periods: analysis.periods,
    criteria: { diversity: { enabled: diversity, priority } },
    fingerprint: configurationFingerprint(snapshot, cid), assignments, summary,
    metrics: { selectedStageCount: analysis.selectedStageCount, existingCount: analysis.existingSelectedCount, newCount: assignments.length, introducedRepeats: repeats, diversifiedAssignments: assignments.length - repeats },
  };
}
