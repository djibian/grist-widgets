export function isFormulaColumn(column) {
  return Boolean(column?.isFormula) && Boolean(String(column?.formula ?? "").trim());
}

export function isWritableColumn(column) {
  return !isFormulaColumn(column);
}
