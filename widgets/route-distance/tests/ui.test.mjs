import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const originConfig = await readFile(new URL('../origin-config.js', import.meta.url), 'utf8');
const style = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const structureCss = await readFile(new URL('../../../shared/ui/structure.css', import.meta.url), 'utf8');

test('charge le socle Grist Studio complet dans le bon ordre', () => {
  const tokens = html.indexOf('../../shared/ui/tokens.css');
  const base = html.indexOf('../../shared/ui/base.css');
  const components = html.indexOf('../../shared/ui/components.css');
  const structure = html.indexOf('../../shared/ui/structure.css');
  const local = html.indexOf('style.css?v=1.4.0');
  assert.ok(tokens >= 0 && tokens < base && base < components && components < structure && structure < local);
  assert.match(html, /app\.js\?v=1\.4\.0/);
  assert.doesNotMatch(html, /studio\.css/);
});

test('préserve les identifiants métier et ajoute la validation explicite', () => {
  for (const id of [
    'mappingError', 'appCard', 'recordTitle', 'recordAddress', 'distanceValue',
    'durationValue', 'calculateSelected', 'saveSelected', 'status', 'routeContextState',
    'destinationTitle', 'destinationAddress', 'originAddress', 'originSave',
    'originCurrent', 'originStatus'
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

test('rend l’adresse de départ modifiable, géocodée et persistante', () => {
  assert.match(html, /id="originAddress"[^>]*placeholder="Saisir une adresse de départ"/);
  assert.match(html, /id="originSave"[^>]*>Définir</);
  assert.match(originConfig, /geocodeAddress/);
  assert.match(originConfig, /grist\.setOption\(OPTION_KEY, next\)/);
  assert.match(originConfig, /const OPTION_KEY = 'routeOrigin'/);
  assert.match(app, /getRouteOrigin\(\)/);
  assert.match(app, /startLatitude: origin\.latitude/);
  assert.match(app, /startLongitude: origin\.longitude/);
  assert.match(app, /Le point de départ a changé pendant le calcul/);
  assert.doesNotMatch(app, /DOMICILE_LATITUDE|DOMICILE_LONGITUDE/);
});

test('utilise un cadre fluide et une zone résultat responsive', () => {
  assert.match(structureCss, /\.gw-widget-frame[\s\S]*width: calc\(100% - 32px\)[\s\S]*max-width: none/);
  assert.match(style, /\.route-shell\.gw-widget-frame \{[\s\S]*width: 100%;[\s\S]*margin: 0;[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*box-shadow: none;/);
  assert.doesNotMatch(style, /920px/);
  assert.match(style, /\.route-work-grid[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(320px, 32%\)/);
  assert.match(style, /@container gw-widget \(max-width: 760px\)[\s\S]*\.route-work-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(style, /\.route-origin-input-row[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(style, /@container gw-widget \(max-width: 480px\)[\s\S]*\.route-origin-input-row \{ grid-template-columns: 1fr; \}/);
  assert.match(style, /\.route-header \.gw-kicker \{ color: var\(--gw-color-workflow\); \}/);
  assert.doesNotMatch(style, /gw-color-geography/);
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
