import { recordsFromTable } from "../../shared/grist/records.js";
import { isWritableColumn } from "../../shared/grist/metadata.js";
import { configurationFingerprint, stageCoverage } from "./assignment.js";
import {
  DOCUMENT_TABLES,
  inferMappings,
  mappingSignature,
  serializeBindings,
  validateMappings,
} from "./mapping.js";

const OPTION_KEY = "internshipSupervisorAssignmentV11";
const CONFIG_VERSION = 5;
const DEFAULT_OPTIMIZATION = Object.freeze({
  geography: { enabled: true, priority: "forte" },
  diversity: { enabled: true, priority: "moyenne" },
});

export const SOURCE_COLUMNS = Object.freeze([
  { name: "ClassLabel", title: "Classe", type: "Text", optional: false },
  { name: "PeriodCount", title: "Nombre de périodes de stage", type: "Numeric", optional: false },
]);

function rowsFromTable(table) {
  return recordsFromTable(table, { numericIds: true });
}

function ref(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function integer(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function finiteNumber(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "oui", "vrai"].includes(normalized);
}

function display(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

async function fetchRawTable(tableId) {
  try {
    return await grist.docApi.fetchTable(tableId);
  } catch {
    throw new Error(`Table Grist introuvable : ${tableId}.`);
  }
}

async function fetchOptionalRawTable(tableId) {
  try {
    return await grist.docApi.fetchTable(tableId);
  } catch {
    return null;
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
        ref: ref(column.id),
        colId: String(column.colId),
        label: display(column.label, column.colId),
        type: String(column.type ?? "Any"),
        visibleColRef: ref(column.visibleCol),
        isFormula: Boolean(column.isFormula),
        formula: String(column.formula ?? ""),
        writable: isWritableColumn(column),
        position: Number(column.parentPos ?? 0),
      }))
      .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, "fr"));
    result.tables[tableId] = {
      id: ref(table.id),
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

function normalizedCriterion(value, fallback, { defaultEnabled } = {}) {
  const enabled = value?.enabled === undefined ? defaultEnabled : value.enabled !== false;
  const priority = ["faible", "moyenne", "forte"].includes(value?.priority)
    ? value.priority
    : fallback.priority;
  return { enabled, priority };
}

function normalizedOptimization(value) {
  return {
    geography: normalizedCriterion(value?.geography, DEFAULT_OPTIMIZATION.geography, { defaultEnabled: true }),
    diversity: normalizedCriterion(value?.diversity, DEFAULT_OPTIMIZATION.diversity, { defaultEnabled: true }),
  };
}

function storedMappingSource(stored, fallback = {}) {
  if (stored?.bindings && typeof stored.bindings === "object") return stored.bindings;
  if (stored?.mappings && typeof stored.mappings === "object") return stored.mappings;
  return fallback ?? {};
}

function storedValue(metadata, mappings, optimization) {
  return {
    version: CONFIG_VERSION,
    bindings: serializeBindings(metadata, mappings),
    optimization: normalizedOptimization(optimization),
  };
}

async function persistConfiguration(metadata, mappings, optimization) {
  const value = storedValue(metadata, mappings, optimization);
  await grist.widgetApi.setOption(OPTION_KEY, value);
  return value;
}

export async function loadConfiguration() {
  const [metadata, stored, selectedTableId, sourceMappings] = await Promise.all([
    fetchMetadata(),
    readStoredOptions(),
    getSelectedTableId(),
    getSourceMappings(),
  ]);
  const optimization = normalizedOptimization(stored?.optimization);
  const mappings = inferMappings(metadata, storedMappingSource(stored));
  const mappingIssues = validateMappings(metadata, mappings, { geography: optimization.geography.enabled });

  if ((!stored?.bindings || Number(stored?.version) < CONFIG_VERSION) && !mappingIssues.length) {
    try {
      await persistConfiguration(metadata, mappings, optimization);
    } catch {
      // La migration reste facultative : le format V4 continue d'être lu tant que Grist n'a pas pu enregistrer V5.
    }
  }

  return {
    metadata,
    mappings,
    sourceMappings,
    optimization,
    selectedTableId,
    mappingIssues,
    sourceMappingProblems: sourceMappingProblems(metadata, selectedTableId, sourceMappings),
  };
}

export async function saveConfiguration(mappings, optimization) {
  const metadata = await fetchMetadata();
  const resolvedMappings = inferMappings(metadata, mappings);
  return persistConfiguration(metadata, resolvedMappings, optimization);
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

export async function fetchSnapshot(mappings, { geography = false } = {}) {
  const structuresPromise = geography ? fetchRawTable("Structures_de_stage") : fetchOptionalRawTable("Structures_de_stage");
  const [metadata, stored, selectedTableId, sourceMappings, classesRaw, studentsRaw, teachersRaw, quotasRaw, stagesRaw, structuresRaw] = await Promise.all([
    fetchMetadata(),
    readStoredOptions(),
    getSelectedTableId(),
    getSourceMappings(),
    fetchRawTable("Classe"),
    fetchRawTable("Eleves"),
    fetchRawTable("Enseignant"),
    fetchRawTable("Affectation"),
    fetchRawTable("Stage"),
    structuresPromise,
  ]);
  const effectiveMappings = inferMappings(metadata, storedMappingSource(stored, mappings));
  const mappingIssues = validateMappings(metadata, effectiveMappings, { geography });
  const sourceProblems = sourceMappingProblems(metadata, selectedTableId, sourceMappings);
  const readSecondary = (row, key) => {
    const columnId = effectiveMappings?.[key];
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
    latitude: finiteNumber(readSecondary(row, "teacherLatitude")),
    longitude: finiteNumber(readSecondary(row, "teacherLongitude")),
    locationValidated: boolValue(readSecondary(row, "teacherLocationValidated")),
  }));

  const quotas = rowsFromTable(quotasRaw).map(row => ({
    id: row.id,
    teacherId: ref(readSecondary(row, "quotaTeacher")),
    classId: ref(readSecondary(row, "quotaClass")),
    period: integer(readSecondary(row, "quotaPeriod")),
    target: integer(readSecondary(row, "quotaTarget")),
  }));

  const structures = structuresRaw ? rowsFromTable(structuresRaw).map(row => ({
    id: row.id,
    latitude: finiteNumber(readSecondary(row, "structureLatitude")),
    longitude: finiteNumber(readSecondary(row, "structureLongitude")),
  })) : [];
  const structureById = new Map(structures.map(row => [row.id, row]));

  const stages = rowsFromTable(stagesRaw).map(row => {
    const studentId = ref(readSecondary(row, "stageStudent"));
    const student = studentById.get(studentId);
    const structureId = ref(readSecondary(row, "stageStructure"));
    const structure = structureById.get(structureId);
    return {
      id: row.id,
      studentId,
      studentLabel: student?.label ?? `Élève #${studentId ?? "?"}`,
      classId: student?.classId ?? null,
      period: integer(readSecondary(row, "stagePeriod")),
      teacherId: ref(readSecondary(row, "stageSupervisor")),
      structureId,
      latitude: structure?.latitude ?? null,
      longitude: structure?.longitude ?? null,
    };
  });

  return {
    classes,
    students,
    teachers,
    quotas,
    stages,
    structures,
    configuration: {
      metadata,
      mappings: { ...effectiveMappings },
      mappingIssues,
      selectedTableId,
      sourceMappings,
      sourceMappingProblems: sourceProblems,
      geography,
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
  const fresh = await fetchSnapshot(mappings, { geography: false });
  const problems = configurationProblems(fresh);
  if (problems.length) throw new Error(problems.join(" "));

  const coverage = stageCoverage(fresh, classId, periods);
  if (coverage.errors.length) {
    throw new Error(coverage.errors.map(row => row.message).join(" "));
  }
  if (!coverage.missing.length) return { snapshot: fresh, createdCount: 0, created: [] };

  const effectiveMappings = fresh.configuration.mappings;
  await grist.docApi.applyUserActions([buildStageCreationAction(coverage.missing, effectiveMappings)]);

  const after = await fetchSnapshot(effectiveMappings, { geography: false });
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

  const geography = plan.criteria?.geography?.enabled === true;
  const fresh = await fetchSnapshot(mappings, { geography });
  const problems = configurationProblems(fresh);
  if (problems.length) throw new Error(problems.join(" "));

  if (plan.sourceMappingSignature && plan.sourceMappingSignature !== sourceMappingSignature(fresh.configuration.sourceMappings)) {
    throw new Error("Le mapping de la source Classe a changé. Génère une nouvelle proposition.");
  }

  const currentFingerprint = configurationFingerprint(fresh, plan.classId, plan.criteria);
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
  const effectiveMappings = fresh.configuration.mappings;
  await grist.docApi.applyUserActions(buildAssignmentActions(plan.assignments, effectiveMappings));
  return fetchSnapshot(effectiveMappings, { geography });
}
