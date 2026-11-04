import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCatalog, messageSignature } from './i18n-catalog.mjs';

test('rejects duplicate groups and messages before JSON parsing loses them', () => {
  const result = readCatalog('{"menu":{"open":"Open","open":"Other"},"menu":{"close":"Close"}}', 'synthetic.json');
  assert.deepEqual(result.failures, ['Duplicate key in synthetic.json: menu.open', 'Duplicate key in synthetic.json: menu']);
});
test('rejects invalid message shapes and whitespace-only text', () => {
  assert.equal(readCatalog('{"menu":{"empty":" ","number":4,"nested":{}}}', 'synthetic.json').failures.length, 3);
  assert.equal(readCatalog('{"menu":[]}', 'synthetic.json').failures.length, 1);
  assert.equal(readCatalog('{"menu":{"open":"Open {{name}}"}}', 'synthetic.json').failures.length, 0);
});
test('allows reordered or repeated parameters but detects missing values and broken rich links', () => {
  assert.equal(messageSignature('{{a}} {{ b }}'), messageSignature('{{b}} {{a}}'));
  assert.equal(messageSignature('{{a}} {{a}}'), messageSignature('{{a}}'));
  assert.notEqual(messageSignature('{{a}} {{b}}'), messageSignature('{{a}}'));
  assert.notEqual(messageSignature('<help>Help</help>'), messageSignature('<help>Help'));
  assert.notEqual(messageSignature('<help>Help</help>'), messageSignature('<other>Help</other>'));
});
