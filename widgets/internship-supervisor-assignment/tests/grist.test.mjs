import test from "node:test";
import assert from "node:assert/strict";
import { buildAssignmentActions, buildStageCreationAction } from "../grist.js";

test("stage creation writes only the mapped student and period columns", () => {
  const action = buildStageCreationAction([
    { studentId: 11, period: 1 },
    { studentId: 12, period: 2 },
  ], {
    stageStudent: "Stagiaire",
    stagePeriod: "Numero_periode",
  });
  assert.deepEqual(action, [
    "BulkAddRecord",
    "Stage",
    [null, null],
    {
      Stagiaire: [11, 12],
      Numero_periode: [1, 2],
    },
  ]);
});

test("assignment updates the configured supervisor column", () => {
  const actions = buildAssignmentActions([
    { stageId: 41, teacherId: 21 },
    { stageId: 42, teacherId: 22 },
  ], { stageSupervisor: "Prof_suivi" });
  assert.deepEqual(actions, [
    ["UpdateRecord", "Stage", 41, { Prof_suivi: 21 }],
    ["UpdateRecord", "Stage", 42, { Prof_suivi: 22 }],
  ]);
});
