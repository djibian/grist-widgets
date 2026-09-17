import test from "node:test";
import assert from "node:assert/strict";
import { fetchMetadata, normalizeReferenceType, sourceTableId } from "../grist.js";
import { inferMappings } from "../mapping.js";

function columnar(rows) {
  const keys = new Set(rows.flatMap(row => Object.keys(row)));
  const result = {};
  for (const key of keys) result[key] = rows.map(row => row[key] ?? null);
  return result;
}

test("the class source table role follows a Grist table rename", async () => {
  const previousGrist = globalThis.grist;
  const tables = columnar([
    { id: 4, tableId: "Classes" },
    { id: 2, tableId: "Eleves" },
    { id: 6, tableId: "Affectation" },
  ]);
  const columns = columnar([
    { id: 43, parentId: 4, colId: "Classe", label: "Classe", type: "Text", visibleCol: 0, isFormula: false, formula: "", parentPos: 1 },
    { id: 88, parentId: 4, colId: "Nombre_de_periodes_de_stage", label: "Nombre de périodes de stage", type: "Numeric", visibleCol: 0, isFormula: false, formula: "", parentPos: 2 },
    { id: 34, parentId: 2, colId: "Classe", label: "Classe", type: "Ref:Classes", visibleCol: 43, isFormula: false, formula: "", parentPos: 1 },
    { id: 78, parentId: 6, colId: "Classe", label: "Classe", type: "Ref:Classes", visibleCol: 43, isFormula: false, formula: "", parentPos: 1 },
  ]);

  globalThis.grist = {
    docApi: {
      async fetchTable(tableId) {
        if (tableId === "_grist_Tables") return tables;
        if (tableId === "_grist_Tables_column") return columns;
        throw new Error(`unexpected table ${tableId}`);
      },
    },
  };

  try {
    assert.equal(sourceTableId("Classes"), "Classes");
    assert.equal(sourceTableId(null), "Classe");
    assert.equal(normalizeReferenceType("Ref:Classes", "Classes"), "Ref:Classe");

    const metadata = await fetchMetadata("Classes");
    assert.equal(metadata.tables.Classe.tableId, "Classes");
    assert.equal(metadata.tables.Eleves.columns[0].type, "Ref:Classe");
    assert.equal(metadata.tables.Affectation.columns[0].type, "Ref:Classe");

    const mappings = inferMappings(metadata);
    assert.equal(mappings.studentClass, "Classe");
    assert.equal(mappings.quotaClass, "Classe");
  } finally {
    if (previousGrist === undefined) delete globalThis.grist;
    else globalThis.grist = previousGrist;
  }
});
