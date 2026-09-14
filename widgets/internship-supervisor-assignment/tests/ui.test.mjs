import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const structureCss = await readFile(new URL('../../../shared/ui/structure.css', import.meta.url), 'utf8');
const tokensCss = await readFile(new URL('../../../shared/ui/tokens.css', import.meta.url), 'utf8');

const requiredIds = [
  'config-status', 'refresh', 'settings-toggle', 'settings-panel', 'settings-close',
  'settings-save', 'mapping-details', 'mapping-summary', 'mapping-summary-meta',
  'mapping-auto', 'mapping-fields', 'mapping-status', 'criterion-diversity',
  'priority-diversity', 'class-name', 'periods', 'analysis', 'stage-creation',
  'stage-creation-title', 'create-stages', 'generate', 'proposal-card',
  'proposal-periods', 'proposal-summary', 'proposal-details', 'quota-details', 'apply',
];

test('charge tout le socle Grist Studio avant la feuille locale', () => {
  const tokens = html.indexOf('../../shared/ui/tokens.css');
  const base = html.indexOf('../../shared/ui/base.css');
  const components = html.indexOf('../../shared/ui/components.css');
  const structure = html.indexOf('../../shared/ui/structure.css');
  const local = html.indexOf('style.css?v=1.5.0');
  assert.ok(tokens >= 0 && tokens < base && base < components && components < structure && structure < local);
});

test('préserve le contrat DOM attendu par app.js', () => {
  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `ID manquant: ${id}`);
  }
});

test('utilise les pictogrammes validés Actualiser et Paramétrage', () => {
  assert.ok(!html.includes('>↻<'));
  assert.ok(!html.includes('>⚙<'));
  assert.match(html, /M13\.663 4\.175A8 8 0 1 0 19\.417 14\.997/);
  assert.match(html, /cx="18\.128" cy="6\.858" r="2\.1"/);
  assert.match(html, /x="2\.5" y="4\.5" width="10\.5" height="3\.4"/);
  assert.match(html, /cx="17\.2" cy="6\.2" r="2\.3"/);
  assert.match(html, /class="gw-icon--accented"/);
  assert.match(html, /gw-tool-button__label">Actualiser/);
  assert.match(html, /gw-tool-button__label">Paramétrage/);
  assert.match(html, /aria-controls="settings-panel"/);
});

test('ouvre un paramétrage hiérarchisé dans le flux juste sous le contexte', () => {
  const context = html.indexOf('class="gw-context-strip"');
  const settings = html.indexOf('id="settings-panel"');
  const prepare = html.indexOf('class="gw-work-section prepare-section"');
  assert.ok(context >= 0 && context < settings && settings < prepare);
  assert.match(html, /id="settings-panel" class="settings-panel" hidden/);
  assert.match(html, />Règles de répartition</);
  assert.match(html, /id="mapping-details" class="settings-data"/);
  assert.match(html, />Configuration des données</);
  assert.match(html, />Détecter automatiquement les colonnes</);
  assert.doesNotMatch(html, /settings-backdrop/);
  assert.doesNotMatch(html, /gw-work-main settings-main|gw-decision-panel settings-decision/);
});

test('rend la configuration des colonnes secondaire mais automatiquement visible en cas de problème', () => {
  assert.match(app, /mappingDetails: \$\("#mapping-details"\)/);
  assert.match(app, /mappingSummary: \$\("#mapping-summary"\)/);
  assert.match(app, /✓ Colonnes Grist correctement configurées/);
  assert.match(app, /point\(s\) à vérifier/);
  assert.match(app, /el\.mappingDetails\.open = true/);
  assert.match(app, /validateMappings\(state\.metadata, state\.mappings\)\.length > 0/);
  assert.doesNotMatch(app, /settingsBackdrop|settings-backdrop/);
});

test('présente les mappings en grille seulement lorsqu ils sont développés', () => {
  assert.match(css, /\.mapping-fields\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.settings-data-status\.success/);
  assert.match(css, /\.settings-data-status\.warning/);
  assert.doesNotMatch(css, /\.settings-panel\s*\{[^}]*grid-template-columns/s);
  assert.doesNotMatch(css, /backdrop-filter/);
});

test('matérialise la grammaire contexte travail validation', () => {
  assert.match(html, /class="gw-context-strip"/);
  assert.match(html, />Classe</);
  assert.match(html, />Périodes</);
  assert.match(html, />État</);
  assert.match(html, /01 · Préparer/);
  assert.match(html, /02 · Vérifier/);
  assert.match(html, /class="gw-validation-bar prepare-validation"/);
  assert.match(html, /class="gw-validation-bar proposal-validation"/);
});

test('partage le mark, le bleu workflow et le cadre fluide commun', () => {
  assert.match(structureCss, /\.gw-widget-frame[\s\S]*width: calc\(100% - 32px\)[\s\S]*max-width: none[\s\S]*container-name: gw-widget/);
  assert.match(structureCss, /\.gw-widget-icon[\s\S]*linear-gradient\(#79d4b7 0 0\)/);
  assert.match(structureCss, /\.gw-widget-header \.app-kicker,[\s\S]*color: var\(--gw-color-workflow\)/);
  assert.match(structureCss, /\.gw-step-heading__index[\s\S]*color: var\(--gw-color-workflow\)/);
  assert.match(structureCss, /\.gw-step-heading \.small-context[\s\S]*background: var\(--gw-color-workflow-soft\)/);
  assert.match(tokensCss, /--gw-color-workflow: #3567d6/);
});

test('garde le CSS local centré sur le métier et les états dynamiques', () => {
  assert.match(css, /var\(--gw-color-primary\)/);
  assert.match(css, /\.gw-context-status\.status\.ok/);
  assert.match(css, /\.gw-context-status\.status\.error/);
  assert.match(css, /\.stage-creation/);
  assert.match(css, /\.settings-panel/);
  assert.match(css, /\.proposal-details-grid/);
});
