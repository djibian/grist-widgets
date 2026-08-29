import { normalizeSiret } from "./search.js";

export const COLUMN_DEFS = [
  { name: "Nom", title: "Nom affiché", type: "Text", optional: true },
  { name: "NomCommercial", title: "Nom commercial / enseigne", type: "Text", optional: true },
  { name: "RaisonSociale", title: "Raison sociale", type: "Text", optional: true },
  { name: "Adresse", title: "Adresse", type: "Text", optional: true },
  { name: "SIRET", title: "SIRET", type: "Text", optional: true },
  { name: "SIREN", title: "SIREN", type: "Text", optional: true },
  { name: "CodePostal", title: "Code postal", type: "Text", optional: true },
  { name: "Commune", title: "Commune", type: "Text", optional: true },
  { name: "APE", title: "Code APE / NAF", type: "Text", optional: true },
  { name: "Latitude", title: "Latitude", type: "Numeric", optional: true },
  { name: "Longitude", title: "Longitude", type: "Numeric", optional: true },
  { name: "AdresseNormalisee", title: "Adresse normalisée", type: "Text", optional: true },
];

const REQUIRED_COLUMNS = ["Nom", "Adresse", "SIRET"];
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
    return row;
  });
}

export async function fetchFullSnapshot(mappings = {}) {
  const tableId = await grist.selectedTable.getTableId();
  const rawTable = await grist.docApi.fetchTable(tableId);
  const resolvedMappings = resolveMappings(mappings, Object.keys(rawTable ?? {}));
  const missing = REQUIRED_COLUMNS.filter(name => !resolvedMappings[name]);
  const rows = rowRecordsToLogicalRows(rawTable, resolvedMappings);
  return { tableId, rows, resolvedMappings, missing };
}

export function configurationMessage(snapshot) {
  if (!snapshot?.missing?.length) return "";
  return `Configuration incomplète : mappe les champs ${snapshot.missing.join(", ")} dans le panneau du widget.`;
}

export function fieldsForCandidate(candidate, resolvedMappings) {
  const fields = {};
  const put = (logicalName, value) => {
    const columnId = resolvedMappings?.[logicalName];
    if (!columnId || value === undefined || value === null || value === "") return;
    fields[columnId] = value;
  };

  put("Nom", candidate.nom);
  put("NomCommercial", candidate.nomCommercial);
  put("RaisonSociale", candidate.raisonSociale);
  put("Adresse", candidate.adresse);
  put("AdresseNormalisee", candidate.adresse);
  put("SIRET", candidate.siret);
  put("SIREN", candidate.siren);
  put("CodePostal", candidate.codePostal);
  put("Commune", candidate.commune);
  put("APE", candidate.ape);
  put("Latitude", candidate.latitude);
  put("Longitude", candidate.longitude);
  return fields;
}

export function findBySiret(rows, siret) {
  const normalized = normalizeSiret(siret);
  if (!normalized) return null;
  return rows.find(row => normalizeSiret(row.SIRET) === normalized) ?? null;
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

async function addCandidateOnce(candidate, mappings) {
  const before = await fetchFullSnapshot(mappings);
  if (before.missing.length) {
    throw new Error(configurationMessage(before));
  }

  const preexisting = findBySiret(before.rows, candidate.siret);
  if (preexisting) {
    await selectRow(preexisting.id);
    return { status: "existing", row: preexisting, snapshot: before };
  }

  const fields = fieldsForCandidate(candidate, before.resolvedMappings);
  const created = await grist.selectedTable.create({ fields });
  const createdId = created?.id ?? created;
  if (!createdId) throw new Error("Grist n'a pas retourné l'identifiant de la ligne créée.");

  const afterCreate = await fetchFullSnapshot(mappings);
  const sameSiret = afterCreate.rows.filter(
    row => normalizeSiret(row.SIRET) === normalizeSiret(candidate.siret),
  );
  const other = sameSiret.find(row => row.id !== createdId);

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
    row: sameSiret.find(row => row.id === createdId) ?? { id: createdId },
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
