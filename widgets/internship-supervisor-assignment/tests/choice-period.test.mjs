import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStageCreationAction,
  stagePeriodWriteValue,
} from "../grist.js";
import {
  inferMappings,
  mappingDefinition,
} from "../mapping.js";

test("stage period mapping accepts a Grist Choice column", () => {
  const definition = mappingDefinition("stagePeriod");
  assert.deepEqual(definition.allowedTypes, ["Numeric", "Int", "Choice"]);

  const metadata = {
    tables: {
      Stage: {
        id: 5,
        columns: [
          {
            ref: 51,
            colId: "Periode",
            label: "Période",
            type: "Choice",
            writable: true,
          },
        ],
      },
    },
  };
  assert.equal(inferMappings(metadata).stagePeriod, "Periode");
});

test("stage periods stay numeric for Numeric and Int columns", () => {
  assert.equal(stagePeriodWriteValue("2", "Numeric"), 2);
  assert.equal(stagePeriodWriteValue(3, "Int"), 3);

  const action = buildStageCreationAction(
    [{ studentId: 11, period: 1 }, { studentId: 12, period: 2 }],
    { stageStudent: "Eleve", stagePeriod: "Periode" },
    "Stages",
    "Numeric",
  );
  assert.deepEqual(action[3].Periode, [1, 2]);
});

test("stage periods are serialized as text for a Choice column", () => {
  assert.equal(stagePeriodWriteValue(2, "Choice"), "2");

  const action = buildStageCreationAction(
    [{ studentId: 11, period: 1 }, { studentId: 12, period: 3 }],
    { stageStudent: "Eleve", stagePeriod: "Periode" },
    "Stages",
    "Choice",
  );
  assert.deepEqual(action, [
    "BulkAddRecord",
    "Stages",
    [null, null],
    {
      Eleve: [11, 12],
      Periode: ["1", "3"],
    },
  ]);
});

test("invalid stage periods are rejected before writing", () => {
  assert.throws(() => stagePeriodWriteValue("P2", "Choice"), /Période de stage invalide/);
});
