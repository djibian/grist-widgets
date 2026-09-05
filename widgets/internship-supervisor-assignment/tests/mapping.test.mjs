import test from "node:test";
import assert from "node:assert/strict";
import { inferMappings, mappingSignature, validateMappings } from "../mapping.js";

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
        { colId: "Identite", label: "Identité", writable: false },
      ]),
      Enseignant: table([
        { colId: "Identite", label: "Identité", writable: false },
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
      ]),
    },
  };
}

test("inferMappings recognises the current singular quota column", () => {
  const mappings = inferMappings(metadata());
  assert.equal(mappings.quotaTarget, "Nombre_de_stage_a_suivre");
  assert.equal(mappings.stageSupervisor, "Suivi_par");
});

test("saved valid mappings take precedence over automatic detection", () => {
  const data = metadata();
  data.tables.Classe.columns.push({ colId: "Libelle", label: "Libellé", type: "Text", writable: true });
  const mappings = inferMappings(data, { classLabel: "Libelle" });
  assert.equal(mappings.classLabel, "Libelle");
});

test("validateMappings checks reference targets and writable stage fields", () => {
  const data = metadata();
  const mappings = inferMappings(data);
  assert.deepEqual(validateMappings(data, mappings), []);

  data.tables.Stage.columns.find(column => column.colId === "Suivi_par").writable = false;
  const issues = validateMappings(data, mappings);
  assert.ok(issues.some(row => row.code === "READ_ONLY_MAPPING" && row.key === "stageSupervisor"));
});

test("mappingSignature is stable regardless of object insertion order", () => {
  const a = inferMappings(metadata());
  const b = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(mappingSignature(a), mappingSignature(b));
});
