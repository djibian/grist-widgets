import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OUTLOOK_COMPOSE_BASE,
  buildOutlookComposeUrl,
  renderTemplate,
  validateComposeData
} from '../compose.js';

test('validateComposeData requires recipient, subject and body', () => {
  assert.deepEqual(validateComposeData({}), {
    valid: false,
    missing: ['Destinataire', 'Objet', 'Corps']
  });

  assert.deepEqual(validateComposeData({
    recipient: 'agent@example.fr',
    subject: 'Objet',
    body: 'Bonjour'
  }), {
    valid: true,
    missing: []
  });
});

test('renderTemplate substitutes Grist column identifiers', () => {
  assert.deepEqual(
    renderTemplate('Bonjour {{Prenom}},\n{{Lien_Stages}}', {
      Prenom: 'Élodie',
      Lien_Stages: 'https://example.fr/access?token=a&mode=1'
    }),
    {
      text: 'Bonjour Élodie,\nhttps://example.fr/access?token=a&mode=1',
      missingFields: []
    }
  );
});

test('renderTemplate reports unknown variables once', () => {
  assert.deepEqual(
    renderTemplate('{{Inconnue}} puis {{ Inconnue }}', {}),
    {
      text: ' puis ',
      missingFields: ['Inconnue']
    }
  );
});

test('buildOutlookComposeUrl uses Outlook Web compose deeplink', () => {
  const url = buildOutlookComposeUrl({
    recipient: ' agent@example.fr ',
    subject: 'Suivi & accès élève',
    body: 'Bonjour Élodie'
  });

  assert.equal(
    url,
    `${OUTLOOK_COMPOSE_BASE}?popoutv2=1&to=agent%40example.fr&subject=Suivi%20%26%20acc%C3%A8s%20%C3%A9l%C3%A8ve&body=Bonjour%20%C3%89lodie`
  );

  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/mail/0/deeplink/compose');
  assert.equal(parsed.searchParams.get('popoutv2'), '1');
  assert.equal(parsed.searchParams.get('to'), 'agent@example.fr');
  assert.equal(parsed.searchParams.get('subject'), 'Suivi & accès élève');
});

test('buildOutlookComposeUrl preserves line breaks and full URLs through encoding', () => {
  const url = buildOutlookComposeUrl({
    recipient: 'agent@example.fr',
    subject: 'Votre lien',
    body: 'Bonjour,\n\nhttps://example.fr/access?token=a&mode=1\n\nCordialement'
  });

  assert.match(url, /body=Bonjour%2C%0A%0Ahttps%3A%2F%2Fexample\.fr%2Faccess%3Ftoken%3Da%26mode%3D1%0A%0ACordialement$/);
});

test('buildOutlookComposeUrl rejects incomplete messages', () => {
  assert.throws(
    () => buildOutlookComposeUrl({ recipient: 'agent@example.fr', subject: '', body: 'Bonjour' }),
    /Champs manquants : Objet/
  );
});
