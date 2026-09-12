import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexUrl = new URL('../index.html', import.meta.url);

async function readIndex() {
  return readFile(indexUrl, 'utf8');
}

test('le widget charge le socle UI partagé dans le bon ordre', async () => {
  const html = await readIndex();
  const tokens = html.indexOf('../../shared/ui/tokens.css');
  const base = html.indexOf('../../shared/ui/base.css');
  const components = html.indexOf('../../shared/ui/components.css');
  const local = html.indexOf('style.css');

  assert.ok(tokens >= 0, 'tokens.css doit être chargé');
  assert.ok(base > tokens, 'base.css doit suivre tokens.css');
  assert.ok(components > base, 'components.css doit suivre base.css');
  assert.ok(local > components, 'style.css local doit être chargé en dernier');
});

test('les identifiants attendus par app.js restent présents', async () => {
  const html = await readIndex();

  for (const id of [
    'mappingError',
    'appCard',
    'recordTitle',
    'recordAddress',
    'distanceValue',
    'durationValue',
    'calculateSelected',
    'status'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} doit rester présent`);
  }
});
