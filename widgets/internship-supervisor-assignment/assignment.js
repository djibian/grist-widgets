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
const issue = (code, message, details = {}) => ({ code, message, ...details });

export function periodsForClass(row) {
  const n = int(row?.periodCount);
  return n && n >= 1 && n <= 4 ? Array.from({ length: n }, (_, i) => i + 1) : [];
}

function selectedPeriodsForClass(cls, selectedPeriods) {
  const available = periodsForClass(cls);
  const selected = [...new Set((selectedPeriods || []).map(int).filter(period => available.includes(period)))].sort((a, b) => a - b);
  return { available, selected };
}

export function stageCoverage(snapshot, classId, selectedPeriods) {
  const cid = id(classId);
  const cls = snapshot.classes.find(row => row.id === cid);
  const errors = [];
  if (!cls) {
    return {
      classRow: null,
      periods: [],
      availablePeriods: [],
      students: [],
      expected: [],
      existing: [],
      missing: [],
      errors: [issue("CLASS_NOT_FOUND", "La classe sélectionnée n'existe plus.")],
    };
  }

  const { available, selected } = selectedPeriodsForClass(cls, selectedPeriods);
  if (!available.length) errors.push(issue("INVALID_PERIOD_COUNT", `Le nombre de périodes de ${cls.label} doit être un entier entre 1 et 4.`));
  if (!selected.length) errors.push(issue("NO_PERIOD_SELECTED", "Sélectionne au moins une période à traiter."));

  const students = snapshot.students.filter(row => row.classId === cid).sort((a, b) => a.id - b.id);
  if (!students.length) errors.push(issue("NO_STUDENTS", `${cls.label} ne contient aucun élève.`));
  const studentIds = new Set(students.map(row => row.id));
  const selectedSet = new Set(selected);
  const existing = snapshot.stages
    .filter(stage => studentIds.has(stage.studentId) && selectedSet.has(stage.period))
    .sort((a, b) => a.period - b.period || a.studentId - b.studentId || a.id - b.id);

  const byPair = new Map();
  for (const stage of existing) {
    const pair = key(stage.studentId, stage.period);
    const rows = byPair.get(pair) ?? [];
    rows.push(stage);
    byPair.set(pair, rows);
  }

  for (const rows of byPair.values()) {
    if (rows.length < 2) continue;
    const first = rows[0];
    errors.push(issue(
      "DUPLICATE_STAGE",
      `${first.studentLabel} possède plusieurs stages en période ${first.period}.`,
      { studentId: first.studentId, period: first.period, stageIds: rows.map(row => row.id) },
    ));
  }

  const expected = [];
  const missing = [];
  for (const period of selected) {
    for (const student of students) {
      const pair = key(student.id, period);
      const row = { studentId: student.id, studentLabel: student.label, period };
      expected.push(row);
      if (!byPair.has(pair)) missing.push(row);
    }
  }

  return {
    classRow: cls,
    periods: selected,
    availablePeriods: available,
    students,
    expected,
    existing,
    missing,
    errors,
    expectedCount: expected.length,
    presentCount: existing.length,
    uniquePresentCount: byPair.size,
    missingCount: missing.length,
  };
}

export function analyzeClass(snapshot, classId, selectedPeriods) {
  const cid = id(classId);
  const coverage = stageCoverage(snapshot, cid, selectedPeriods);
  const errors = [...coverage.errors];
  if (!coverage.classRow) return { ...coverage, periodStates: [], errors };

  const cls = coverage.classRow;
  const teachers = new Map(snapshot.teachers.map(row => [row.id, row]));
  const selectedSet = new Set(coverage.periods);
  const quotas = snapshot.quotas.filter(row => row.classId === cid && selectedSet.has(row.period));
  const quotaPairs = new Set();

  for (const quota of quotas) {
    if (!teachers.has(quota.teacherId)) errors.push(issue("INVALID_QUOTA_TEACHER", `L'affectation #${quota.id} ne référence aucun enseignant valide.`));
    if (!Number.isInteger(quota.target) || quota.target < 0) errors.push(issue("INVALID_QUOTA_TARGET", `Le quota de l'affectation #${quota.id} doit être un entier positif ou nul.`));
    const pair = key(quota.teacherId, quota.period);
    if (quotaPairs.has(pair)) errors.push(issue("DUPLICATE_QUOTA", `Un enseignant apparaît plusieurs fois dans Affectation pour la période ${quota.period}.`));
    quotaPairs.add(pair);
  }

  if (coverage.missing.length) {
    errors.push(issue(
      "MISSING_STAGES",
      `${coverage.missing.length} stage(s) sont encore à créer pour les périodes sélectionnées.`,
      { missingCount: coverage.missing.length },
    ));
  }

  const periodStates = [];
  for (const period of coverage.periods) {
    const stages = coverage.existing.filter(row => row.period === period);
    const periodQuotas = quotas.filter(row => row.period === period);
    const targetTotal = periodQuotas.reduce((sum, row) => sum + (Number.isInteger(row.target) ? row.target : 0), 0);
    const expectedCount = coverage.students.length;
    if (targetTotal !== expectedCount) {
      errors.push(issue(
        "QUOTA_TOTAL_MISMATCH",
        `${cls.label} — période ${period} : ${expectedCount} stage(s) attendu(s), mais ${targetTotal} suivi(s) prévus dans Affectation.`,
        { period, expectedCount, targetTotal },
      ));
    }

    const quotaByTeacher = new Map(periodQuotas.map(row => [row.teacherId, row]));
    const existingByTeacher = new Map();
    for (const stage of stages) {
      if (!stage.teacherId) continue;
      if (!quotaByTeacher.has(stage.teacherId)) {
        errors.push(issue(
          "EXISTING_ASSIGNMENT_NOT_ALLOWED",
          `${stage.studentLabel} est déjà suivi par un enseignant non affecté à cette classe en période ${period}.`,
          { stageId: stage.id, teacherId: stage.teacherId, period },
        ));
      }
      existingByTeacher.set(stage.teacherId, (existingByTeacher.get(stage.teacherId) || 0) + 1);
    }

    const capacities = periodQuotas.map(row => {
      const already = existingByTeacher.get(row.teacherId) || 0;
      if (already > row.target) {
        errors.push(issue(
          "EXISTING_ASSIGNMENT_OVER_QUOTA",
          `${teachers.get(row.teacherId)?.label || (`Enseignant #${row.teacherId}`)} dépasse déjà son quota en période ${period}.`,
          { teacherId: row.teacherId, period, existing: already, target: row.target },
        ));
      }
      return {
        teacherId: row.teacherId,
        teacherLabel: teachers.get(row.teacherId)?.label || (`Enseignant #${row.teacherId}`),
        target: row.target,
        existing: already,
        remaining: Math.max(0, row.target - already),
      };
    });

    periodStates.push({
      period,
      stages,
      quotas: periodQuotas,
      capacities,
      unassignedStages: stages.filter(row => !row.teacherId),
    });
  }

  const existingSelectedCount = coverage.existing.filter(row => row.teacherId).length;
  return {
    ...coverage,
    errors,
    warnings: [],
    classQuotas: quotas,
    periodStates,
    selectedStageCount: coverage.expectedCount,
    existingSelectedCount,
    unassignedSelectedCount: Math.max(0, coverage.presentCount - existingSelectedCount),
  };
}

function minCostPeriod(stages, capacities, cost) {
  const remaining = new Map(capacities.map(row => [row.teacherId, row.remaining]));
  const result = [];
  const rows = [...stages].sort((a, b) => a.id - b.id);
  for (const stage of rows) {
    const candidates = capacities
      .filter(row => (remaining.get(row.teacherId) || 0) > 0)
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
  const students = snapshot.students
    .filter(row => row.classId === cid)
    .map(row => [row.id, row.classId])
    .sort((a, b) => a[0] - b[0]);
  const studentIds = new Set(students.map(row => row[0]));
  const stages = snapshot.stages
    .filter(row => studentIds.has(row.studentId))
    .map(row => [row.id, row.studentId, row.period, row.teacherId || 0])
    .sort((a, b) => a[0] - b[0]);
  const quotas = snapshot.quotas
    .filter(row => row.classId === cid)
    .map(row => [row.id, row.teacherId, row.period, row.target])
    .sort((a, b) => a[0] - b[0]);
  return JSON.stringify({ class: cls ? [cls.id, cls.periodCount] : null, students, stages, quotas });
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
  for (const stage of analysis.existing) {
    if (!stage.studentId || !stage.teacherId) continue;
    const pair = key(stage.studentId, stage.teacherId);
    basePairs.set(pair, (basePairs.get(pair) || 0) + 1);
  }

  let best = null;
  const stateByPeriod = new Map(analysis.periodStates.map(row => [row.period, row]));
  for (const order of permutations(analysis.periods)) {
    const pairs = new Map(basePairs);
    const assignments = [];
    let score = 0;
    for (const period of order) {
      const state = stateByPeriod.get(period);
      const rows = minCostPeriod(
        state.unassignedStages,
        state.capacities,
        (stage, teacherId) => diversity ? (pairs.get(key(stage.studentId, teacherId)) || 0) * weight : 0,
      );
      for (const row of rows) {
        const stage = stagesById.get(row.stageId);
        const addedCost = diversity ? (pairs.get(key(stage.studentId, row.teacherId)) || 0) * weight : 0;
        score += addedCost;
        assignments.push({ ...row, period });
        const pair = key(stage.studentId, row.teacherId);
        pairs.set(pair, (pairs.get(pair) || 0) + 1);
      }
    }
    const signature = assignments.map(row => `${row.stageId}:${row.teacherId}`).sort().join("|");
    if (!best || score < best.score || (score === best.score && signature < best.signature)) {
      best = { score, signature, assignments };
    }
  }

  const assignments = (best?.assignments || []).map(row => {
    const stage = stagesById.get(row.stageId);
    return {
      ...row,
      studentId: stage.studentId,
      studentLabel: stage.studentLabel,
      teacherLabel: teachers.get(row.teacherId)?.label || (`Enseignant #${row.teacherId}`),
    };
  }).sort((a, b) => a.period - b.period || a.studentLabel.localeCompare(b.studentLabel, "fr") || a.stageId - b.stageId);

  const summary = [];
  for (const state of analysis.periodStates) {
    for (const capacity of state.capacities) {
      const proposed = assignments.filter(row => row.period === state.period && row.teacherId === capacity.teacherId).length;
      summary.push({
        period: state.period,
        teacherId: capacity.teacherId,
        teacherLabel: capacity.teacherLabel,
        target: capacity.target,
        existing: capacity.existing,
        proposed,
        total: capacity.existing + proposed,
      });
    }
  }

  const proposedPairs = new Map();
  let repeats = 0;
  for (const row of assignments) {
    const pair = key(row.studentId, row.teacherId);
    if ((basePairs.get(pair) || 0) > 0 || (proposedPairs.get(pair) || 0) > 0) repeats += 1;
    proposedPairs.set(pair, (proposedPairs.get(pair) || 0) + 1);
  }

  return {
    classId: cid,
    classLabel: analysis.classRow.label,
    periods: analysis.periods,
    criteria: { diversity: { enabled: diversity, priority } },
    fingerprint: configurationFingerprint(snapshot, cid),
    assignments,
    summary,
    metrics: {
      selectedStageCount: analysis.selectedStageCount,
      existingCount: analysis.existingSelectedCount,
      newCount: assignments.length,
      introducedRepeats: repeats,
      diversifiedAssignments: assignments.length - repeats,
    },
  };
}
