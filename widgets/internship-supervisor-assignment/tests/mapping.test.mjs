import test from "node:test";
import assert from "node:assert/strict";
import { inferMappings, mappingGroups, mappingSignature, validateMappings } from "../mapping.js";

function metadata() {
  const table = (columns) => ({ columns: columns.map(column => ({ writable: true, type: "Text", ...column })) });
  return {
    tables: {
      Classe: table([
        { colId: "Classe", label: "Classe" },
        { colId: "Nombre_de_periodes_de_stage", label: "Nombre de périodes de stage", type: "Numeric" },
      ]),
      Eleves: table([
        { colId: "Classe", label: "Classe", type: "Ref:Classe" },
        { colId: "Nom", label: "Nom", writable: true },
        { colId: "Identite", label: "Identité", writable: false },
      ]),
      Enseignant: table([
        { colId: "Nom", label: "Nom", writable: true },
        { colId: "Identite", label: "Identité", writable: false },
        { colId: "Latitude", label: "Latitude", type: "Numeric" },
        { colId: "Longitude", label: "Longitude", type: "Numeric" },
        { colId: "Localisation_validee", label: "Localisation validée", type: "Bool" },
      ]),
      Affectation: table([
        { colId: "Enseignant", label: "Enseignant", type: "Ref:Enseignant" },
        { colId: "Classe", label: "Classe", type: "Ref:Classe" },
        { colId: "Periode", label: "Période", type: "Numeric" },
        { colId: "Nombre_de_stage_a_suivre", label: "Nombre de stage à suivre", type: "Numeric" },
      ]),
      Stage: table([
        { colId: "Eleve", label: "Élève", type: "Ref:Eleves" },
        { colId: "Periode", label: "Période", type: "Numeric" },
        { colId: "Suivi_par", label: "Suivi par", type: "Ref:Enseignant" },
        { colId: "Structure_de_stage", label: "Structure de stage", type: "Ref:Structures_de_stage" },
      ]),
      Structures_de_stage: table([
        { colId: "Latitude", label: "Latitude", type: "Numeric" },
        { colId: "Longitude", label: "Longitude", type: "Numeric" },
      ]),
    },
  };
}

test("inferMappings recognises business and geographic columns", () => {
  const mappings = inferMappings(metadata());
  assert.equal(mappings.quotaTarget, "Nombre_de_stage_a_suivre");
  assert.equal(mappings.stageSupervisor, "Suivi_par");
  assert.equal(mappings.studentLabel, "Identite");
  assert.equal(mappings.teacherLabel, "Identite");
  assert.equal(mappings.teacherLatitude, "Latitude");
  assert.equal(mappings.teacherLongitude, "Longitude");
  assert.equal(mappings.teacherLocationValidated, "Localisation_validee");
  assert.equal(mappings.stageStructure, "Structure_de_stage");
  assert.equal(mappings.structureLatitude, "Latitude");
  assert.equal(mappings.structureLongitude, "Longitude");
  assert.equal(Object.hasOwn(mappings, "classLabel"), false);
  assert.equal(Object.hasOwn(mappings, "classPeriodCount"), false);
});

test("inferMappings recognises the simplified Stage à suivre name", () => {
  const data = metadata();
  const quota = data.tables.Affectation.columns.find(column => column.colId === "Nombre_de_stage_a_suivre");
  quota.colId = "Stage_a_suivre";
  quota.label = "Stage à suivre";

  const mappings = inferMappings(data, { quotaTarget: "Nombre_de_stage_a_suivre" });
  assert.equal(mappings.quotaTarget, "Stage_a_suivre");
});

test("inferMappings recovers uniquely typed reference columns after arbitrary renames", () => {
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

  const mappings = inferMappings(data, {
    studentClass: "Classe",
    quotaTeacher: "Enseignant",
    quotaClass: "Classe",
    stageStudent: "Eleve",
    stageSupervisor: "Suivi_par",
    stageStructure: "Structure_de_stage",
  });

  assert.equal(mappings.studentClass, "Groupe");
  assert.equal(mappings.quotaTeacher, "Professeur");
  assert.equal(mappings.quotaClass, "Promotion");
  assert.equal(mappings.stageStudent, "Stagiaire");
  assert.equal(mappings.stageSupervisor, "Tuteur");
  assert.equal(mappings.stageStructure, "Entreprise");
});

test("saved valid secondary mappings take precedence over automatic detection", () => {
  const data = metadata();
  data.tables.Eleves.columns.push({ colId: "NomComplet", label: "Nom complet", type: "Text", writable: false });
  const mappings = inferMappings(data, { studentLabel: "NomComplet" });
  assert.equal(mappings.studentLabel, "NomComplet");
});

test("mapping groups never expose the primary Classe source", () => {
  assert.deepEqual(mappingGroups().map(group => group.table), ["Eleves", "Enseignant", "Affectation", "Stage", "Structures_de_stage"]);
});

test("validateMappings checks references, numeric fields and writable stage fields", () => {
  const data = metadata();
  const mappings = inferMappings(data);
  assert.deepEqual(validateMappings(data, mappings), []);

  data.tables.Stage.columns.find(column => column.colId === "Suivi_par").writable = false;
  let issues = validateMappings(data, mappings);
  assert.ok(issues.some(row => row.code === "READ_ONLY_MAPPING" && row.key === "stageSupervisor"));

  data.tables.Enseignant.columns.find(column => column.colId === "Localisation_validee").type = "Text";
  issues = validateMappings(data, mappings);
  assert.ok(issues.some(row => row.code === "INVALID_COLUMN_TYPE" && row.key === "teacherLocationValidated"));

  data.tables.Affectation.columns.find(column => column.colId === "Nombre_de_stage_a_suivre").type = "Text";
  issues = validateMappings(data, mappings);
  assert.ok(issues.some(row => row.code === "INVALID_COLUMN_TYPE" && row.key === "quotaTarget"));
});

test("geographic mappings are optional only when geographic optimization is disabled", () => {
  const data = metadata();
  delete data.tables.Structures_de_stage;
  data.tables.Enseignant.columns = data.tables.Enseignant.columns.filter(column => !["Latitude", "Longitude", "Localisation_validee"].includes(column.colId));
  data.tables.Stage.columns = data.tables.Stage.columns.filter(column => column.colId !== "Structure_de_stage");
  const mappings = inferMappings(data);
  assert.deepEqual(validateMappings(data, mappings, { geography: false }), []);
  assert.ok(validateMappings(data, mappings, { geography: true }).length > 0);
});

test("mappingSignature is stable regardless of object insertion order", () => {
  const a = inferMappings(metadata());
  const b = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(mappingSignature(a), mappingSignature(b));
});

test("automatic detection respects candidate priority over physical column order", () => {
  const data = metadata();
  const mappings = inferMappings(data);
  assert.equal(mappings.studentLabel, "Identite");
  assert.equal(mappings.teacherLabel, "Identite");
});
