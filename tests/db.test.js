import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Database } from '../server/db.js';
import { localRules } from '../server/localRules.js';

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
    classes: [{ classId: 'unknown-class', classLevel: 4, subclassId: null }],
    speciesId: 'unknown-species',
    backgroundId: 'criminal',
    featIds: ['alert', 'unknown-feat'],
    spellIds: ['fireball', 'unknown-spell'],
    equipment: [{ equipmentId: 'longsword', quantity: 1, equipped: true }, { equipmentId: 'unknown-weapon', quantity: 1, equipped: true }],
    attacks: [{ name: 'copied legacy attack', damage: '1d8' }],
    build: { copied: true },
  }, null);
  assert.deepEqual(character.classes, []);
  assert.equal(character.speciesId, null);
  assert.equal(character.backgroundId, 'criminal');
  assert.deepEqual(character.featIds, ['alert']);
  assert.deepEqual(character.spellIds, ['fireball']);
  assert.deepEqual(character.equipment, [{ equipmentId: 'longsword', quantity: 1, equipped: true }]);
  assert.equal(Object.hasOwn(character, 'attacks'), false);
  assert.equal(Object.hasOwn(character, 'build'), false);
});

test('sanitizeCharacter preserves manual details only for an active local choice', () => {
  const database = makeTempDb();
  const classRecord = localRules.getClass('wizard');
  const choice = classRecord.choices[0];
  const character = database.sanitizeCharacter({
    classes: [{ classId: 'wizard', classLevel: 1, subclassId: null }],
    selections: [{
      choiceId: choice.id,
      selectedOptionIds: [],
      manualValue: 'A manually resolved choice',
      manualConfirmed: true,
    }],
  }, null);
  assert.deepEqual(character.selections, [{
    choiceId: choice.id,
    selectedOptionIds: [],
    manualValue: 'A manually resolved choice',
    manualConfirmed: true,
  }]);
});

test('sanitizeCharacter filters dynamic class spell choices to the local class and spell level', () => {
  const database = makeTempDb();
  const character = database.sanitizeCharacter({
    classes: [{ classId: 'wizard', classLevel: 1, subclassId: null }],
    spellIds: ['magic-missile', 'fireball'],
    selections: [{
      choiceId: 'wizard-spellbook-starting',
      selectedOptionIds: ['magic-missile', 'fireball', 'not-a-local-spell'],
    }],
  }, null);
  assert.deepEqual(character.spellIds, ['magic-missile', 'fireball']);
  assert.deepEqual(character.selections, [{
    choiceId: 'wizard-spellbook-starting',
    selectedOptionIds: ['magic-missile'],
    manualValue: '',
    manualConfirmed: false,
  }]);
});

test('findCharacter returns null for unknown username or character id', () => {
  const database = makeTempDb();
  assert.equal(database.findCharacter('nobody', 'char_1'), null);

  const db = database.loadDB();
  const character = database.sanitizeCharacter({ name: 'Bob Hero' }, null).toJSON();
  character.id = 'char_1';
  db.users['bob'] = { username: 'bob', pin: '0', characters: [character] };
  database.saveDB(db);

  assert.equal(database.findCharacter('bob', 'wrong-id'), null);
  assert.equal(database.findCharacter('BOB', 'char_1').name, 'Bob Hero'); // username lookup is case-insensitive
});

test('loadDB rejects legacy saved Characters without rewriting the database', () => {
  const database = makeTempDb();
  fs.writeFileSync(database.dbPath, JSON.stringify({ users: { bob: { characters: [{ id: 'char_1', name: 'Legacy' }] } }, encounters: [] }));
  const original = fs.readFileSync(database.dbPath, 'utf8');
  assert.throws(() => database.loadDB(), /not schema v6.*migrateRulesDatabase\.js/s);
  assert.equal(fs.readFileSync(database.dbPath, 'utf8'), original);
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
