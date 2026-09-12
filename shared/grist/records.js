export function recordsFromTable(table, { numericIds = false } = {}) {
  const ids = Array.isArray(table?.id) ? table.id : [];
  return ids.map((rowId, index) => {
    const row = { id: numericIds ? Number(rowId) : rowId };
    for (const [columnId, values] of Object.entries(table ?? {})) {
      if (columnId === "id") continue;
      row[columnId] = Array.isArray(values) ? values[index] : null;
    }
    return row;
  });
}
