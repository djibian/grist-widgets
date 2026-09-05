import { configurationFingerprint } from "./assignment.js";

const REQUIRED_COLUMNS = Object.freeze({
  Classe: ["Classe", "Nombre_de_periodes_de_stage"],
  Eleves: ["Classe"],
  Enseignant: [],
  Affectation: ["Enseignant", "Classe", "Periode", "Nombre_de_stages_a_suivre"],
  Stage: ["Eleve", "Classe", "Periode", "Suivi_par"],
});

function rowsFromTable(table) {
  const ids = Array.isArray(table?.id) ? table.id : [];
  return ids.map((id, index) => {
    const row = { id: Number(id) };
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

function label(parts, fallback) {
  const text = parts.map(value => String(value ?? "").trim()).filter(Boolean).join(" ").trim();
  return text || fallback;
}

async function fetchRawTable(tableId) {
  try {
    return await grist.docApi.fetchTable(tableId);
  } catch (error) {
    throw new Error(`Table Grist introuvable : ${tableId}.`);
  }
}

function missingColumns(rawTables) {
  const issues = [];
  for (const [tableId, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const table = rawTables[tableId];
    for (const columnId of columns) {
      if (!Array.isArray(table?.[columnId])) issues.push(`${tableId}.${columnId}`);
    }
  }
  return issues;
}

async function stageFollowupColumnIsWritable() {
  try {
    const tables = rowsFromTable(await grist.docApi.fetchTable("_grist_Tables"));
    const stageTable = tables.find(row => String(row.tableId) === "Stage");
    if (!stageTable) return false;
    const columns = rowsFromTable(await grist.docApi.fetchTable("_grist_Tables_column"));
    const followup = columns.find(row => row.parentId === stageTable.id && String(row.colId) === "Suivi_par");
    if (!followup) return false;
    return !(Boolean(followup.isFormula) && String(followup.formula ?? "").trim());
  } catch {
    return true;
  }
}

export function initializeGrist() {
  grist.ready({ requiredAccess: "full" });
}

export async function fetchSnapshot() {
  const [classesRaw, studentsRaw, teachersRaw, quotasRaw, stagesRaw] = await Promise.all([
    fetchRawTable("Classe"),
    fetchRawTable("Eleves"),
    fetchRawTable("Enseignant"),
    fetchRawTable("Affectation"),
    fetchRawTable("Stage"),
  ]);

  const rawTables = {
    Classe: classesRaw,
    Eleves: studentsRaw,
    Enseignant: teachersRaw,
    Affectation: quotasRaw,
    Stage: stagesRaw,
  };
  const missing = missingColumns(rawTables);
  const followupWritable = await stageFollowupColumnIsWritable();

  const classes = rowsFromTable(classesRaw).map(row => ({
    id: row.id,
    label: label([row.Classe], `Classe #${row.id}`),
    periodCount: integer(row.Nombre_de_periodes_de_stage),
  }));

  const students = rowsFromTable(studentsRaw).map(row => ({
    id: row.id,
    classId: ref(row.Classe),
    label: label([row.Identite], label([row.Prenom, row.Nom], `Élève #${row.id}`)),
  }));
  const studentById = new Map(students.map(row => [row.id, row]));

  const teachers = rowsFromTable(teachersRaw).map(row => ({
    id: row.id,
    label: label([row.Identite], label([row.Titre, row.Nom, row.Prenom], `Enseignant #${row.id}`)),
    address: String(row.Adresse ?? "").trim(),
  }));

  const quotas = rowsFromTable(quotasRaw).map(row => ({
    id: row.id,
    teacherId: ref(row.Enseignant),
    classId: ref(row.Classe),
    period: integer(row.Periode),
    target: integer(row.Nombre_de_stages_a_suivre),
  }));

  const stages = rowsFromTable(stagesRaw).map(row => {
    const studentId = ref(row.Eleve);
    return {
      id: row.id,
      studentId,
      studentLabel: studentById.get(studentId)?.label ?? `Élève #${studentId ?? "?"}`,
      classId: ref(row.Classe),
      period: integer(row.Periode),
      teacherId: ref(row.Suivi_par),
    };
  });

  return {
    classes,
    students,
    teachers,
    quotas,
    stages,
    configuration: {
      missingColumns: missing,
      followupWritable,
    },
  };
}

export function configurationProblems(snapshot) {
  const problems = [];
  if (snapshot?.configuration?.missingColumns?.length) {
    problems.push(`Colonnes manquantes : ${snapshot.configuration.missingColumns.join(", ")}.`);
  }
  if (snapshot?.configuration?.followupWritable === false) {
    problems.push("Stage.Suivi_par doit être une colonne de données modifiable.");
  }
  return problems;
}

export async function applyPlan(plan) {
  if (!plan) throw new Error("Aucune proposition à appliquer.");
  const fresh = await fetchSnapshot();
  const problems = configurationProblems(fresh);
  if (problems.length) throw new Error(problems.join(" "));

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
  const actions = plan.assignments.map(assignment => [
    "UpdateRecord",
    "Stage",
    assignment.stageId,
    { Suivi_par: assignment.teacherId },
  ]);
  await grist.docApi.applyUserActions(actions);
  return fetchSnapshot();
}
