import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIGURABLE_MAPPING_DEFS,
  inferMappings,
  mappingGroups,
  mappingSignature,
  serializeBindings,
  validateMappings,
} from "../mapping.js";

function metadata() {
  let columnRef = 1;
  const table = (id, columns) => ({
    id,
    columns: columns.map(column => ({ ref: columnRef++, writable: true, type: "Text", visibleColRef: null, ...column })),
  });
  const data = {
    tables: {
      Classe: table(4, [
        { colId: "Classe", label: "Classe" },
        { colId: "Nombre_de_periodes_de_stage", label: "Nombre de périodes de stage", type: "Numeric" },
      ]),
      Eleves: table(2, [
        { colId: "Classe", label: "Classe", type: "Ref:Classe" },
        { colId: "Nom", label: "Nom", writable: true },
        { colId: "Identite", label: "Identité", writable: false },
      ]),
      Enseignant: table(5, [
        { colId: "Nom", label: "Nom", writable: true },
        { colId: "Identite", label: "Identité", writable: false },
        { colId: "Latitude", label: "Latitude", type: "Numeric" },
        { colId: "Longitude", label: "Longitude", type: "Numeric" },
        { colId: "Localisation_validee", label: "Localisation validée", type: "Bool" },
      ]),
      Affectation: table(6, [
        { colId: "Enseignant", label: "Enseignant", type: "Ref:Enseignant" },
        { colId: "Classe", label: "Classe", type: "Ref:Classe" },
        { colId: "Periode", label: "Période", type: "Numeric" },
        { colId: "Nombre_de_stage_a_suivre", label: "Nombre de stage à suivre", type: "Numeric" },
      ]),
      Stage: table(3, [
        { colId: "Eleve", label: "Élève", type: "Ref:Eleves", writable: true },
        { colId: "Periode", label: "Période", type: "Numeric" },
        { colId: "Suivi_par", label: "Suivi par", type: "Ref:Enseignant", writable: true },
        { colId: "Structure_de_stage", label: "Structure de stage", type: "Ref:Structures_de_stage" },
      ]),
      Structures_de_stage: table(1, [
        { colId: "Latitude", label: "Latitude", type: "Numeric" },
        { colId: "Longitude", label: "Longitude", type: "Numeric" },
      ]),
    },
  };

  const refOf = (tableId, colId) => data.tables[tableId].columns.find(column => column.colId === colId).ref;
  data.tables.Stage.columns.find(column => column.colId === "Eleve").visibleColRef = refOf("Eleves", "Identite");
  data.tables.Stage.columns.find(column => column.colId === "Suivi_par").visibleColRef = refOf("Enseignant", "Identite");
  data.tables.Affectation.columns.find(column => column.colId === "Enseignant").visibleColRef = refOf("Enseignant", "Identite");
  return data;
}

test("inferMappings derives relations and visible labels from Grist metadata", () => {
  const mappings = inferMappings(metadata());
  assert.equal(mappings.studentClass, "Classe");
  assert.equal(mappings.studentLabel, "Identite");
  assert.equal(mappings.teacherLabel, "Identite");
  assert.equal(mappings.quotaTeacher, "Enseignant");
  assert.equal(mappings.quotaClass, "Classe");
  assert.equal(mappings.stageStudent, "Eleve");
  assert.equal(mappings.stageSupervisor, "Suivi_par");
  assert.equal(mappings.stageStructure, "Structure_de_stage");
});

test("inferMappings recognises the standard semantic contract", () => {
  const mappings = inferMappings(metadata());
  assert.equal(mappings.quotaTarget, "Nombre_de_stage_a_suivre");
  assert.equal(mappings.quotaPeriod, "Periode");
  assert.equal(mappings.stagePeriod, "Periode");
  assert.equal(mappings.teacherLatitude, "Latitude");
  assert.equal(mappings.teacherLongitude, "Longitude");
  assert.equal(mappings.teacherLocationValidated, "Localisation_validee");
  assert.equal(mappings.structureLatitude, "Latitude");
  assert.equal(mappings.structureLongitude, "Longitude");
});

test("only the eight semantic mappings remain configurable", () => {
  assert.equal(CONFIGURABLE_MAPPING_DEFS.length, 8);
  assert.deepEqual(mappingGroups().map(group => group.table), ["Enseignant", "Affectation", "Stage", "Structures_de_stage"]);
  assert.deepEqual(
    mappingGroups().flatMap(group => group.fields.map(field => field.key)),
    [
      "teacherLatitude", "teacherLongitude", "teacherLocationValidated",
      "quotaPeriod", "quotaTarget", "stagePeriod",
      "structureLatitude", "structureLongitude",
    ],
  );
});

test("structural mappings survive arbitrary column renames without saved mappings", () => {
  const data = metadata();
  const renamed = [
    ["Eleves", "Classe", "Groupe"],
    ["Affectation", "Enseignant", "Professeur"],
    ["Affectation", "Classe", "Promotion"],
    ["Stage", "Eleve", "Stagiaire"],
    ["Stage", "Suivi_par", "Tuteur"],
    ["Stage", "Structure_de_stage", "Entreprise"],
  ];
  for (const [tableId, oldId, newId] of renamed) {
    const column = data.tables[tableId].columns.find(item => item.colId === oldId);
    column.colId = newId;
    column.label = newId;
  }

  const mappings = inferMappings(data);
  assert.equal(mappings.studentClass, "Groupe");
  assert.equal(mappings.quotaTeacher, "Professeur");
  assert.equal(mappings.quotaClass, "Promotion");
  assert.equal(mappings.stageStudent, "Stagiaire");
  assert.equal(mappings.stageSupervisor, "Tuteur");
  assert.equal(mappings.stageStructure, "Entreprise");
  assert.equal(mappings.studentLabel, "Identite");
  assert.equal(mappings.teacherLabel, "Identite");
});

test("stable column references preserve semantic mappings across arbitrary renames", () => {
  const data = metadata();
  const first = inferMappings(data);
  const bindings = serializeBindings(data, first);
  const target = data.tables.Affectation.columns.find(column => column.colId === "Nombre_de_stage_a_suivre");
  const originalRef = target.ref;
  target.colId = "Quota_total";
  target.label = "Quota total";

  const mappings = inferMappings(data, bindings);
  assert.equal(bindings.quotaTarget.columnRef, originalRef);
  assert.equal(mappings.quotaTarget, "Quota_total");
});

test("legacy saved string mappings are still accepted for semantic fields", () => {
  const data = metadata();
  const quota = data.tables.Affectation.columns.find(column => column.colId === "Nombre_de_stage_a_suivre");
  quota.colId = "Quota_total";
  quota.label = "Quota total";
  const mappings = inferMappings(data, { quotaTarget: "Quota_total" });
  assert.equal(mappings.quotaTarget, "Quota_total");
});

test("semantic fields are not guessed merely because a type happens to be unique", () => {
  const data = metadata();
  const period = data.tables.Stage.columns.find(column => column.colId === "Periode");
  period.colId = "Numero";
  period.label = "Numéro";
  const mappings = inferMappings(data);
  assert.equal(mappings.stagePeriod, "");
  assert.ok(validateMappings(data, mappings).some(row => row.key === "stagePeriod"));
});

test("validateMappings checks references, numeric fields and writable stage fields", () => {
  const data = metadata();
  const mappings = inferMappings(data);
  assert.deepEqual(validateMappings(data, mappings), []);

  data.tables.Stage.columns.find(column => column.colId === "Suivi_par").writable = false;
  let issues = validateMappings(data, inferMappings(data));
  assert.ok(issues.some(row => row.code === "MISSING_MAPPING" && row.key === "stageSupervisor"));

  data.tables.Enseignant.columns.find(column => column.colId === "Localisation_validee").type = "Text";
  issues = validateMappings(data, inferMappings(data));
  assert.ok(issues.some(row => row.key === "teacherLocationValidated"));
});

test("geographic mappings are optional only when geographic optimization is disabled", () => {
  const data = metadata();
  delete data.tables.Structures_de_stage;
  data.tables.Enseignant.columns = data.tables.Enseignant.columns.filter(column => !["Latitude", "Longitude", "Localisation_validee"].includes(column.colId));
  data.tables.Stage.columns = data.tables.Stage.columns.filter(column => column.type !== "Ref:Structures_de_stage");
  const mappings = inferMappings(data);
  assert.deepEqual(validateMappings(data, mappings, { geography: false }), []);
  assert.ok(validateMappings(data, mappings, { geography: true }).length > 0);
});

test("mappingSignature is stable regardless of object insertion order", () => {
  const a = inferMappings(metadata());
  const b = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(mappingSignature(a), mappingSignature(b));
});
