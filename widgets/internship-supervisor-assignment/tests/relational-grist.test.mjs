import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeClass, generatePlan, periodsForClass, periodLabel, configurationFingerprint } from '../assignment.js';
import { applyPlan, buildStageCreationAction, createMissingStages, fetchSnapshot, loadConfiguration, stagePeriodWriteValue } from '../grist.js';
import { inferMappings, mappingSignature, validateMappings } from '../mapping.js';

// Schema read from dev2 on 2026-10-28; records are entirely synthetic.
const schema = JSON.parse(await readFile(new URL('./fixtures/dev2-schema.json', import.meta.url), 'utf8'));
function columnar(rows) {
  return Object.fromEntries([...new Set(['id', ...rows.flatMap(Object.keys)])].map(key => [key, rows.map(row => row[key] ?? null)]));
}
function documentFixture() {
  let columnId = 1;
  const tables = schema.map((table, index) => ({ id: index + 1, tableId: table.tableId }));
  const columns = schema.flatMap((table, index) => table.columns.map((column, pos) => ({
    ...column, id: columnId++, parentId: index + 1, parentPos: pos + 1,
  })));
  for (const column of columns) {
    const target = tables.find(table => `Ref:${table.tableId}` === column.type);
    column.visibleCol = columns.find(row => row.parentId === target?.id && row.colId === column.visibleColumnId)?.id ?? 0;
  }
  const data = {
    Classes: [{ id: 1, Classe: 'Classe A', Nombre_de_periodes_de_stage: 4 }, { id: 2, Classe: 'Classe B', Nombre_de_periodes_de_stage: 1 }],
    Periodes_de_stage: [{ id: 3, Classe: 1, Numero: '1' }, { id: 19, Classe: 1, Numero: '4' }, { id: 8, Classe: 2, Numero: '1' }],
    Eleves: [11, 12, 13, 14].map(id => ({ id, Classe: 1, Identite: `Élève ${id}` })).concat({ id: 15, Classe: 2, Identite: 'Autre élève' }),
    Enseignants: [21, 22].map(id => ({ id, Identite: `Enseignant ${id}`, Latitude: 47, Longitude: -1, Localisation_validee: true })),
    Structures_de_stage: [{ id: 101, Latitude: 47.01, Longitude: -1.01 }],
    Affectation: [3, 19].flatMap((Periode, i) => [21, 22].map((Enseignant, j) => ({ id: 31 + i * 2 + j, Classe: 1, Enseignant, Periode, Stage_a_suivre: 1 }))),
    Stages: [
      { id: 40, Eleve: 11, Periode: 3, Structure_de_stage: 101, Suivi_par: 21 },
      { id: 41, Eleve: 12, Periode: 3, Structure_de_stage: 101, Suivi_par: 22 },
      { id: 42, Eleve: 11, Periode: 19, Structure_de_stage: 101, Suivi_par: 0 },
      { id: 43, Eleve: 12, Periode: 19, Structure_de_stage: 101, Suivi_par: 0 },
      { id: 44, Eleve: 14, Periode: 19, Structure_de_stage: 0, Suivi_par: 21 },
      { id: 60, Eleve: 15, Periode: 8, Structure_de_stage: 101, Suivi_par: 21 },
    ],
  };
  const writes = [];
  let stored = {};
  let sourceMappings = { ClassLabel: 'Classe', PeriodCount: 'Nombre_de_periodes_de_stage' };
  const api = {
    selectedTable: { async getTableId() { return 'Classes'; } },
    sectionApi: { async mappings() { return sourceMappings; } },
    widgetApi: { async getOption() { return stored; }, async setOption(_key, value) { stored = value; } },
    docApi: {
      async fetchTable(name) {
        if (name === '_grist_Tables') return columnar(tables);
        if (name === '_grist_Tables_column') return columnar(columns);
        assert.ok(data[name], `unexpected table ${name}`);
        return columnar(data[name]);
      },
      async applyUserActions(actions) {
        writes.push(structuredClone(actions));
        for (const [action, table, id, changes] of actions) {
          assert.equal(action, 'UpdateRecord', 'relational model must never create missing stages');
          Object.assign(data[table].find(row => row.id === id), changes);
        }
      },
    },
  };
  return { data, tables, columns, api, writes, setStored(value) { stored = value; }, setSource(value) { sourceMappings = value; } };
}
async function withDocument(run) {
  const previous = globalThis.grist;
  const doc = documentFixture();
  globalThis.grist = doc.api;
  try { await run(doc); } finally { if (previous === undefined) delete globalThis.grist; else globalThis.grist = previous; }
}
async function proposal() {
  const snapshot = await fetchSnapshot({});
  const plan = generatePlan(snapshot, { classId: 1, periods: [19] });
  plan.mappingSignature = mappingSignature(snapshot.configuration.mappings);
  return { snapshot, plan };
}

test('real Grist schema resolves plural table names, reference IDs and nonconsecutive period numbers', async () => withDocument(async () => {
  const snapshot = await fetchSnapshot({});
  assert.deepEqual(snapshot.configuration.mappingIssues, []);
  assert.equal(snapshot.configuration.tableIds.Stage, 'Stages');
  assert.equal(snapshot.configuration.tableIds.Enseignant, 'Enseignants');
  assert.deepEqual(periodsForClass(snapshot.classes[0], snapshot), [3, 19]);
  assert.equal(periodLabel(snapshot, 19), 'P4');
  assert.equal(snapshot.stages.find(row => row.id === 42).periodId, 19);
  assert.equal(snapshot.quotas.find(row => row.id === 33).periodId, 19);
  const analysis = analyzeClass(snapshot, 1, [19]);
  assert.deepEqual(analysis.errors, []);
  assert.equal(analysis.expectedCount, 4);
  assert.equal(analysis.presentCount, 3);
  assert.equal(analysis.declaredCount, 2);
  assert.equal(analysis.missingCount, 1);
  assert.equal(analysis.selectedStageCount, 2);
  assert.equal(analysis.unassignedSelectedCount, 2);
}));

test('single-period optimization uses all historical assignments and preserves every other row', async () => withDocument(async doc => {
  const original = structuredClone(doc.data.Stages);
  const { snapshot, plan } = await proposal();
  assert.deepEqual(plan.assignments.map(row => [row.stageId, row.teacherId, row.periodId]), [[42, 22, 19], [43, 21, 19]]);
  assert.equal(plan.metrics.introducedRepeats, 0);
  assert.equal(plan.metrics.diversifiedAssignments, 2);
  await applyPlan(plan, snapshot.configuration.mappings);
  for (const row of original.filter(row => ![42, 43].includes(row.id))) assert.deepEqual(doc.data.Stages.find(item => item.id === row.id), row);
  assert.deepEqual(doc.writes, [[[ 'UpdateRecord', 'Stages', 42, { Suivi_par: 22 } ], [ 'UpdateRecord', 'Stages', 43, { Suivi_par: 21 } ]]]);
}));

test('unavoidable historical repeats are counted even when diversity is disabled', async () => withDocument(async doc => {
  doc.data.Affectation.find(row => row.id === 33).Stage_a_suivre = 2;
  doc.data.Affectation.find(row => row.id === 34).Stage_a_suivre = 0;
  const snapshot = await fetchSnapshot({});
  for (const enabled of [true, false]) {
    const plan = generatePlan(snapshot, { classId: 1, periods: [19], criteria: { diversity: { enabled } } });
    assert.equal(plan.metrics.introducedRepeats, 1);
    assert.equal(plan.metrics.diversifiedAssignments, 1);
  }
}));

test('existing selected assignments consume only declared quotas and are never replaced', async () => withDocument(async doc => {
  doc.data.Stages.find(row => row.id === 42).Suivi_par = 22;
  const { snapshot, plan } = await proposal();
  assert.equal(plan.metrics.existingCount, 1);
  assert.deepEqual(plan.assignments.map(row => [row.stageId, row.teacherId]), [[43, 21]]);
  await applyPlan(plan, snapshot.configuration.mappings);
  assert.equal(doc.data.Stages.find(row => row.id === 42).Suivi_par, 22);
  assert.equal(doc.data.Stages.find(row => row.id === 44).Suivi_par, 21);
}));

test('missing and undeclared stages neither block declared allocation nor trigger any creation', async () => withDocument(async doc => {
  const { snapshot, plan } = await proposal();
  assert.equal(plan.assignments.length, 2);
  await assert.rejects(createMissingStages(1, [19], snapshot.configuration.mappings), /ne doivent pas être créés/);
  assert.deepEqual(doc.writes, []);
}));

test('quotas must equal declared stages, not class size or placeholder count', async () => withDocument(async doc => {
  doc.data.Affectation.find(row => row.id === 33).Stage_a_suivre = 3;
  const snapshot = await fetchSnapshot({});
  const analysis = analyzeClass(snapshot, 1, [19]);
  assert.ok(analysis.errors.some(row => row.code === 'QUOTA_TOTAL_MISMATCH' && row.expectedCount === 2 && row.targetTotal === 4));
  assert.throws(() => generatePlan(snapshot, { classId: 1, periods: [19] }));
}));

test('empty declared periods accept zero quotas without creating expected stages', async () => withDocument(async doc => {
  doc.data.Stages = doc.data.Stages.filter(row => row.Periode !== 19);
  doc.data.Affectation = doc.data.Affectation.filter(row => row.Periode !== 19);
  const { plan } = await proposal();
  assert.equal(plan.metrics.selectedStageCount, 0);
  assert.equal(plan.assignments.length, 0);
  assert.deepEqual(doc.writes, []);
}));

for (const [name, mutate, code] of [
  ['stage references another class period', doc => { doc.data.Stages[2].Periode = 8; }, 'STAGE_PERIOD_CLASS_MISMATCH'],
  ['foreign student references selected class period', doc => { doc.data.Stages[5].Periode = 19; }, 'STAGE_PERIOD_CLASS_MISMATCH'],
  ['stage has dangling period reference', doc => { doc.data.Stages[2].Periode = 999; }, 'STAGE_PERIOD_CLASS_MISMATCH'],
  ['stage has blank period reference', doc => { doc.data.Stages[2].Periode = 0; }, 'STAGE_PERIOD_CLASS_MISMATCH'],
  ['quota references another class period', doc => { doc.data.Affectation[2].Periode = 8; }, 'QUOTA_PERIOD_CLASS_MISMATCH'],
  ['quota has dangling period reference', doc => { doc.data.Affectation[2].Periode = 999; }, 'QUOTA_PERIOD_CLASS_MISMATCH'],
  ['quota has blank period reference', doc => { doc.data.Affectation[2].Periode = 0; }, 'QUOTA_PERIOD_CLASS_MISMATCH'],
  ['declared student has duplicate stage', doc => { doc.data.Stages.push({ ...doc.data.Stages[2], id: 99 }); }, 'DUPLICATE_STAGE'],
  ['declared teacher has duplicate quota', doc => { doc.data.Affectation.push({ ...doc.data.Affectation[2], id: 99 }); }, 'DUPLICATE_QUOTA'],
  ['quota is fractional', doc => { doc.data.Affectation[2].Stage_a_suivre = 0.5; }, 'INVALID_QUOTA_TARGET'],
  ['quota is negative', doc => { doc.data.Affectation[2].Stage_a_suivre = -1; }, 'INVALID_QUOTA_TARGET'],
]) test(`relational validation rejects ${name} without writing`, async () => withDocument(async doc => {
  mutate(doc);
  const snapshot = await fetchSnapshot({});
  assert.ok(analyzeClass(snapshot, 1, [19]).errors.some(row => row.code === code));
  assert.throws(() => generatePlan(snapshot, { classId: 1, periods: [19] }));
  assert.deepEqual(doc.writes, []);
}));

test('selection cannot silently substitute a period number or a foreign-class reference', async () => withDocument(async () => {
  const snapshot = await fetchSnapshot({});
  for (const periods of [[4], [8], [19, 8]]) assert.ok(analyzeClass(snapshot, 1, periods).errors.some(row => row.code === 'INVALID_SELECTED_PERIOD'));
}));

for (const [name, mutate] of [
  ['historical supervisor', doc => { doc.data.Stages[0].Suivi_par = 22; }],
  ['selected supervisor', doc => { doc.data.Stages[2].Suivi_par = 21; }],
  ['structure removed without geography', doc => { doc.data.Stages[2].Structure_de_stage = 0; }],
  ['placeholder becomes declared', doc => { doc.data.Stages[4].Structure_de_stage = 101; }],
  ['period class', doc => { doc.data.Periodes_de_stage[1].Classe = 2; }],
  ['period number', doc => { doc.data.Periodes_de_stage[1].Numero = '7'; }],
  ['stage period', doc => { doc.data.Stages[2].Periode = 3; }],
  ['quota', doc => { doc.data.Affectation[2].Stage_a_suivre = 2; }],
  ['student class', doc => { doc.data.Eleves[0].Classe = 2; }],
]) test(`pre-apply re-read rejects concurrent change to ${name}`, async () => withDocument(async doc => {
  const { snapshot, plan } = await proposal();
  mutate(doc);
  await assert.rejects(applyPlan(plan, snapshot.configuration.mappings), /données ont changé/);
  assert.deepEqual(doc.writes, []);
}));

test('pre-apply revalidation rejects injected foreign-period, duplicate or incomplete writes', async () => withDocument(async doc => {
  const { snapshot, plan } = await proposal();
  for (const assignments of [
    [{ ...plan.assignments[0], stageId: 60, periodId: 8 }],
    [plan.assignments[0], plan.assignments[0]],
    [plan.assignments[0]],
    plan.assignments.map(row => ({ ...row, teacherId: 21 })),
    plan.assignments.map(row => ({ ...row, teacherId: 999 })),
  ]) await assert.rejects(applyPlan({ ...plan, assignments }, snapshot.configuration.mappings));
  assert.deepEqual(doc.writes, []);
}));

test('stable period table and column bindings survive renaming after configuration', async () => withDocument(async doc => {
  await loadConfiguration();
  const table = doc.tables.find(row => row.tableId === 'Periodes_de_stage');
  table.tableId = 'Calendrier';
  for (const column of doc.columns) {
    if (column.type === 'Ref:Periodes_de_stage') column.type = 'Ref:Calendrier';
    if (column.parentId === table.id && column.colId === 'Numero') { column.colId = 'Rang'; column.label = 'Rang'; }
  }
  doc.data.Calendrier = doc.data.Periodes_de_stage.map(({ Numero, ...row }) => ({ ...row, Rang: Numero }));
  delete doc.data.Periodes_de_stage;
  const snapshot = await fetchSnapshot({});
  assert.deepEqual(snapshot.configuration.mappingIssues, []);
  assert.equal(snapshot.configuration.tableIds.Periodes_de_stage, 'Calendrier');
  assert.equal(periodLabel(snapshot, 19), 'P4');
}));

test('mixed numeric/reference models and missing structure mappings fail closed', async () => withDocument(async doc => {
  let snapshot = await fetchSnapshot({});
  const metadata = structuredClone(snapshot.configuration.metadata);
  metadata.tables.Affectation.columns.find(row => row.colId === 'Periode').type = 'Numeric';
  assert.ok(validateMappings(metadata, inferMappings(metadata), { geography: false }).some(row => row.code === 'INVALID_PERIOD_REFERENCE'));
  const stageTable = doc.tables.find(row => row.tableId === 'Stages');
  doc.columns.splice(doc.columns.findIndex(row => row.parentId === stageTable.id && row.colId === 'Structure_de_stage'), 1);
  metadata.tables.Stage.columns = metadata.tables.Stage.columns.filter(row => row.colId !== 'Structure_de_stage');
  assert.ok(validateMappings(metadata, inferMappings(metadata), { geography: false }).some(row => row.key === 'stageStructure'));
  await assert.rejects(fetchSnapshot({}), /Stage/);
}));

test('reference write serialization accepts only positive row IDs', () => {
  const mappings = { stageStudent: 'Eleve', stagePeriod: 'Periode' };
  assert.deepEqual(buildStageCreationAction([{ studentId: 11, periodId: 19 }], mappings, 'Stages', 'Ref:Periodes_de_stage')[3], { Eleve: [11], Periode: [19] });
  for (const value of [0, -1, 1.5, 'P4', null]) assert.throws(() => stagePeriodWriteValue(value, 'Ref:Periodes_de_stage'));
});

test('history fingerprint changes independently of selected periods', async () => withDocument(async doc => {
  const before = await fetchSnapshot({});
  doc.data.Stages[0].Suivi_par = 22;
  const after = await fetchSnapshot({});
  assert.notEqual(configurationFingerprint(before, 1), configurationFingerprint(after, 1));
}));

test('single-period diversity matches an exhaustive oracle for all two-teacher histories', async () => withDocument(async doc => {
  for (const first of [21, 22]) for (const second of [21, 22]) {
    doc.data.Stages[0].Suivi_par = first;
    doc.data.Stages[1].Suivi_par = second;
    for (const quotaA of [0, 1, 2]) {
      doc.data.Affectation[2].Stage_a_suivre = quotaA;
      doc.data.Affectation[3].Stage_a_suivre = 2 - quotaA;
      const { plan } = await proposal();
      const candidates = [[21, 21], [21, 22], [22, 21], [22, 22]].filter(rows => rows.filter(id => id === 21).length === quotaA);
      const optimum = Math.min(...candidates.map(rows => Number(rows[0] === first) + Number(rows[1] === second)));
      assert.equal(plan.metrics.introducedRepeats, optimum);
      assert.equal(plan.metrics.objectiveScore, optimum * plan.scoring.diversityPenalty);
      assert.ok(plan.summary.every(row => row.total === row.target));
    }
  }
}));

test('relational geography checks only declared, modifiable stages', async () => withDocument(async doc => {
  const snapshot = await fetchSnapshot({}, { geography: true });
  const criteria = { geography: { enabled: true }, diversity: { enabled: true } };
  const analysis = analyzeClass(snapshot, 1, [19], criteria);
  assert.deepEqual(analysis.errors, []);
  assert.equal(analysis.geography.requiredStageCount, 2);
  const plan = generatePlan(snapshot, { classId: 1, periods: [19], criteria });
  assert.equal(plan.metrics.geographicAssignments, 2);
  await applyPlan(plan, snapshot.configuration.mappings);
  assert.equal(doc.data.Stages.find(row => row.id === 44).Structure_de_stage, 0);
}));

test('declared rows without assignments do not add fictional diversity history', async () => withDocument(async doc => {
  doc.data.Stages[0].Suivi_par = 0;
  doc.data.Stages[1].Suivi_par = 0;
  const { plan } = await proposal();
  assert.equal(plan.metrics.introducedRepeats, 0);
  assert.equal(plan.metrics.objectiveScore, 0);
}));

test('period table membership is authoritative even when native period count is stale', async () => withDocument(async doc => {
  doc.data.Classes[0].Nombre_de_periodes_de_stage = 0;
  const { snapshot, plan } = await proposal();
  assert.deepEqual(periodsForClass(snapshot.classes[0], snapshot), [3, 19]);
  assert.equal(plan.assignments.length, 2);
}));

test('changing effective column bindings invalidates a proposal before any write', async () => withDocument(async doc => {
  const { snapshot, plan } = await proposal();
  const table = doc.tables.find(row => row.tableId === 'Stages');
  const column = doc.columns.find(row => row.parentId === table.id && row.colId === 'Suivi_par');
  column.colId = 'Tuteur';
  for (const row of doc.data.Stages) { row.Tuteur = row.Suivi_par; delete row.Suivi_par; }
  await assert.rejects(applyPlan(plan, snapshot.configuration.mappings), /données ont changé/);
  assert.deepEqual(doc.writes, []);
}));

test('an existing period catalogue cannot silently fall back to numeric period mappings', async () => withDocument(async doc => {
  for (const column of doc.columns) if (column.type === 'Ref:Periodes_de_stage') column.type = 'Numeric';
  const snapshot = await fetchSnapshot({});
  assert.ok(snapshot.configuration.mappingIssues.some(row => row.code === 'INVALID_PERIOD_REFERENCE' && row.key === 'stagePeriod'));
  assert.ok(snapshot.configuration.mappingIssues.some(row => row.code === 'INVALID_PERIOD_REFERENCE' && row.key === 'quotaPeriod'));
  assert.deepEqual(doc.writes, []);
}));
