import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Database } from '../server/db.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-tracker-test-'));
  return new Database(path.join(dir, 'db.json'));
}

test('loadDB creates a fresh db with empty users/encounters and default dm on first load', () => {
  const database = makeTempDb();
  const db = database.loadDB();
  assert.deepEqual(db.users, {});
  assert.deepEqual(db.encounters, []);
  assert.equal(db.dm.username, 'dm');
});

test('saveDB + loadDB round-trips user data to disk', () => {
  const database = makeTempDb();
  const db = database.loadDB();
  db.users['alice'] = { username: 'alice', pin: '1234', characters: [] };
  database.saveDB(db);

  const reloaded = database.loadDB();
  assert.equal(reloaded.users['alice'].pin, '1234');
});

test('sanitizeCharacter assigns a new id for brand-new characters and keeps existing id on edit', () => {
  const database = makeTempDb();
  const created = database.sanitizeCharacter({ name: 'Finn' }, null);
  assert.ok(created.id);

  const edited = database.sanitizeCharacter({ name: 'Finn Updated' }, created);
  assert.equal(edited.id, created.id);
  assert.equal(edited.name, 'Finn Updated');
});

test('sanitizeCharacter enforces local rules as the authority for linked selections', () => {
  const database = makeTempDb();
  const character = database.sanitizeCharacter({
    class: 'Unlisted Class',
    race: 'Unlisted Species',
    ruleSelections: {
      classId: 'unknown-class',
      speciesId: 'unknown-species',
      backgroundId: 'criminal',
      featIds: ['alert', 'unknown-feat'],
    },
    spells: [{ id: 'fireball' }, { id: 'unknown-spell' }],
  }, null);
  assert.equal(character.class, '');
  assert.equal(character.race, '');
  assert.equal(character.ruleSelections.classId, null);
  assert.equal(character.ruleSelections.backgroundId, 'criminal');
  assert.deepEqual(character.ruleSelections.featIds, ['alert']);
  assert.deepEqual(character.spells, [{ id: 'fireball' }]);
});

test('findCharacter returns null for unknown username or character id', () => {
  const database = makeTempDb();
  assert.equal(database.findCharacter('nobody', 'char_1'), null);

  const db = database.loadDB();
  db.users['bob'] = { username: 'bob', pin: '0', characters: [{ id: 'char_1', name: 'Bob Hero' }] };
  database.saveDB(db);

  assert.equal(database.findCharacter('bob', 'wrong-id'), null);
  assert.equal(database.findCharacter('BOB', 'char_1').name, 'Bob Hero'); // username lookup is case-insensitive
});

test('createEncounter/getEncounter/updateEncounter/deleteEncounter manage the encounters list', () => {
  const database = makeTempDb();
  const created = database.createEncounter({ name: 'Goblin Ambush', snapshot: { grid: {} } });
  assert.ok(created.id);
  assert.equal(database.getEncounters().length, 1);

  const fetched = database.getEncounter(created.id);
  assert.equal(fetched.name, 'Goblin Ambush');

  const updated = database.updateEncounter(created.id, { name: 'Renamed' });
  assert.equal(updated.name, 'Renamed');

  database.deleteEncounter(created.id);
  assert.equal(database.getEncounters().length, 0);
});

test('updateEncounter returns null for an unknown id', () => {
  const database = makeTempDb();
  assert.equal(database.updateEncounter('missing-id', { name: 'x' }), null);
});
