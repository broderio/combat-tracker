import test from 'node:test';
import assert from 'node:assert/strict';

import { monsterLibrary } from '../server/monsterLibrary.js';

test('search with no filters returns results capped at the default limit', () => {
  const results = monsterLibrary.search({});
  assert.ok(results.length > 0);
  assert.ok(results.length <= 50);
});

test('search by name only returns monsters whose name includes the needle (case-insensitive)', () => {
  const results = monsterLibrary.search({ name: 'goblin' });
  assert.ok(results.length > 0);
  for (const m of results) {
    assert.ok(m.name.toLowerCase().includes('goblin'));
  }
});

test('search respects an explicit limit', () => {
  const results = monsterLibrary.search({ limit: 3 });
  assert.ok(results.length <= 3);
});

test('search by crMin/crMax filters out monsters outside the CR range', () => {
  const results = monsterLibrary.search({ crMin: 5, crMax: 5, limit: 200 });
  for (const m of results) {
    assert.equal(m.challengeRating, 5);
  }
});

test('getTemplate returns the full template for a known id and null for an unknown id', () => {
  const [sample] = monsterLibrary.search({ limit: 1 });
  assert.ok(sample);
  const template = monsterLibrary.getTemplate(sample.id);
  assert.equal(template.id, sample.id);
  assert.equal(template.kind, 'monster');
  assert.ok(template.abilities);
  assert.equal(Object.hasOwn(template, 'attacks'), false);
  assert.equal(monsterLibrary.getTemplate('not-a-real-id'), null);
});
