import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssignmentActions,
  buildStageCreationAction,
  normalizeSourceMappings,
  SOURCE_COLUMNS,
  sourceMappingSignature,
} from "../grist.js";

test("primary Classe source declares two required native Grist fields", () => {
  assert.deepEqual(SOURCE_COLUMNS, [
    { name: "ClassLabel", title: "Classe", type: "Text", optional: false },
    { name: "PeriodCount", title: "Nombre de périodes de stage", type: "Numeric", optional: false },
  ]);
});

test("native source mappings are normalized from Grist mapping names", () => {
  assert.deepEqual(normalizeSourceMappings({
    ClassLabel: "Classe",
    PeriodCount: "Nombre_de_periodes_de_stage",
  }), {
    classLabel: "Classe",
    classPeriodCount: "Nombre_de_periodes_de_stage",
  });
});

test("source mapping signature accepts normalized source mappings", () => {
  assert.equal(
    sourceMappingSignature({
      classLabel: "Classe",
      classPeriodCount: "Nombre_de_periodes_de_stage",
    }),
    JSON.stringify({
      classLabel: "Classe",
      classPeriodCount: "Nombre_de_periodes_de_stage",
    }),
  );
});

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
