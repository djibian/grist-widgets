import { configurationFingerprint, stageCoverage } from "./assignment.js";
import { DOCUMENT_TABLES, inferMappings, mappingSignature, validateMappings } from "./mapping.js";

const OPTION_KEY = "internshipSupervisorAssignmentV11";
const DEFAULT_OPTIMIZATION = Object.freeze({
  diversity: { enabled: true, priority: "moyenne" },
});

export const SOURCE_COLUMNS = Object.freeze([
  { name: "ClassLabel", title: "Classe", type: "Text", optional: false },
  { name: "PeriodCount", title: "Nombre de périodes de stage", type: "Numeric", optional: false },
]);

function rowsFromTable(table) {
  const ids = Array.isArray(table?.id) ? table.id : [];
  return ids.map((rowId, index) => {
    const row = { id: Number(rowId) };
    for (const [columnId, values] of Object.entries(table ?? {})) {
      if (columnId === "id") continue;
      row[columnId] = Array.isArray(values) ? values[index] : null;
    }
    return row;
  });
}

function ref(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function integer(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function display(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isWritableColumn(column) {
  return !(Boolean(column?.isFormula) && String(column?.formula ?? "").trim());
}

async function fetchRawTable(tableId) {
  try {
    return await grist.docApi.fetchTable(tableId);
  } catch {
    throw new Error(`Table Grist introuvable : ${tableId}.`);
  }
}

export async function fetchMetadata() {
  const [tablesRaw, columnsRaw] = await Promise.all([
    grist.docApi.fetchTable("_grist_Tables"),
    grist.docApi.fetchTable("_grist_Tables_column"),
  ]);
  const tableRows = rowsFromTable(tablesRaw);
  const columnRows = rowsFromTable(columnsRaw);
  const result = { tables: {} };

  for (const tableId of DOCUMENT_TABLES) {
    const table = tableRows.find(row => String(row.tableId) === tableId);
    if (!table) continue;
    const columns = columnRows
      .filter(column => column.parentId === table.id)
      .map(column => ({
        colId: String(column.colId),
        label: display(column.label, column.colId),
        type: String(column.type ?? "Any"),
        isFormula: Boolean(column.isFormula),
        formula: String(column.formula ?? ""),
        writable: isWritableColumn(column),
        position: Number(column.parentPos ?? 0),
      }))
      .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, "fr"));
    result.tables[tableId] = {
      id: table.id,
      tableId,
      label: display(table.tableId, tableId),
      columns,
    };
  }
  return result;
}

async function getSelectedTableId() {
  try {
    return await grist.selectedTable.getTableId();
  } catch {
    return null;
  }
}

function scalarMapping(value) {
  return typeof value === "string" && value ? value : null;
}

export function normalizeSourceMappings(mappings) {
  return {
    classLabel: scalarMapping(mappings?.ClassLabel),
    classPeriodCount: scalarMapping(mappings?.PeriodCount),
  };
}

export function sourceMappingSignature(mappings) {
  const normalized = normalizeSourceMappings({
    ClassLabel: mappings?.ClassLabel ?? mappings?.classLabel,
    PeriodCount: mappings?.PeriodCount ?? mappings?.classPeriodCount,
  });
  return JSON.stringify(normalized);
}

async function getSourceMappings() {
  try {
    const mappings = await grist.sectionApi.mappings();
    return normalizeSourceMappings(mappings ?? {});
  } catch {
    return { classLabel: null, classPeriodCount: null };
  }
}

function sourceMappingProblems(metadata, selectedTableId, sourceMappings) {
  const problems = [];
  if (selectedTableId !== "Classe") {
    problems.push("Dans Source de données, sélectionne la table Classe.");
  }

  const classColumns = metadata?.tables?.Classe?.columns ?? [];
  const checks = [
    ["classLabel", "Classe"],
    ["classPeriodCount", "Nombre de périodes de stage"],
  ];
  for (const [key, label] of checks) {
    const columnId = sourceMappings?.[key];
    if (!columnId) {
      problems.push(`Dans le panneau de droite, associe le champ « ${label} » à une colonne de Classe.`);
      continue;
    }
    if (!classColumns.some(column => column.colId === columnId)) {
      problems.push(`Le mapping natif « ${label} » pointe vers une colonne inexistante.`);
    }
  }
  return problems;
}

async function readStoredOptions() {
  try {
    const value = await grist.widgetApi.getOption(OPTION_KEY);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function normalizedOptimization(value) {
  const enabled = value?.diversity?.enabled !== false;
  const priority = ["faible", "moyenne", "forte"].includes(value?.diversity?.priority)
    ? value.diversity.priority
    : DEFAULT_OPTIMIZATION.diversity.priority;
  return { diversity: { enabled, priority } };
}

export async function loadConfiguration() {
  const [metadata, stored, selectedTableId, sourceMappings] = await Promise.all([
    fetchMetadata(),
    readStoredOptions(),
    getSelectedTableId(),
    getSourceMappings(),
  ]);
  const mappings = inferMappings(metadata, stored?.mappings ?? {});
  return {
    metadata,
    mappings,
    sourceMappings,
    optimization: normalizedOptimization(stored?.optimization),
    selectedTableId,
    mappingIssues: validateMappings(metadata, mappings),
    sourceMappingProblems: sourceMappingProblems(metadata, selectedTableId, sourceMappings),
  };
}

export async function saveConfiguration(mappings, optimization) {
  const value = {
    version: 2,
    mappings: { ...mappings },
    optimization: normalizedOptimization(optimization),
  };
  await grist.widgetApi.setOption(OPTION_KEY, value);
  return value;
}

export function initializeGrist(onClassSelection) {
  grist.ready({
    requiredAccess: "full",
    allowSelectBy: true,
    columns: SOURCE_COLUMNS,
  });
  if (typeof onClassSelection === "function") {
    grist.onRecord((record, mappings) => {
      const sourceMappings = normalizeSourceMappings(mappings ?? {});
      onClassSelection({
        classId: ref(record?.id),
        sourceMappings,
      });
    });
    grist.onNewRecord(mappings => {
      onClassSelection({
        classId: null,
        sourceMappings: normalizeSourceMappings(mappings ?? {}),
      });
    });
  }
}

export async function fetchSnapshot(mappings) {
  const [metadata, selectedTableId, sourceMappings, classesRaw, studentsRaw, teachersRaw, quotasRaw, stagesRaw] = await Promise.all([
    fetchMetadata(),
    getSelectedTableId(),
    getSourceMappings(),
    fetchRawTable("Classe"),
    fetchRawTable("Eleves"),
    fetchRawTable("Enseignant"),
    fetchRawTable("Affectation"),
    fetchRawTable("Stage"),
  ]);
  const mappingIssues = validateMappings(metadata, mappings);
  const sourceProblems = sourceMappingProblems(metadata, selectedTableId, sourceMappings);
  const readSecondary = (row, key) => {
    const columnId = mappings?.[key];
    return columnId ? row?.[columnId] : null;
  };
  const readClass = (row, key) => {
    const columnId = sourceMappings?.[key];
    return columnId ? row?.[columnId] : null;
  };

  const classes = rowsFromTable(classesRaw).map(row => ({
    id: row.id,
    label: display(readClass(row, "classLabel"), `Classe #${row.id}`),
    periodCount: integer(readClass(row, "classPeriodCount")),
  }));

  const students = rowsFromTable(studentsRaw).map(row => ({
    id: row.id,
    classId: ref(readSecondary(row, "studentClass")),
    label: display(readSecondary(row, "studentLabel"), `Élève #${row.id}`),
  }));
  const studentById = new Map(students.map(row => [row.id, row]));

  const teachers = rowsFromTable(teachersRaw).map(row => ({
    id: row.id,
    label: display(readSecondary(row, "teacherLabel"), `Enseignant #${row.id}`),
  }));

  const quotas = rowsFromTable(quotasRaw).map(row => ({
    id: row.id,
    teacherId: ref(readSecondary(row, "quotaTeacher")),
    classId: ref(readSecondary(row, "quotaClass")),
    period: integer(readSecondary(row, "quotaPeriod")),
    target: integer(readSecondary(row, "quotaTarget")),
  }));

  const stages = rowsFromTable(stagesRaw).map(row => {
    const studentId = ref(readSecondary(row, "stageStudent"));
    const student = studentById.get(studentId);
    return {
      id: row.id,
      studentId,
      studentLabel: student?.label ?? `Élève #${studentId ?? "?"}`,
      classId: student?.classId ?? null,
      period: integer(readSecondary(row, "stagePeriod")),
      teacherId: ref(readSecondary(row, "stageSupervisor")),
    };
  });

  return {
    classes,
    students,
    teachers,
    quotas,
    stages,
    configuration: {
      metadata,
      mappings: { ...mappings },
      mappingIssues,
      selectedTableId,
      sourceMappings,
      sourceMappingProblems: sourceProblems,
    },
  };
}

export function configurationProblems(snapshot) {
  const problems = [];
  for (const problem of snapshot?.configuration?.sourceMappingProblems ?? []) problems.push(problem);
  for (const mappingIssue of snapshot?.configuration?.mappingIssues ?? []) problems.push(mappingIssue.message);
  return problems;
}

export function buildStageCreationAction(missing, mappings) {
  const rows = Array.isArray(missing) ? missing : [];
  return [
    "BulkAddRecord",
    "Stage",
    rows.map(() => null),
    {
      [mappings.stageStudent]: rows.map(row => row.studentId),
      [mappings.stagePeriod]: rows.map(row => row.period),
    },
  ];
}

export function buildAssignmentActions(assignments, mappings) {
  return (assignments || []).map(assignment => [
    "UpdateRecord",
    "Stage",
    assignment.stageId,
    { [mappings.stageSupervisor]: assignment.teacherId },
  ]);
}

export async function createMissingStages(classId, periods, mappings) {
  const fresh = await fetchSnapshot(mappings);
  const problems = configurationProblems(fresh);
  if (problems.length) throw new Error(problems.join(" "));

  const coverage = stageCoverage(fresh, classId, periods);
  if (coverage.errors.length) {
    throw new Error(coverage.errors.map(row => row.message).join(" "));
  }
  if (!coverage.missing.length) return { snapshot: fresh, createdCount: 0, created: [] };

  await grist.docApi.applyUserActions([buildStageCreationAction(coverage.missing, mappings)]);

  const after = await fetchSnapshot(mappings);
  const afterCoverage = stageCoverage(after, classId, periods);
  if (afterCoverage.errors.some(row => row.code === "DUPLICATE_STAGE")) {
    throw new Error("Des doublons de stages ont été détectés après la création. Vérifie la table Stage avant de poursuivre.");
  }
  if (afterCoverage.missing.length) {
    throw new Error("Certains stages n'ont pas pu être créés. Vérifie les droits d'écriture et le paramétrage des colonnes.");
  }
  return { snapshot: after, createdCount: coverage.missing.length, created: coverage.missing };
}

export async function applyPlan(plan, mappings) {
  if (!plan) throw new Error("Aucune proposition à appliquer.");
  if (plan.mappingSignature && plan.mappingSignature !== mappingSignature(mappings)) {
    throw new Error("Le paramétrage des tables secondaires a changé. Génère une nouvelle proposition.");
  }

  const fresh = await fetchSnapshot(mappings);
  const problems = configurationProblems(fresh);
  if (problems.length) throw new Error(problems.join(" "));

  if (plan.sourceMappingSignature && plan.sourceMappingSignature !== sourceMappingSignature(fresh.configuration.sourceMappings)) {
    throw new Error("Le mapping de la source Classe a changé. Génère une nouvelle proposition.");
  }

  const currentFingerprint = configurationFingerprint(fresh, plan.classId);
  if (currentFingerprint !== plan.fingerprint) {
    throw new Error("Les données ont changé depuis la génération de la proposition. Actualise puis génère une nouvelle proposition.");
  }

  const stageById = new Map(fresh.stages.map(stage => [stage.id, stage]));
  for (const assignment of plan.assignments) {
    const stage = stageById.get(assignment.stageId);
    if (!stage) throw new Error(`Le stage #${assignment.stageId} n'existe plus.`);
    if (stage.teacherId) throw new Error(`Le stage #${assignment.stageId} possède désormais un enseignant. La proposition doit être régénérée.`);
  }

  if (!plan.assignments.length) return fresh;
  await grist.docApi.applyUserActions(buildAssignmentActions(plan.assignments, mappings));
  return fetchSnapshot(mappings);
}
