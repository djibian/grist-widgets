import {
  candidateMatchesIdentifier,
  extractLocationFromNormalizedAddress,
} from "./search.js";

export const COLUMN_DEFS = [
  {
    name: "NomCommercial",
    title: "Nom commercial — recherche + écriture",
    type: "Text",
    optional: false,
  },
  {
    name: "Adresse",
    title: "Adresse — recherche + écriture",
    type: "Text",
    optional: false,
  },
  {
    name: "SirenSiret",
    title: "SIREN / SIRET — recherche + écriture",
    type: "Text",
    optional: false,
  },
  {
    name: "AdresseNormalisee",
    title: "Adresse normalisée — recherche uniquement",
    type: "Text",
    optional: true,
  },
  {
    name: "RaisonSociale",
    title: "Raison sociale — recherche + écriture",
    type: "Text",
    optional: true,
  },
  {
    name: "APE",
    title: "Code APE / NAF — écriture uniquement",
    type: "Text",
    optional: true,
  },
  {
    name: "Latitude",
    title: "Latitude — écriture uniquement",
    type: "Numeric",
    optional: true,
  },
  {
    name: "Longitude",
    title: "Longitude — écriture uniquement",
    type: "Numeric",
    optional: true,
  },
];

const REQUIRED_COLUMNS = ["NomCommercial", "Adresse", "SirenSiret"];
const WRITE_FIELDS = new Set([
  "NomCommercial",
  "Adresse",
  "SirenSiret",
  "RaisonSociale",
  "APE",
  "Latitude",
  "Longitude",
]);
const LABELS = Object.fromEntries(COLUMN_DEFS.map(definition => [definition.name, definition.title.split(" — ")[0]]));
let addQueue = Promise.resolve();

export function initializeGrist() {
  grist.ready({
    requiredAccess: "full",
    allowSelectBy: true,
    columns: COLUMN_DEFS,
  });
}

export function watchTable(callback) {
  grist.onRecords((_records, mappings) => callback(mappings ?? {}));
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

    const location = extractLocationFromNormalizedAddress(row.AdresseNormalisee || row.Adresse);
    row.CodePostal = location.codePostal;
    row.Commune = location.commune;
    return row;
  });
}

// Grist distingue les colonnes formule des colonnes de données. Une formule de déclenchement
// reste modifiable (isFormula=false). On exige donc à la fois isFormula=true et une vraie formule.
// Cela évite aussi le cas connu où une colonne de données vide peut être signalée isFormula=true.
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
  const ignoredFormulaMappings = COLUMN_DEFS
    .map(definition => definition.name)
    .filter(name => {
      if (!WRITE_FIELDS.has(name) || REQUIRED_COLUMNS.includes(name)) return false;
      const columnId = resolvedMappings[name];
      return columnId && metadata.get(columnId)?.writable === false;
    });

  const writableMappings = {};
  for (const [logicalName, columnId] of Object.entries(resolvedMappings)) {
    if (!columnId || !WRITE_FIELDS.has(logicalName)) continue;
    if (metadata.get(columnId)?.writable === false) continue;
    writableMappings[logicalName] = columnId;
  }

  const rows = rowRecordsToLogicalRows(rawTable, resolvedMappings);
  return {
    tableId,
    rows,
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
  if (snapshot?.missing?.length) {
    messages.push(`Mappe les champs obligatoires : ${labelsFor(snapshot.missing)}.`);
  }
  if (snapshot?.nonWritableRequired?.length) {
    messages.push(
      `Ces champs obligatoires pointent vers des colonnes calculées et ne peuvent pas recevoir un ajout : ${labelsFor(snapshot.nonWritableRequired)}. Choisis des colonnes de données.`,
    );
  }
  return messages.join(" ");
}

export function configurationWarning(snapshot) {
  if (!snapshot?.ignoredFormulaMappings?.length) return "";
  return `Colonnes calculées ignorées lors de l'écriture : ${labelsFor(snapshot.ignoredFormulaMappings)}.`;
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
  put("APE", candidate.ape);
  put("Latitude", candidate.latitude);
  put("Longitude", candidate.longitude);
  return fields;
}

export function findByCandidate(rows, candidate) {
  return rows.find(row => candidateMatchesIdentifier(candidate, row.SirenSiret)) ?? null;
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
  if (!String(candidate?.nomCommercial ?? "").trim()) missing.push("nom commercial");
  if (!String(candidate?.adresse ?? "").trim()) missing.push("adresse");
  if (!String(candidate?.siret ?? "").trim()) missing.push("SIRET");
  if (missing.length) {
    throw new Error(`Ce résultat externe est incomplet (${missing.join(", ")}) et ne peut pas être ajouté automatiquement.`);
  }
}

async function addCandidateOnce(candidate, mappings) {
  validateCandidate(candidate);
  const before = await fetchFullSnapshot(mappings);
  if (before.missing.length || before.nonWritableRequired.length) {
    throw new Error(configurationMessage(before));
  }

  const preexisting = findByCandidate(before.rows, candidate);
  if (preexisting) {
    await selectRow(preexisting.id);
    return { status: "existing", row: preexisting, snapshot: before };
  }

  const fields = fieldsForCandidate(candidate, before);
  const created = await grist.selectedTable.create({ fields });
  const createdId = created?.id ?? created;
  if (!createdId) throw new Error("Grist n'a pas retourné l'identifiant de la ligne créée.");

  const afterCreate = await fetchFullSnapshot(mappings);
  const sameIdentifier = afterCreate.rows.filter(row => candidateMatchesIdentifier(candidate, row.SirenSiret));
  const other = sameIdentifier.find(row => row.id !== createdId);

  if (other) {
    // Une autre session a gagné la course. On retire uniquement notre propre ligne.
    await removeCreatedRecord(afterCreate.tableId, createdId);
    const reconciled = await fetchFullSnapshot(mappings);
    await selectRow(other.id);
    return { status: "existing", row: other, snapshot: reconciled, reconciled: true };
  }

  await selectRow(createdId);
  return {
    status: "created",
    row: sameIdentifier.find(row => row.id === createdId) ?? { id: createdId },
    snapshot: afterCreate,
  };
}

export function addCandidateSafely(candidate, mappings) {
  const operation = addQueue.then(
    () => addCandidateOnce(candidate, mappings),
    () => addCandidateOnce(candidate, mappings),
  );
  addQueue = operation.catch(() => undefined);
  return operation;
}
