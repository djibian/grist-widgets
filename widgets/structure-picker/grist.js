import { candidateMatchesIdentifier, extractLocationFromAddress, identifierParts } from "./search.js";

export const COLUMN_DEFS = [
  { name: "NomCommercial", title: "Nom usuel", type: "Text", optional: false },
  { name: "Adresse", title: "Adresse", type: "Text", optional: false },
  { name: "SirenSiret", title: "SIREN / SIRET", type: "Text", optional: false },
  { name: "RaisonSociale", title: "Raison sociale", type: "Text", optional: true },
  { name: "Latitude", title: "Latitude", type: "Numeric", optional: true },
  { name: "Longitude", title: "Longitude", type: "Numeric", optional: true },
  { name: "Telephone", title: "Téléphone", type: "Text", optional: true },
  { name: "Courriel", title: "Courriel", type: "Text", optional: true },
  { name: "SiteWeb", title: "Site web", type: "Text", optional: true },
];

const REQUIRED_COLUMNS = ["NomCommercial", "Adresse", "SirenSiret"];
const WRITE_FIELDS = new Set(COLUMN_DEFS.map(definition => definition.name));
const LABELS = Object.fromEntries(COLUMN_DEFS.map(definition => [definition.name, definition.title]));
let addQueue = Promise.resolve();

export function initializeGrist() {
  grist.ready({ requiredAccess: "full", allowSelectBy: true, columns: COLUMN_DEFS });
}

export function watchTable(callback) {
  grist.onRecords((_records, mappings) => callback(mappings ?? {}));
}

export function watchSelection(callback) {
  grist.onRecord((record, mappings) => callback(record?.id ?? null, mappings ?? {}));
  grist.onNewRecord(mappings => callback("new", mappings ?? {}));
}

function resolveMappings(mappings, availableColumns) {
  const available = new Set(availableColumns);
  const resolved = {};
  for (const definition of COLUMN_DEFS) {
    const logicalName = definition.name;
    const mapped = mappings?.[logicalName];
    if (mapped && available.has(mapped)) resolved[logicalName] = mapped;
    else if (available.has(logicalName)) resolved[logicalName] = logicalName;
    else resolved[logicalName] = null;
  }
  return resolved;
}

function rowRecordsToObjects(rowRecords) {
  const ids = Array.isArray(rowRecords?.id) ? rowRecords.id : [];
  return ids.map((id, index) => {
    const row = { id };
    for (const [columnId, values] of Object.entries(rowRecords ?? {})) {
      if (columnId === "id") continue;
      row[columnId] = Array.isArray(values) ? values[index] : undefined;
    }
    return row;
  });
}

function rowRecordsToLogicalRows(rowRecords, resolvedMappings) {
  const ids = Array.isArray(rowRecords?.id) ? rowRecords.id : [];
  return ids.map((id, index) => {
    const row = { id };
    for (const definition of COLUMN_DEFS) {
      const logicalName = definition.name;
      const columnId = resolvedMappings[logicalName];
      const values = columnId ? rowRecords[columnId] : null;
      row[logicalName] = Array.isArray(values) ? values[index] : null;
    }
    const location = extractLocationFromAddress(row.Adresse);
    row.CodePostal = location.codePostal;
    row.Commune = location.commune;
    return row;
  });
}

export function isFormulaColumn(metadata) {
  return Boolean(metadata?.isFormula) && Boolean(String(metadata?.formula ?? "").trim());
}

async function fetchColumnMetadata(tableId) {
  const tables = await grist.docApi.fetchTable("_grist_Tables");
  const tableIds = Array.isArray(tables?.tableId) ? tables.tableId : [];
  const tableIndex = tableIds.findIndex(value => String(value) === String(tableId));
  if (tableIndex < 0) return new Map();
  const tableRef = Array.isArray(tables?.id) ? tables.id[tableIndex] : null;
  if (tableRef === null || tableRef === undefined) return new Map();

  const columns = rowRecordsToObjects(await grist.docApi.fetchTable("_grist_Tables_column"));
  const result = new Map();
  for (const column of columns) {
    if (column.parentId !== tableRef) continue;
    result.set(column.colId, {
      colId: column.colId,
      label: column.label || column.colId,
      type: column.type,
      isFormula: Boolean(column.isFormula),
      formula: String(column.formula ?? ""),
      writable: !isFormulaColumn(column),
    });
  }
  return result;
}

export async function fetchFullSnapshot(mappings = {}) {
  const tableId = await grist.selectedTable.getTableId();
  const rawTable = await grist.docApi.fetchTable(tableId);
  const resolvedMappings = resolveMappings(mappings, Object.keys(rawTable ?? {}));
  const metadata = await fetchColumnMetadata(tableId);
  const missing = REQUIRED_COLUMNS.filter(name => !resolvedMappings[name]);
  const nonWritableRequired = REQUIRED_COLUMNS.filter(name => {
    const columnId = resolvedMappings[name];
    return columnId && metadata.get(columnId)?.writable === false;
  });
  const ignoredFormulaMappings = COLUMN_DEFS.map(definition => definition.name).filter(name => {
    if (REQUIRED_COLUMNS.includes(name)) return false;
    const columnId = resolvedMappings[name];
    return columnId && metadata.get(columnId)?.writable === false;
  });

  const writableMappings = {};
  for (const [logicalName, columnId] of Object.entries(resolvedMappings)) {
    if (!columnId || !WRITE_FIELDS.has(logicalName)) continue;
    if (metadata.get(columnId)?.writable === false) continue;
    writableMappings[logicalName] = columnId;
  }

  return {
    tableId,
    rows: rowRecordsToLogicalRows(rawTable, resolvedMappings),
    resolvedMappings,
    writableMappings,
    missing,
    nonWritableRequired,
    ignoredFormulaMappings,
  };
}

function labelsFor(names) {
  return names.map(name => LABELS[name] || name).join(", ");
}

export function configurationMessage(snapshot) {
  const messages = [];
  if (snapshot?.missing?.length) messages.push(`Mappe les champs obligatoires : ${labelsFor(snapshot.missing)}.`);
  if (snapshot?.nonWritableRequired?.length) {
    messages.push(`Ces champs obligatoires pointent vers des colonnes calculées et ne peuvent pas être modifiés : ${labelsFor(snapshot.nonWritableRequired)}. Choisis des colonnes de données.`);
  }
  return messages.join(" ");
}

export function configurationWarning(snapshot) {
  const messages = [];
  if (snapshot?.ignoredFormulaMappings?.length) {
    messages.push(`Colonnes calculées ignorées lors des écritures : ${labelsFor(snapshot.ignoredFormulaMappings)}.`);
  }
  if (!snapshot?.resolvedMappings?.Latitude || !snapshot?.resolvedMappings?.Longitude) {
    messages.push("Mappe Latitude et Longitude pour alimenter automatiquement le widget carte.");
  }
  return messages.join(" ");
}

export function fieldsForCandidate(candidate, snapshot) {
  const fields = {};
  const writableMappings = snapshot?.writableMappings ?? {};
  const put = (logicalName, value) => {
    const columnId = writableMappings[logicalName];
    if (!columnId || value === undefined || value === null || value === "") return;
    fields[columnId] = value;
  };
  put("NomCommercial", candidate.nomCommercial);
  put("Adresse", candidate.adresse);
  put("SirenSiret", candidate.siret || candidate.siren);
  put("RaisonSociale", candidate.raisonSociale);
  put("Latitude", candidate.latitude);
  put("Longitude", candidate.longitude);
  put("Telephone", candidate.telephone);
  put("Courriel", candidate.courriel);
  put("SiteWeb", candidate.siteWeb);
  return fields;
}

export function findByCandidate(rows, candidate) {
  return rows.find(row => candidateMatchesIdentifier(candidate, row.SirenSiret)) ?? null;
}

export function findRowById(snapshot, rowId) {
  return snapshot?.rows?.find(row => String(row.id) === String(rowId)) ?? null;
}

export async function selectRow(rowId) {
  await grist.setCursorPos({ rowId });
}

export async function prepareManualRow() {
  await grist.setCursorPos({ rowId: "new" });
}

async function removeCreatedRecord(tableId, rowId) {
  await grist.docApi.applyUserActions([["RemoveRecord", tableId, rowId]]);
}

function validateCandidate(candidate) {
  const missing = [];
  if (!String(candidate?.nomCommercial ?? "").trim()) missing.push("nom usuel");
  if (!String(candidate?.adresse ?? "").trim()) missing.push("adresse");
  if (!String(candidate?.siret ?? "").trim()) missing.push("SIRET");
  if (missing.length) throw new Error(`Ce résultat externe est incomplet (${missing.join(", ")}) et ne peut pas être ajouté automatiquement.`);
}

async function addCandidateOnce(candidate, mappings) {
  validateCandidate(candidate);
  const before = await fetchFullSnapshot(mappings);
  if (before.missing.length || before.nonWritableRequired.length) throw new Error(configurationMessage(before));

  const preexisting = findByCandidate(before.rows, candidate);
  if (preexisting) {
    await selectRow(preexisting.id);
    return { status: "existing", row: preexisting, snapshot: before };
  }

  const created = await grist.selectedTable.create({ fields: fieldsForCandidate(candidate, before) });
  const createdId = created?.id ?? created;
  if (!createdId) throw new Error("Grist n'a pas retourné l'identifiant de la ligne créée.");

  const afterCreate = await fetchFullSnapshot(mappings);
  const sameIdentifier = afterCreate.rows.filter(row => candidateMatchesIdentifier(candidate, row.SirenSiret));
  const other = sameIdentifier.find(row => row.id !== createdId);
  if (other) {
    await removeCreatedRecord(afterCreate.tableId, createdId);
    const reconciled = await fetchFullSnapshot(mappings);
    await selectRow(other.id);
    return { status: "existing", row: other, snapshot: reconciled, reconciled: true };
  }

  await selectRow(createdId);
  return { status: "created", row: sameIdentifier.find(row => row.id === createdId) ?? { id: createdId }, snapshot: afterCreate };
}

export function addCandidateSafely(candidate, mappings) {
  const operation = addQueue.then(() => addCandidateOnce(candidate, mappings), () => addCandidateOnce(candidate, mappings));
  addQueue = operation.catch(() => undefined);
  return operation;
}

function identifierConflict(rows, rowId, value) {
  const proposed = identifierParts(value);
  if (!proposed.identifier) return null;
  return rows.find(row => {
    if (String(row.id) === String(rowId)) return false;
    const existing = identifierParts(row.SirenSiret);
    if (proposed.siret && existing.siret) return proposed.siret === existing.siret;
    return Boolean(proposed.siren && existing.siren && proposed.siren === existing.siren);
  }) ?? null;
}

export async function applyEnrichmentChanges(rowId, changes, mappings) {
  if (!rowId || rowId === "new") throw new Error("Sélectionne d'abord une structure existante.");
  const before = await fetchFullSnapshot(mappings);
  if (before.missing.length || before.nonWritableRequired.length) throw new Error(configurationMessage(before));
  if (!findRowById(before, rowId)) throw new Error("La structure sélectionnée n'existe plus.");

  if (Object.prototype.hasOwnProperty.call(changes ?? {}, "SirenSiret")) {
    const conflict = identifierConflict(before.rows, rowId, changes.SirenSiret);
    if (conflict) {
      await selectRow(conflict.id);
      throw new Error("Ce SIREN/SIRET existe déjà dans une autre structure. La ligne existante a été sélectionnée.");
    }
  }

  const fields = {};
  const skipped = [];
  for (const [logicalName, value] of Object.entries(changes ?? {})) {
    if (!WRITE_FIELDS.has(logicalName)) continue;
    const columnId = before.writableMappings[logicalName];
    if (!columnId) {
      skipped.push(LABELS[logicalName] || logicalName);
      continue;
    }
    fields[columnId] = value;
  }
  if (!Object.keys(fields).length) {
    throw new Error(skipped.length ? `Aucune modification applicable. Champs non modifiables ou non mappés : ${skipped.join(", ")}.` : "Aucune modification sélectionnée.");
  }

  await grist.docApi.applyUserActions([["UpdateRecord", before.tableId, rowId, fields]]);
  const after = await fetchFullSnapshot(mappings);
  await selectRow(rowId);
  return { snapshot: after, row: findRowById(after, rowId), skipped };
}
