export const CORE_TABLES = Object.freeze(["Classe", "Eleves", "Enseignant", "Affectation", "Stage"]);
export const GEOGRAPHY_TABLES = Object.freeze(["Structures_de_stage"]);
export const DOCUMENT_TABLES = Object.freeze([...CORE_TABLES, ...GEOGRAPHY_TABLES]);
export const SECONDARY_TABLES = Object.freeze(["Eleves", "Enseignant", "Affectation", "Stage", "Structures_de_stage"]);

export const MAPPING_DEFS = Object.freeze([
  {
    key: "studentClass",
    table: "Eleves",
    label: "Classe de l'élève",
    candidates: ["Classe"],
    refTarget: "Classe",
  },
  {
    key: "studentLabel",
    table: "Eleves",
    label: "Identité de l'élève",
    candidates: ["Identite", "Identité", "Nom_complet", "Nom complet", "Nom_Prenom", "Nom Prénom", "Prenom_Nom", "Prénom Nom", "Nom"],
  },
  {
    key: "teacherLabel",
    table: "Enseignant",
    label: "Identité de l'enseignant",
    candidates: ["Identite", "Identité", "Nom_complet", "Nom complet", "Nom_Prenom", "Nom Prénom", "Prenom_Nom", "Prénom Nom", "Nom"],
  },
  {
    key: "teacherLatitude",
    table: "Enseignant",
    label: "Latitude",
    candidates: ["Latitude"],
    allowedTypes: ["Numeric", "Int"],
    scope: "geography",
  },
  {
    key: "teacherLongitude",
    table: "Enseignant",
    label: "Longitude",
    candidates: ["Longitude"],
    allowedTypes: ["Numeric", "Int"],
    scope: "geography",
  },
  {
    key: "teacherLocationValidated",
    table: "Enseignant",
    label: "Localisation validée",
    candidates: ["Localisation_validee", "Localisation validée", "Localisation validee"],
    allowedTypes: ["Bool"],
    scope: "geography",
  },
  {
    key: "quotaTeacher",
    table: "Affectation",
    label: "Enseignant",
    candidates: ["Enseignant"],
    refTarget: "Enseignant",
  },
  {
    key: "quotaClass",
    table: "Affectation",
    label: "Classe",
    candidates: ["Classe"],
    refTarget: "Classe",
  },
  {
    key: "quotaPeriod",
    table: "Affectation",
    label: "Période",
    candidates: ["Periode", "Période", "Periode_de_stage", "Période de stage"],
    allowedTypes: ["Numeric", "Int"],
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
  },
  {
    key: "stageStudent",
    table: "Stage",
    label: "Élève",
    candidates: ["Eleve", "Élève"],
    refTarget: "Eleves",
    writable: true,
  },
  {
    key: "stagePeriod",
    table: "Stage",
    label: "Période",
    candidates: ["Periode", "Période", "Periode_de_stage", "Période de stage"],
    allowedTypes: ["Numeric", "Int"],
    writable: true,
  },
  {
    key: "stageSupervisor",
    table: "Stage",
    label: "Suivi par",
    candidates: ["Suivi_par", "Suivi par", "Enseignant", "Enseignant_de_suivi", "Enseignant de suivi"],
    refTarget: "Enseignant",
    writable: true,
  },
  {
    key: "stageStructure",
    table: "Stage",
    label: "Structure de stage",
    candidates: ["Structure_de_stage", "Structure de stage", "Structure"],
    refTarget: "Structures_de_stage",
    scope: "geography",
  },
  {
    key: "structureLatitude",
    table: "Structures_de_stage",
    label: "Latitude",
    candidates: ["Latitude"],
    allowedTypes: ["Numeric", "Int"],
    scope: "geography",
  },
  {
    key: "structureLongitude",
    table: "Structures_de_stage",
    label: "Longitude",
    candidates: ["Longitude"],
    allowedTypes: ["Numeric", "Int"],
    scope: "geography",
  },
]);

const normalize = value => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

function columnFor(metadata, tableId, columnId) {
  return metadata?.tables?.[tableId]?.columns?.find(column => String(column.colId) === String(columnId)) ?? null;
}

function definitionEnabled(definition, { geography = true } = {}) {
  return definition.scope !== "geography" || geography;
}

function columnMatchesShape(column, definition) {
  if (definition.refTarget && column.type !== `Ref:${definition.refTarget}`) return false;
  if (definition.allowedTypes && !definition.allowedTypes.includes(column.type)) return false;
  if (definition.writable && column.writable === false) return false;
  return true;
}

function candidateColumn(columns, definition) {
  const compatible = columns.filter(column => columnMatchesShape(column, definition));
  for (const candidate of definition.candidates) {
    const wanted = normalize(candidate);
    const found = compatible.find(column => normalize(column.colId) === wanted)
      ?? compatible.find(column => normalize(column.label) === wanted)
      ?? null;
    if (found) return found;
  }
  return null;
}

function uniqueStructuralColumn(columns, definition) {
  const compatible = columns.filter(column => columnMatchesShape(column, definition));
  return compatible.length === 1 ? compatible[0] : null;
}

export function inferMappings(metadata, saved = {}) {
  const result = {};
  for (const definition of MAPPING_DEFS) {
    const columns = metadata?.tables?.[definition.table]?.columns ?? [];
    const savedColumn = saved?.[definition.key];
    if (savedColumn && columns.some(column => column.colId === savedColumn)) {
      result[definition.key] = savedColumn;
      continue;
    }

    const found = candidateColumn(columns, definition)
      ?? uniqueStructuralColumn(columns, definition);
    result[definition.key] = found?.colId ?? "";
  }
  return result;
}

export function mappingDefinition(key) {
  return MAPPING_DEFS.find(definition => definition.key === key) ?? null;
}

export function mappingGroups() {
  return SECONDARY_TABLES.map(table => ({
    table,
    fields: MAPPING_DEFS.filter(definition => definition.table === table),
  })).filter(group => group.fields.length);
}

export function validateMappings(metadata, mappings, { geography = true } = {}) {
  const issues = [];
  const requiredTables = geography ? DOCUMENT_TABLES : CORE_TABLES;
  for (const tableId of requiredTables) {
    if (!metadata?.tables?.[tableId]) {
      issues.push({ code: "MISSING_TABLE", table: tableId, message: `Table Grist introuvable : ${tableId}.` });
    }
  }

  for (const definition of MAPPING_DEFS) {
    if (!definitionEnabled(definition, { geography })) continue;
    const columnId = mappings?.[definition.key];
    if (!columnId) {
      issues.push({
        code: "MISSING_MAPPING",
        key: definition.key,
        table: definition.table,
        message: `${definition.table} — ${definition.label} : colonne non paramétrée.`,
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
