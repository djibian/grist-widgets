import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeClass,
  AssignmentError,
  configurationFingerprint,
  generatePlan,
  geographicDistanceKm,
  periodsForClass,
  scoringModel,
  solveMinCostPeriod,
  stageCoverage,
  validCoordinates,
} from "../assignment.js";

function fixture() {
  return {
    classes: [{ id: 1, label: "1A", periodCount: 2 }],
    students: [
      { id: 11, label: "Alice", classId: 1 },
      { id: 12, label: "Bob", classId: 1 },
    ],
    teachers: [
      { id: 21, label: "Mme Dupont" },
      { id: 22, label: "M. Martin" },
    ],
    quotas: [
      { id: 31, teacherId: 21, classId: 1, period: 1, target: 1 },
      { id: 32, teacherId: 22, classId: 1, period: 1, target: 1 },
      { id: 33, teacherId: 21, classId: 1, period: 2, target: 1 },
      { id: 34, teacherId: 22, classId: 1, period: 2, target: 1 },
    ],
    stages: [
      { id: 41, studentId: 11, studentLabel: "Alice", classId: 1, period: 1, teacherId: null },
      { id: 42, studentId: 12, studentLabel: "Bob", classId: 1, period: 1, teacherId: null },
      { id: 43, studentId: 11, studentLabel: "Alice", classId: 1, period: 2, teacherId: null },
      { id: 44, studentId: 12, studentLabel: "Bob", classId: 1, period: 2, teacherId: null },
    ],
  };
}

function prepareGeography(data) {
  Object.assign(data.teachers[0], { latitude: 47.05, longitude: -1.50, locationValidated: true });
  Object.assign(data.teachers[1], { latitude: 47.45, longitude: -1.90, locationValidated: true });
  Object.assign(data.stages[0], { structureId: 101, latitude: 47.06, longitude: -1.51 });
  Object.assign(data.stages[1], { structureId: 102, latitude: 47.44, longitude: -1.89 });
  Object.assign(data.stages[2], { structureId: 103, latitude: 47.07, longitude: -1.52 });
  Object.assign(data.stages[3], { structureId: 104, latitude: 47.43, longitude: -1.88 });
  return data;
}

test("periodsForClass exposes only periods that exist", () => {
  assert.deepEqual(periodsForClass({ periodCount: 1 }), [1]);
  assert.deepEqual(periodsForClass({ periodCount: 4 }), [1, 2, 3, 4]);
  assert.deepEqual(periodsForClass({ periodCount: 0 }), []);
  assert.deepEqual(periodsForClass({ periodCount: 5 }), []);
  assert.deepEqual(periodsForClass({ periodCount: 2.5 }), []);
});

test("stageCoverage reports only missing stages in selected periods", () => {
  const data = fixture();
  data.stages = data.stages.filter(row => row.id !== 44 && row.id !== 41);
  const p2 = stageCoverage(data, 1, [2]);
  assert.equal(p2.expectedCount, 2);
  assert.equal(p2.presentCount, 1);
  assert.deepEqual(p2.missing.map(row => [row.studentId, row.period]), [[12, 2]]);
});

test("analysis distinguishes missing stages from quota consistency", () => {
  const data = fixture();
  data.stages.pop();
  const analysis = analyzeClass(data, 1, [2]);
  assert.ok(analysis.errors.some(row => row.code === "MISSING_STAGES"));
  assert.ok(!analysis.errors.some(row => row.code === "QUOTA_TOTAL_MISMATCH"));
});

test("analysis compares quotas with expected students even when rows are missing", () => {
  const data = fixture();
  data.stages.pop();
  data.quotas[2].target = 0;
  const analysis = analyzeClass(data, 1, [2]);
  assert.ok(analysis.errors.some(row => row.code === "MISSING_STAGES"));
  assert.ok(analysis.errors.some(row => row.code === "QUOTA_TOTAL_MISMATCH"));
});

test("analysis blocks duplicate stage rows for one student and period", () => {
  const data = fixture();
  data.stages.push({ id: 45, studentId: 11, studentLabel: "Alice", classId: 1, period: 1, teacherId: null });
  const analysis = analyzeClass(data, 1, [1]);
  assert.ok(analysis.errors.some(row => row.code === "DUPLICATE_STAGE"));
});

test("analysis blocks duplicate quota rows for a teacher/class/period", () => {
  const data = fixture();
  data.quotas.push({ id: 35, teacherId: 21, classId: 1, period: 1, target: 0 });
  const analysis = analyzeClass(data, 1, [1]);
  assert.ok(analysis.errors.some(row => row.code === "DUPLICATE_QUOTA"));
});

test("analysis blocks an existing assignment to an unauthorized teacher", () => {
  const data = fixture();
  data.teachers.push({ id: 23, label: "Mme Durand" });
  data.stages[0].teacherId = 23;
  const analysis = analyzeClass(data, 1, [1]);
  assert.ok(analysis.errors.some(row => row.code === "EXISTING_ASSIGNMENT_NOT_ALLOWED"));
});

test("analysis blocks an existing assignment beyond the exact quota", () => {
  const data = fixture();
  data.stages[0].teacherId = 21;
  data.stages[1].teacherId = 21;
  const analysis = analyzeClass(data, 1, [1]);
  assert.ok(analysis.errors.some(row => row.code === "EXISTING_ASSIGNMENT_OVER_QUOTA"));
});

test("plan respects every teacher quota and diversifies across periods", () => {
  const data = fixture();
  const plan = generatePlan(data, {
    classId: 1,
    periods: [1, 2],
    criteria: { diversity: { enabled: true, priority: "forte" } },
  });

  assert.equal(plan.assignments.length, 4);
  assert.equal(plan.metrics.introducedRepeats, 0);

  for (const period of [1, 2]) {
    const rows = plan.assignments.filter(row => row.period === period);
    assert.equal(rows.filter(row => row.teacherId === 21).length, 1);
    assert.equal(rows.filter(row => row.teacherId === 22).length, 1);
  }

  for (const studentId of [11, 12]) {
    const teacherIds = plan.assignments.filter(row => row.studentId === studentId).map(row => row.teacherId);
    assert.equal(new Set(teacherIds).size, 2);
  }
});

test("plan can treat only one selected period", () => {
  const data = fixture();
  const plan = generatePlan(data, { classId: 1, periods: [2] });
  assert.equal(plan.assignments.length, 2);
  assert.ok(plan.assignments.every(row => row.period === 2));
});

test("existing assignments are preserved and deducted from remaining quota", () => {
  const data = fixture();
  data.stages[0].teacherId = 21;
  const plan = generatePlan(data, { classId: 1, periods: [1] });
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].stageId, 42);
  assert.equal(plan.assignments[0].teacherId, 22);
  const dupont = plan.summary.find(row => row.period === 1 && row.teacherId === 21);
  assert.deepEqual(
    { existing: dupont.existing, proposed: dupont.proposed, total: dupont.total },
    { existing: 1, proposed: 0, total: 1 },
  );
});

test("plan is deterministic for identical data", () => {
  const data = fixture();
  const a = generatePlan(data, { classId: 1, periods: [1, 2] });
  const b = generatePlan(data, { classId: 1, periods: [1, 2] });
  assert.deepEqual(a.assignments, b.assignments);
});

test("fingerprint changes when class membership changes", () => {
  const data = fixture();
  const before = configurationFingerprint(data, 1);
  data.students[0].classId = 2;
  const after = configurationFingerprint(data, 1);
  assert.notEqual(before, after);
});

test("generatePlan refuses to produce a partial plan when a stage is missing", () => {
  const data = fixture();
  data.stages.pop();
  assert.throws(
    () => generatePlan(data, { classId: 1, periods: [2] }),
    error => error instanceof AssignmentError && error.issues.some(row => row.code === "MISSING_STAGES"),
  );
});

test("coordinate validation checks geographic bounds", () => {
  assert.equal(validCoordinates(47.1, -1.5), true);
  assert.equal(validCoordinates(91, -1.5), false);
  assert.equal(validCoordinates(47.1, -181), false);
  assert.equal(validCoordinates(null, -1.5), false);
});

test("geographicDistanceKm computes a realistic direct distance", () => {
  const distance = geographicDistanceKm(47.061, -1.51, 47.218, -1.553);
  assert.ok(distance > 17 && distance < 19);
  assert.equal(geographicDistanceKm(null, -1.51, 47.218, -1.553), null);
});

test("exact min-cost solver fixes a case where greedy allocation is very suboptimal", () => {
  const stages = [{ id: 1 }, { id: 2 }];
  const capacities = [
    { teacherId: 10, remaining: 1 },
    { teacherId: 20, remaining: 1 },
  ];
  const costs = new Map([
    ["1:10", 1],
    ["1:20", 2],
    ["2:10", 1.1],
    ["2:20", 100],
  ]);
  const rows = solveMinCostPeriod(stages, capacities, (stage, teacherId) => costs.get(`${stage.id}:${teacherId}`));
  assert.deepEqual(rows, [
    { stageId: 1, teacherId: 20 },
    { stageId: 2, teacherId: 10 },
  ]);
});

test("geographic criterion prefers the closest global allocation while preserving quotas", () => {
  const data = prepareGeography(fixture());
  const plan = generatePlan(data, {
    classId: 1,
    periods: [1],
    criteria: {
      diversity: { enabled: false, priority: "moyenne" },
      geography: { enabled: true, priority: "forte" },
    },
  });

  const alice = plan.assignments.find(row => row.studentId === 11);
  const bob = plan.assignments.find(row => row.studentId === 12);
  assert.equal(alice.teacherId, 21);
  assert.equal(bob.teacherId, 22);
  assert.ok(alice.distanceKm < 5);
  assert.ok(bob.distanceKm < 5);
  assert.equal(plan.metrics.geographicAssignments, 2);
  assert.ok(plan.metrics.totalDistanceKm > plan.metrics.averageDistanceKm);
});

test("geographic precheck requires human validation and usable structure coordinates", () => {
  const data = prepareGeography(fixture());
  data.teachers[1].locationValidated = false;
  data.stages[1].latitude = null;
  data.stages[1].longitude = null;

  const analysis = analyzeClass(data, 1, [1], { geography: { enabled: true, priority: "moyenne" } });
  assert.equal(analysis.geography.requiredTeacherCount, 2);
  assert.equal(analysis.geography.validTeacherCount, 1);
  assert.equal(analysis.geography.requiredStageCount, 2);
  assert.equal(analysis.geography.validStageCount, 1);
  assert.equal(analysis.geography.ready, false);
  assert.ok(analysis.errors.some(row => row.code === "TEACHER_LOCATION_NOT_VALIDATED"));
  assert.ok(analysis.errors.some(row => row.code === "MISSING_STAGE_COORDINATES"));
});

test("scoring model preserves distance magnitude and exposes the default trade-off", () => {
  const model = scoringModel({
    geography: { enabled: true, priority: "forte" },
    diversity: { enabled: true, priority: "moyenne" },
  });
  assert.equal(model.geographyFactor, 2);
  assert.equal(model.diversityPenalty, 10);
  assert.equal(model.repeatEquivalentKm, 5);
});

test("fingerprint changes when geographic data or validation changes", () => {
  const data = prepareGeography(fixture());
  const criteria = { geography: { enabled: true, priority: "moyenne" } };
  const before = configurationFingerprint(data, 1, criteria);
  data.stages[0].latitude = 47.07;
  const afterCoordinates = configurationFingerprint(data, 1, criteria);
  assert.notEqual(before, afterCoordinates);
  data.stages[0].latitude = 47.06;
  data.teachers[0].locationValidated = false;
  const afterValidation = configurationFingerprint(data, 1, criteria);
  assert.notEqual(before, afterValidation);
});

test("fingerprint ignores geographic data when proximity is disabled", () => {
  const data = fixture();
  const before = configurationFingerprint(data, 1);
  data.teachers[0].latitude = 47.05;
  data.teachers[0].locationValidated = true;
  data.stages[0].structureId = 101;
  data.stages[0].latitude = 47.06;
  const after = configurationFingerprint(data, 1);
  assert.equal(before, after);
});
