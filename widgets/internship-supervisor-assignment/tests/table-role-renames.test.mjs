import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssignmentActions,
  buildStageCreationAction,
  fetchSnapshot,
  serializeTableBindings,
} from "../grist.js";

function columnar(rows) {
  const keys = new Set(rows.flatMap(row => Object.keys(row)));
  const result = {};
  for (const key of keys) result[key] = rows.map(row => row[key] ?? null);
  return result;
}

function renamedDocument() {
  const tables = columnar([
    { id: 1, tableId: "Structures" },
    { id: 2, tableId: "Eleves_2026" },
    { id: 3, tableId: "Stages" },
    { id: 4, tableId: "Classes" },
    { id: 5, tableId: "Enseignants" },
    { id: 6, tableId: "Affectations" },
  ]);
  const columns = columnar([
    { id: 8, parentId: 1, colId: "Latitude", label: "Latitude", type: "Numeric", visibleCol: 0, isFormula: false, formula: "", parentPos: 1 },
    { id: 9, parentId: 1, colId: "Longitude", label: "Longitude", type: "Numeric", visibleCol: 0, isFormula: false, formula: "", parentPos: 2 },

    { id: 34, parentId: 2, colId: "Classe", label: "Classe", type: "Ref:Classes", visibleCol: 43, isFormula: false, formula: "", parentPos: 1 },
    { id: 47, parentId: 2, colId: "Identite", label: "Identité", type: "Text", visibleCol: 0, isFormula: true, formula: "$Nom", parentPos: 2 },

    { id: 36, parentId: 3, colId: "Eleve", label: "Élève", type: "Ref:Eleves_2026", visibleCol: 47, isFormula: false, formula: "", parentPos: 1 },
    { id: 38, parentId: 3, colId: "Structure_de_stage", label: "Structure", type: "Ref:Structures", visibleCol: 0, isFormula: false, formula: "", parentPos: 2 },
    { id: 61, parentId: 3, colId: "Periode", label: "Période", type: "Numeric", visibleCol: 0, isFormula: false, formula: "", parentPos: 3 },
    { id: 71, parentId: 3, colId: "Suivi_par", label: "Suivi par", type: "Ref:Enseignants", visibleCol: 73, isFormula: false, formula: "", parentPos: 4 },

    { id: 43, parentId: 4, colId: "Classe", label: "Classe", type: "Text", visibleCol: 0, isFormula: false, formula: "", parentPos: 1 },
    { id: 88, parentId: 4, colId: "Nombre_de_periodes_de_stage", label: "Nombre de périodes de stage", type: "Numeric", visibleCol: 0, isFormula: false, formula: "", parentPos: 2 },

    { id: 73, parentId: 5, colId: "Identite", label: "Identité", type: "Text", visibleCol: 0, isFormula: true, formula: "$Nom", parentPos: 1 },
    { id: 96, parentId: 5, colId: "Latitude", label: "Latitude", type: "Numeric", visibleCol: 0, isFormula: false, formula: "", parentPos: 2 },
    { id: 97, parentId: 5, colId: "Longitude", label: "Longitude", type: "Numeric", visibleCol: 0, isFormula: false, formula: "", parentPos: 3 },
    { id: 99, parentId: 5, colId: "Localisation_validee", label: "Localisation validée", type: "Bool", visibleCol: 0, isFormula: false, formula: "", parentPos: 4 },

    { id: 76, parentId: 6, colId: "Enseignant", label: "Enseignant", type: "Ref:Enseignants", visibleCol: 73, isFormula: false, formula: "", parentPos: 1 },
    { id: 78, parentId: 6, colId: "Classe", label: "Classe", type: "Ref:Classes", visibleCol: 43, isFormula: false, formula: "", parentPos: 2 },
    { id: 81, parentId: 6, colId: "Stages_a_suivre", label: "Stages à suivre", type: "Numeric", visibleCol: 0, isFormula: false, formula: "", parentPos: 3 },
    { id: 86, parentId: 6, colId: "Periode", label: "Période", type: "Numeric", visibleCol: 0, isFormula: false, formula: "", parentPos: 4 },
  ]);

  const stored = {
    version: 5,
    bindings: {
      teacherLatitude: { tableRef: 5, columnRef: 96 },
      teacherLongitude: { tableRef: 5, columnRef: 97 },
      teacherLocationValidated: { tableRef: 5, columnRef: 99 },
      quotaPeriod: { tableRef: 6, columnRef: 86 },
      quotaTarget: { tableRef: 6, columnRef: 81 },
      stagePeriod: { tableRef: 3, columnRef: 61 },
      structureLatitude: { tableRef: 1, columnRef: 8 },
      structureLongitude: { tableRef: 1, columnRef: 9 },
    },
    optimization: {
      geography: { enabled: true, priority: "forte" },
      diversity: { enabled: true, priority: "moyenne" },
    },
  };

  const data = {
    Classes: columnar([{ id: 2, Classe: "1A", Nombre_de_periodes_de_stage: 2 }]),
    Eleves_2026: columnar([{ id: 10, Classe: 2, Identite: "Alice Martin" }]),
    Enseignants: columnar([{ id: 20, Identite: "Mme Dupont", Latitude: 47.1, Longitude: -1.6, Localisation_validee: true }]),
    Affectations: columnar([{ id: 30, Enseignant: 20, Classe: 2, Stages_a_suivre: 1, Periode: 1 }]),
    Stages: columnar([{ id: 40, Eleve: 10, Structure_de_stage: 50, Periode: 1, Suivi_par: null }]),
    Structures: columnar([{ id: 50, Latitude: 47.2, Longitude: -1.7 }]),
  };

  return { tables, columns, stored, data };
}

test("all assignment table roles survive arbitrary Grist table renames", async () => {
  const previousGrist = globalThis.grist;
  const document = renamedDocument();
  const fetched = [];
  let migrated = null;

  globalThis.grist = {
    selectedTable: {
      async getTableId() { return "Classes"; },
    },
    sectionApi: {
      async mappings() {
        return { ClassLabel: "Classe", PeriodCount: "Nombre_de_periodes_de_stage" };
      },
    },
    widgetApi: {
      async getOption() { return document.stored; },
      async setOption(_key, value) { migrated = value; },
    },
    docApi: {
      async fetchTable(tableId) {
        fetched.push(tableId);
        if (tableId === "_grist_Tables") return document.tables;
        if (tableId === "_grist_Tables_column") return document.columns;
        if (document.data[tableId]) return document.data[tableId];
        throw new Error(`unexpected table ${tableId}`);
      },
    },
  };

  try {
    const snapshot = await fetchSnapshot({}, { geography: true });

    assert.deepEqual(snapshot.configuration.tableIds, {
      Classe: "Classes",
      Eleves: "Eleves_2026",
      Enseignant: "Enseignants",
      Affectation: "Affectations",
      Stage: "Stages",
      Structures_de_stage: "Structures",
    });
    assert.deepEqual(snapshot.configuration.mappingIssues, []);
    assert.deepEqual(snapshot.configuration.sourceMappingProblems, []);
    assert.equal(snapshot.classes[0].label, "1A");
    assert.equal(snapshot.students[0].label, "Alice Martin");
    assert.equal(snapshot.teachers[0].label, "Mme Dupont");
    assert.equal(snapshot.quotas[0].teacherId, 20);
    assert.equal(snapshot.stages[0].studentId, 10);
    assert.equal(snapshot.stages[0].structureId, 50);

    for (const actualTable of ["Classes", "Eleves_2026", "Enseignants", "Affectations", "Stages", "Structures"]) {
      assert.ok(fetched.includes(actualTable), `${actualTable} doit être lu sous son nom courant`);
    }
    for (const obsoleteName of ["Classe", "Eleves", "Enseignant", "Affectation", "Stage", "Structures_de_stage"]) {
      assert.equal(fetched.includes(obsoleteName), false, `${obsoleteName} ne doit pas être lu comme identifiant réel`);
    }

    const tableBindings = serializeTableBindings(snapshot.configuration.metadata);
    assert.deepEqual(tableBindings, {
      Classe: 4,
      Eleves: 2,
      Enseignant: 5,
      Affectation: 6,
      Stage: 3,
      Structures_de_stage: 1,
    });

    assert.equal(migrated, null, "fetchSnapshot ne doit pas modifier les options à lui seul");
  } finally {
    if (previousGrist === undefined) delete globalThis.grist;
    else globalThis.grist = previousGrist;
  }
});

test("stage writes target the renamed stage table", () => {
  const mappings = { stageStudent: "Eleve", stagePeriod: "Periode", stageSupervisor: "Suivi_par" };
  const create = buildStageCreationAction([{ studentId: 10, period: 2 }], mappings, "Stages");
  assert.equal(create[1], "Stages");

  const update = buildAssignmentActions([{ stageId: 40, teacherId: 20 }], mappings, "Stages");
  assert.equal(update[0][1], "Stages");
});
