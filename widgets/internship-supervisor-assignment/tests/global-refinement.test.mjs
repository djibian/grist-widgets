import test from "node:test";
import assert from "node:assert/strict";
import {
  refineAssignmentsGlobally,
  scoreAssignmentsGlobally,
} from "../assignment.js";

function teacherCounts(rows, period) {
  const counts = new Map();
  for (const row of rows.filter(item => item.period === period)) {
    counts.set(row.teacherId, (counts.get(row.teacherId) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

test("coordinated refinement escapes a local optimum without changing period quotas", () => {
  const matrices = {
    1: [[5, 10, 25], [28, 6, 27], [0, 21, 29]],
    2: [[16, 17, 8], [23, 15, 19], [11, 25, 5]],
  };
  const initialTeachers = {
    1: [12, 11, 10],
    2: [11, 10, 12],
  };
  const stages = [];
  const assignments = [];
  const geographyByStage = new Map();
  let stageId = 1;

  for (const period of [1, 2]) {
    for (let studentIndex = 0; studentIndex < 3; studentIndex += 1) {
      const currentStageId = stageId++;
      stages.push({ id: currentStageId, studentId: studentIndex + 1, period });
      assignments.push({
        stageId: currentStageId,
        period,
        teacherId: initialTeachers[period][studentIndex],
        distanceKm: null,
      });
      const teacherCosts = new Map();
      for (let teacherIndex = 0; teacherIndex < 3; teacherIndex += 1) {
        const cost = matrices[period][studentIndex][teacherIndex];
        teacherCosts.set(teacherIndex + 10, { cost, distanceKm: cost });
      }
      geographyByStage.set(currentStageId, teacherCosts);
    }
  }

  const context = {
    stagesById: new Map(stages.map(row => [row.id, row])),
    basePairs: new Map(),
    scoring: {
      geography: true,
      diversity: true,
      diversityPenalty: 10,
    },
    geographyByStage,
  };

  const before = scoreAssignmentsGlobally(assignments, context);
  const refined = refineAssignmentsGlobally(assignments, context);

  assert.equal(before, 76);
  assert.equal(refined.score, 73);
  assert.equal(refined.initialScore, 76);
  assert.equal(refined.steps, 1);
  assert.equal(refined.coordinatedSteps, 1);

  for (const period of [1, 2]) {
    assert.deepEqual(
      teacherCounts(refined.assignments, period),
      teacherCounts(assignments, period),
      `les quotas de P${period} doivent rester strictement identiques`,
    );
  }
});

test("global refinement never mutates the proposal passed by the caller", () => {
  const assignments = [
    { stageId: 1, period: 1, teacherId: 10, distanceKm: 2 },
    { stageId: 2, period: 1, teacherId: 11, distanceKm: 1 },
  ];
  const original = structuredClone(assignments);
  const context = {
    stagesById: new Map([
      [1, { id: 1, studentId: 1 }],
      [2, { id: 2, studentId: 2 }],
    ]),
    basePairs: new Map(),
    scoring: { geography: true, diversity: false, diversityPenalty: 0 },
    geographyByStage: new Map([
      [1, new Map([[10, { cost: 2, distanceKm: 2 }], [11, { cost: 8, distanceKm: 8 }]])],
      [2, new Map([[10, { cost: 7, distanceKm: 7 }], [11, { cost: 1, distanceKm: 1 }]])],
    ]),
  };

  refineAssignmentsGlobally(assignments, context);
  assert.deepEqual(assignments, original);
});
