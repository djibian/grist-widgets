import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeClass,
  AssignmentError,
  configurationFingerprint,
  generatePlan,
  periodsForClass,
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
    configuration: { missingColumns: [], followupWritable: true },
  };
}

test("periodsForClass exposes only periods that exist", () => {
  assert.deepEqual(periodsForClass({ periodCount: 1 }), [1]);
  assert.deepEqual(periodsForClass({ periodCount: 4 }), [1, 2, 3, 4]);
  assert.deepEqual(periodsForClass({ periodCount: 0 }), []);
  assert.deepEqual(periodsForClass({ periodCount: 5 }), []);
  assert.deepEqual(periodsForClass({ periodCount: 2.5 }), []);
});

test("analysis blocks a mismatch between stages and quotas", () => {
  const data = fixture();
  data.quotas[0].target = 0;
  const analysis = analyzeClass(data, 1, [1]);
  assert.ok(analysis.errors.some(row => row.code === "QUOTA_TOTAL_MISMATCH"));
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

test("fingerprint changes when a relevant assignment changes", () => {
  const data = fixture();
  const before = configurationFingerprint(data, 1);
  data.stages[0].teacherId = 21;
  const after = configurationFingerprint(data, 1);
  assert.notEqual(before, after);
});

test("generatePlan exposes validation issues instead of producing a partial plan", () => {
  const data = fixture();
  data.stages.pop();
  assert.throws(
    () => generatePlan(data, { classId: 1, periods: [2] }),
    error => error instanceof AssignmentError && error.issues.some(row => row.code === "QUOTA_TOTAL_MISMATCH"),
  );
});
