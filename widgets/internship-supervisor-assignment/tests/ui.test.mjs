import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

const requiredIds = [
  'config-status', 'refresh', 'settings-toggle', 'settings-panel', 'settings-backdrop',
  'settings-close', 'settings-save', 'mapping-auto', 'mapping-fields', 'mapping-status',
  'criterion-diversity', 'priority-diversity', 'class-name', 'periods', 'analysis',
  'stage-creation', 'stage-creation-title', 'create-stages', 'generate', 'proposal-card',
  'proposal-periods', 'proposal-summary', 'proposal-details', 'quota-details', 'apply',
];

test('charge le socle UI commun avant la feuille locale', () => {
  const tokens = html.indexOf('../../shared/ui/tokens.css');
  const base = html.indexOf('../../shared/ui/base.css');
  const components = html.indexOf('../../shared/ui/components.css');
  const local = html.indexOf('style.css?v=1.2.0');
  assert.ok(tokens >= 0 && tokens < base && base < components && components < local);
});

test('préserve le contrat DOM attendu par app.js', () => {
  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `ID manquant: ${id}`);
  }
});

test('utilise les pictogrammes validés Actualiser et Paramètres', () => {
  assert.ok(!html.includes('>↻<'));
  assert.ok(!html.includes('>⚙<'));
  assert.match(html, /M13\.663 4\.175A8 8 0 1 0 19\.417 14\.997/);
  assert.match(html, /cx="18\.128" cy="6\.858" r="2\.1"/);
  assert.match(html, /x="2\.5" y="4\.5" width="10\.5" height="3\.4"/);
  assert.match(html, /cx="17\.2" cy="6\.2" r="2\.3"/);
  assert.match(html, /class="gw-icon--accented"/);
});

test('garde le CSS local centré sur le métier et les états dynamiques', () => {
  assert.match(css, /var\(--gw-color-primary\)/);
  assert.match(css, /\.status\.ok/);
  assert.match(css, /\.status\.error/);
  assert.match(css, /\.stage-creation/);
  assert.match(css, /\.settings-panel/);
});
