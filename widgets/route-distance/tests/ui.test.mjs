import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const studio = await readFile(new URL('../studio.css', import.meta.url), 'utf8');

test('charge le socle Grist Studio complet dans le bon ordre', () => {
  const tokens = html.indexOf('../../shared/ui/tokens.css');
  const base = html.indexOf('../../shared/ui/base.css');
  const components = html.indexOf('../../shared/ui/components.css');
  const structure = html.indexOf('../../shared/ui/structure.css');
  const local = html.indexOf('style.css?v=1.3.0');
  const studioIndex = html.indexOf('studio.css?v=1.3.0');
  assert.ok(tokens >= 0 && tokens < base && base < components && components < structure && structure < local && local < studioIndex);
});

test('préserve les identifiants métier et ajoute la validation explicite', () => {
  for (const id of [
    'mappingError', 'appCard', 'recordTitle', 'recordAddress', 'distanceValue',
    'durationValue', 'calculateSelected', 'saveSelected', 'status', 'routeContextState',
    'destinationTitle', 'destinationAddress'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} doit rester présent`);
  }
});

test('matérialise le flux contexte calcul vérification', () => {
  assert.match(html, /class="gw-context-strip"/);
  assert.match(html, /01 · Calculer/);
  assert.match(html, /02 · Vérifier/);
  assert.match(html, /class="gw-work-grid route-work-grid"/);
  assert.match(html, /class="gw-decision-panel route-result"/);
  assert.match(html, /Calcul sans écriture/);
});

test('utilise le bleu pour Géoplateforme IGN et ne laisse plus de bandeau supérieur', () => {
  assert.match(studio, /\.route-shell \{[^}]*margin-top: 0/);
  assert.match(studio, /\.route-header \.gw-kicker \{ color: var\(--gw-color-geography\); \}/);
});

test('sépare le calcul de l’écriture dans Grist', () => {
  const calculateStart = app.indexOf('async function calculateSelected');
  const saveStart = app.indexOf('async function saveSelected');
  const calculateBody = app.slice(calculateStart, saveStart);
  const saveBody = app.slice(saveStart);
  assert.doesNotMatch(calculateBody, /table\.update/);
  assert.match(saveBody, /table\.update\(buildRouteUpdate/);
  assert.match(app, /state\.pending = \{ operation, result \}/);
  assert.match(app, /elements\.saveSelected\.addEventListener/);
});
