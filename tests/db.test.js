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

test('legacy labels migrate only on write and preserve tracker/runtime data and a recovery snapshot', () => {
  const database = makeTempDb();
  const legacy = {
    id: 'char_old',
    name: 'Mira',
    class: 'Fighter',
    race: 'Human',
    background: 'Acolyte',
    level: 3,
    ac: 17,
    hp: { current: 7, max: 24 },
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 8, cha: 10 },
    spellSlots: { 1: { max: 2, current: 1 } },
    attacks: [{ name: 'Longsword', toHit: '+5', damage: '1d8+3' }],
    features: [{ name: 'Second Wind', desc: 'Use a bonus action.' }],
    spells: [{ name: 'Shield', spellId: 'shield', level: 1 }],
    statusEffects: ['poisoned'],
    notes: 'Keep the original notes.',
    tokenColor: '#123456',
  };
  const before = structuredClone(legacy);
  const migrated = database.sanitizeCharacter({ notes: 'Updated notes.' }, legacy);

  assert.equal(migrated.id, 'char_old');
  assert.deepEqual(migrated.build.classes, [{ classId: 'fighter', classLevel: 3, subclassId: null }]);
  assert.equal(migrated.build.speciesId, 'human');
  assert.equal(migrated.build.backgroundId, 'acolyte');
  assert.deepEqual(migrated.build.migration.backup.sourceCharacter, before);
  assert.deepEqual(migrated.hp.toJSON(), legacy.hp);
  assert.deepEqual(migrated.spellSlots[1], { max: 2, current: 1 });
  assert.equal(migrated.attacks[0].name, legacy.attacks[0].name);
  assert.equal(migrated.attacks[0].toHit, legacy.attacks[0].toHit);
  assert.equal(migrated.features[0].name, legacy.features[0].name);
  assert.equal(migrated.spells[0].spellId, legacy.spells[0].spellId);
  assert.deepEqual(migrated.statusEffects, legacy.statusEffects);
  assert.equal(migrated.ac, 17);
  assert.equal(migrated.notes, 'Updated notes.');
  assert.equal(migrated.tokenColor, '#123456');
  assert.deepEqual(legacy, before, 'sanitization/migration must not mutate the stored source object');
});

test('loadDB does not migrate or rewrite legacy character records during reads', () => {
  const database = makeTempDb();
  const legacy = { id: 'char_legacy', name: 'Old', class: 'Wizard', race: 'Human', level: 2 };
  const db = database.loadDB();
  db.users.alice = { username: 'alice', pin: '0', characters: [legacy] };
  database.saveDB(db);
  const before = fs.readFileSync(database.dbPath, 'utf8');

  const loaded = database.loadDB();

  assert.deepEqual(loaded.users.alice.characters[0], legacy);
  assert.equal(fs.readFileSync(database.dbPath, 'utf8'), before);
});

test('old-client partial updates retain an already migrated build and manual overrides', () => {
  const database = makeTempDb();
  const created = database.sanitizeCharacter({
    name: 'Tess', class: 'Wizard', race: 'Human', level: 4,
    build: { overrides: { armorClass: 16 } },
  }, null);
  const updated = database.sanitizeCharacter({ notes: 'Changed by an old client.' }, created);

  assert.equal(updated.build.schemaVersion, 2);
  assert.equal(updated.build.classes[0].classId, 'wizard');
  assert.equal(updated.build.classes[0].classLevel, 4);
  assert.deepEqual(updated.build.overrides, { armorClass: 16 });
  assert.equal(updated.notes, 'Changed by an old client.');
  assert.equal(updated.id, created.id);
});

test('missing local rule catalogs preserve labels and report unresolved migration values', () => {
  const database = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-tracker-test-')), 'db.json'), {
    rulesDatabase: { getManifest() { throw new Error('rules unavailable'); } },
  });
  const character = database.sanitizeCharacter({ class: 'Custom Mage', race: 'Homebrew Folk', level: 2 }, null);

  assert.equal(character.class, 'Custom Mage');
  assert.equal(character.race, 'Homebrew Folk');
  assert.equal(character.build.classes.length, 0);
  assert.equal(character.build.migration.state, 'review');
  assert.ok(character.build.migration.unresolved.some((entry) => entry.field === 'class'));
  assert.ok(character.build.migration.unresolved.some((entry) => entry.field === 'race'));
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
