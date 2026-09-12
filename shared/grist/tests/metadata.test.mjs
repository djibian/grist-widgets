import assert from "node:assert/strict";
import test from "node:test";

import { isFormulaColumn, isWritableColumn } from "../metadata.js";

test("une colonne n'est calculée que si isFormula et une formule non vide sont présents", () => {
  assert.equal(isFormulaColumn({ isFormula: true, formula: "$A" }), true);
  assert.equal(isFormulaColumn({ isFormula: true, formula: "  " }), false);
  assert.equal(isFormulaColumn({ isFormula: false, formula: "$A" }), false);
  assert.equal(isFormulaColumn(null), false);
});

test("une colonne calculée n'est pas considérée comme modifiable", () => {
  assert.equal(isWritableColumn({ isFormula: true, formula: "$A" }), false);
  assert.equal(isWritableColumn({ isFormula: true, formula: "" }), true);
  assert.equal(isWritableColumn({ isFormula: false, formula: "$A" }), true);
});
