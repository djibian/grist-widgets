export const CORE_TABLES = Object.freeze(["Classe", "Eleves", "Enseignant", "Affectation", "Stage"]);
export const GEOGRAPHY_TABLES = Object.freeze(["Structures_de_stage"]);
export const DOCUMENT_TABLES = Object.freeze([...CORE_TABLES, ...GEOGRAPHY_TABLES]);

const STRUCTURAL_DEFS = Object.freeze([
  {
    key: "studentClass",
    table: "Eleves",
    label: "Classe de l'élève",
    refTarget: "Classe",
    mode: "structural",
  },
  {
    key: "quotaTeacher",
    table: "Affectation",
    label: "Enseignant",
    refTarget: "Enseignant",
    mode: "structural",
  },
  {
    key: "quotaClass",
    table: "Affectation",
    label: "Classe",
    refTarget: "Classe",
    mode: "structural",
  },
  {
    key: "stageStudent",
    table: "Stage",
    label: "Élève",
    refTarget: "Eleves",
    writable: true,
    mode: "structural",
  },
  {
    key: "stageSupervisor",
    table: "Stage",
    label: "Suivi par",
    refTarget: "Enseignant",
    writable: true,
    mode: "structural",
  },
  {
    key: "stageStructure",
    table: "Stage",
    label: "Structure de stage",
    refTarget: "Structures_de_stage",
    scope: "geography",
    mode: "structural",
  },
]);

const VISIBLE_LABEL_DEFS = Object.freeze([
  {
    key: "studentLabel",
    table: "Eleves",
    label: "Identité de l'élève",
    sourceKeys: ["stageStudent"],
    candidates: ["Identite", "Identité", "Nom_complet", "Nom complet", "Nom_Prenom", "Nom Prénom", "Prenom_Nom", "Prénom Nom", "Nom"],
    mode: "visibleCol",
  },
  {
    key: "teacherLabel",
    table: "Enseignant",
    label: "Identité de l'enseignant",
    sourceKeys: ["stageSupervisor", "quotaTeacher"],
    candidates: ["Identite", "Identité", "Nom_complet", "Nom complet", "Nom_Prenom", "Nom Prénom", "Prenom_Nom", "Prénom Nom", "Nom"],
    mode: "visibleCol",
  },
]);

export const CONFIGURABLE_MAPPING_DEFS = Object.freeze([
  {
    key: "teacherLatitude",
    table: "Enseignant",
    label: "Latitude",
    candidates: ["Latitude"],
    allowedTypes: ["Numeric", "Int"],
    scope: "geography",
    mode: "semantic",
  },
  {
    key: "teacherLongitude",
    table: "Enseignant",
    label: "Longitude",
    candidates: ["Longitude"],
    allowedTypes: ["Numeric", "Int"],
    scope: "geography",
    mode: "semantic",
  },
  {
    key: "teacherLocationValidated",
    table: "Enseignant",
    label: "Localisation validée",
    candidates: ["Localisation_validee", "Localisation validée", "Localisation validee"],
    allowedTypes: ["Bool"],
    scope: "geography",
    mode: "semantic",
  },
  {
    key: "quotaPeriod",
    table: "Affectation",
    label: "Période",
    candidates: ["Periode", "Période", "Periode_de_stage", "Période de stage"],
    allowedTypes: ["Numeric", "Int"],
    mode: "semantic",
  },
  {
    key: "quotaTarget",
    table: "Affectation",
    label: "Stages à suivre",
    candidates: [
      "Stage_a_suivre",
      "Stages_a_suivre",
      "Stage à suivre",
      "Stages à suivre",
      "Nombre_de_stage_a_suivre",
      "Nombre_de_stages_a_suivre",
      "Nombre de stage à suivre",
      "Nombre de stages à suivre",
    ],
    allowedTypes: ["Numeric", "Int"],
    mode: "semantic",
  },
  {
    key: "stagePeriod",
    table: "Stage",
    label: "Période",
    candidates: ["Periode", "Période", "Periode_de_stage", "Période de stage"],
    allowedTypes: ["Numeric", "Int"],
    writable: true,
    mode: "semantic",
  },
  {
    key: "structureLatitude",
    table: "Structures_de_stage",
    label: "Latitude",
    candidates: ["Latitude"],
    allowedTypes: ["Numeric", "Int"],
    scope: "geography",
    mode: "semantic",
  },
  {
    key: "structureLongitude",
    table: "Structures_de_stage",
    label: "Longitude",
    candidates: ["Longitude"],
    allowedTypes: ["Numeric", "Int"],
    scope: "geography",
    mode: "semantic",
  },
]);

export const MAPPING_DEFS = Object.freeze([
  ...STRUCTURAL_DEFS,
  ...VISIBLE_LABEL_DEFS,
  ...CONFIGURABLE_MAPPING_DEFS,
]);

const normalize = value => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

function tableFor(metadata, tableId) {
  return metadata?.tables?.[tableId] ?? null;
}

function columnFor(metadata, tableId, columnId) {
  return tableFor(metadata, tableId)?.columns?.find(column => String(column.colId) === String(columnId)) ?? null;
}

function columnForRef(metadata, tableId, columnRef) {
  const wanted = Number(columnRef);
  if (!Number.isInteger(wanted) || wanted <= 0) return null;
  return tableFor(metadata, tableId)?.columns?.find(column => Number(column.ref) === wanted) ?? null;
}

function definitionEnabled(definition, { geography = true } = {}) {
  return definition.scope !== "geography" || geography;
}

function columnMatchesShape(column, definition) {
  if (!column) return false;
  if (definition.refTarget && column.type !== `Ref:${definition.refTarget}`) return false;
  if (definition.allowedTypes && !definition.allowedTypes.includes(column.type)) return false;
  if (definition.writable && column.writable === false) return false;
  return true;
}

function candidateColumn(columns, definition) {
  const compatible = columns.filter(column => columnMatchesShape(column, definition));
  for (const candidate of definition.candidates ?? []) {
    const wanted = normalize(candidate);
    const found = compatible.find(column => normalize(column.colId) === wanted)
      ?? compatible.find(column => normalize(column.label) === wanted)
      ?? null;
    if (found) return found;
  }
  return null;
}

function uniqueStructuralColumn(metadata, definition) {
  const columns = tableFor(metadata, definition.table)?.columns ?? [];
  const compatible = columns.filter(column => columnMatchesShape(column, definition));
  return compatible.length === 1 ? compatible[0] : null;
}

function savedColumn(metadata, definition, savedValue) {
  if (!savedValue) return null;
  const table = tableFor(metadata, definition.table);
  if (!table) return null;

  let column = null;
  if (typeof savedValue === "string") {
    column = columnFor(metadata, definition.table, savedValue);
  } else if (typeof savedValue === "object") {
    const tableRef = Number(savedValue.tableRef);
    if (Number.isInteger(tableRef) && tableRef > 0 && Number(table.id) !== tableRef) return null;
    column = columnForRef(metadata, definition.table, savedValue.columnRef);
    if (!column && typeof savedValue.colId === "string") {
      column = columnFor(metadata, definition.table, savedValue.colId);
    }
  }
  return columnMatchesShape(column, definition) ? column : null;
}

function visibleColumn(metadata, definition, mappings) {
  for (const sourceKey of definition.sourceKeys ?? []) {
    const sourceDefinition = MAPPING_DEFS.find(item => item.key === sourceKey);
    const sourceColumnId = mappings?.[sourceKey];
    if (!sourceDefinition || !sourceColumnId) continue;
    const sourceColumn = columnFor(metadata, sourceDefinition.table, sourceColumnId);
    const visible = columnForRef(metadata, definition.table, sourceColumn?.visibleColRef);
    if (visible) return visible;
  }
  return null;
}

export function inferMappings(metadata, saved = {}) {
  const result = {};

  for (const definition of STRUCTURAL_DEFS) {
    const found = uniqueStructuralColumn(metadata, definition)
      ?? savedColumn(metadata, definition, saved?.[definition.key]);
    result[definition.key] = found?.colId ?? "";
  }

  for (const definition of VISIBLE_LABEL_DEFS) {
    const columns = tableFor(metadata, definition.table)?.columns ?? [];
    const found = visibleColumn(metadata, definition, result)
      ?? savedColumn(metadata, definition, saved?.[definition.key])
      ?? candidateColumn(columns, definition);
    result[definition.key] = found?.colId ?? "";
  }

  for (const definition of CONFIGURABLE_MAPPING_DEFS) {
    const columns = tableFor(metadata, definition.table)?.columns ?? [];
    const found = savedColumn(metadata, definition, saved?.[definition.key])
      ?? candidateColumn(columns, definition);
    result[definition.key] = found?.colId ?? "";
  }

  return result;
}

export function serializeBindings(metadata, mappings) {
  const bindings = {};
  for (const definition of CONFIGURABLE_MAPPING_DEFS) {
    const table = tableFor(metadata, definition.table);
    const column = columnFor(metadata, definition.table, mappings?.[definition.key]);
    if (!table || !column || !columnMatchesShape(column, definition)) continue;
    const tableRef = Number(table.id);
    const columnRef = Number(column.ref);
    if (Number.isInteger(tableRef) && tableRef > 0 && Number.isInteger(columnRef) && columnRef > 0) {
      bindings[definition.key] = { tableRef, columnRef };
    } else {
      bindings[definition.key] = column.colId;
    }
  }
  return bindings;
}

export function mappingDefinition(key) {
  return MAPPING_DEFS.find(definition => definition.key === key) ?? null;
}

export function mappingGroups() {
  const tables = ["Enseignant", "Affectation", "Stage", "Structures_de_stage"];
  return tables.map(table => ({
    table,
    fields: CONFIGURABLE_MAPPING_DEFS.filter(definition => definition.table === table),
  })).filter(group => group.fields.length);
}

export function validateMappings(metadata, mappings, { geography = true } = {}) {
  const issues = [];
  const effectiveMappings = inferMappings(metadata, mappings ?? {});
  const requiredTables = geography ? DOCUMENT_TABLES : CORE_TABLES;
  for (const tableId of requiredTables) {
    if (!tableFor(metadata, tableId)) {
      issues.push({ code: "MISSING_TABLE", table: tableId, message: `Table Grist introuvable : ${tableId}.` });
    }
  }

  for (const definition of MAPPING_DEFS) {
    if (!definitionEnabled(definition, { geography })) continue;
    const columnId = effectiveMappings?.[definition.key];
    if (!columnId) {
      const origin = definition.mode === "structural"
        ? "relation Grist non déductible de manière unique"
        : definition.mode === "visibleCol"
          ? "colonne d'affichage Grist introuvable"
          : "colonne métier non paramétrée";
      issues.push({
        code: "MISSING_MAPPING",
        key: definition.key,
        table: definition.table,
        message: `${definition.table} — ${definition.label} : ${origin}.`,
      });
      continue;
    }
    const column = columnFor(metadata, definition.table, columnId);
    if (!column) {
      issues.push({
        code: "INVALID_MAPPING",
        key: definition.key,
        table: definition.table,
        message: `${definition.table} — ${definition.label} : la colonne ${columnId} n'existe plus.`,
      });
      continue;
    }
    if (definition.refTarget && column.type !== `Ref:${definition.refTarget}`) {
      issues.push({
        code: "INVALID_REFERENCE_MAPPING",
        key: definition.key,
        table: definition.table,
        message: `${definition.table} — ${definition.label} doit être une référence vers ${definition.refTarget}.`,
      });
    }
    if (definition.allowedTypes && !definition.allowedTypes.includes(column.type)) {
      issues.push({
        code: "INVALID_COLUMN_TYPE",
        key: definition.key,
        table: definition.table,
        message: `${definition.table} — ${definition.label} doit être de type ${definition.allowedTypes.join(" ou ")}.`,
      });
    }
    if (definition.writable && column.writable === false) {
      issues.push({
        code: "READ_ONLY_MAPPING",
        key: definition.key,
        table: definition.table,
        message: `${definition.table} — ${definition.label} doit être une colonne modifiable.`,
      });
    }
  }
  return issues;
}

export function mappingSignature(mappings) {
  const ordered = {};
  for (const definition of MAPPING_DEFS) ordered[definition.key] = mappings?.[definition.key] ?? "";
  return JSON.stringify(ordered);
}
