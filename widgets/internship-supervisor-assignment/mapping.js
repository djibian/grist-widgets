export const FIXED_TABLES = Object.freeze(["Classe", "Eleves", "Enseignant", "Affectation", "Stage"]);

export const MAPPING_DEFS = Object.freeze([
  {
    key: "classLabel",
    table: "Classe",
    label: "Libellé de la classe",
    candidates: ["Classe", "Nom", "Libelle", "Libellé"],
  },
  {
    key: "classPeriodCount",
    table: "Classe",
    label: "Nombre de périodes de stage",
    candidates: ["Nombre_de_periodes_de_stage", "Nombre de périodes de stage", "Nb_periodes", "Nb périodes"],
  },
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
    candidates: ["Identite", "Identité", "Nom_complet", "Nom complet", "Nom"],
  },
  {
    key: "teacherLabel",
    table: "Enseignant",
    label: "Identité de l'enseignant",
    candidates: ["Identite", "Identité", "Nom_complet", "Nom complet", "Nom"],
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
    candidates: ["Periode", "Période"],
  },
  {
    key: "quotaTarget",
    table: "Affectation",
    label: "Nombre de stages à suivre",
    candidates: [
      "Nombre_de_stage_a_suivre",
      "Nombre_de_stages_a_suivre",
      "Nombre de stage à suivre",
      "Nombre de stages à suivre",
    ],
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
    candidates: ["Periode", "Période"],
    writable: true,
  },
  {
    key: "stageSupervisor",
    table: "Stage",
    label: "Suivi par",
    candidates: ["Suivi_par", "Suivi par"],
    refTarget: "Enseignant",
    writable: true,
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

export function inferMappings(metadata, saved = {}) {
  const result = {};
  for (const definition of MAPPING_DEFS) {
    const columns = metadata?.tables?.[definition.table]?.columns ?? [];
    const savedColumn = saved?.[definition.key];
    if (savedColumn && columns.some(column => column.colId === savedColumn)) {
      result[definition.key] = savedColumn;
      continue;
    }

    const candidateNames = new Set(definition.candidates.map(normalize));
    const found = columns.find(column => candidateNames.has(normalize(column.colId)))
      ?? columns.find(column => candidateNames.has(normalize(column.label)));
    result[definition.key] = found?.colId ?? "";
  }
  return result;
}

export function mappingDefinition(key) {
  return MAPPING_DEFS.find(definition => definition.key === key) ?? null;
}

export function mappingGroups() {
  return FIXED_TABLES.map(table => ({
    table,
    fields: MAPPING_DEFS.filter(definition => definition.table === table),
  }));
}

export function validateMappings(metadata, mappings) {
  const issues = [];
  for (const tableId of FIXED_TABLES) {
    if (!metadata?.tables?.[tableId]) {
      issues.push({ code: "MISSING_TABLE", table: tableId, message: `Table Grist introuvable : ${tableId}.` });
    }
  }

  for (const definition of MAPPING_DEFS) {
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
