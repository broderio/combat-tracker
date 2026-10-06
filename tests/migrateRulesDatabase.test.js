import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateDatabase } from '../scripts/migrateRulesDatabase.js';

const fixture = {
  dm: { username: 'dm', pin: '0000' },
  users: {
    player: {
      username: 'Player',
      pin: '1234',
      characters: [{
        id: 'char_test',
        name: 'Test Hero',
        class: 'Fighter',
        race: 'Tiefling',
        level: 3,
        notes: 'keep me',
        spells: [{ name: 'Fireball' }, { name: 'Not a Local Spell' }],
        attacks: [{ name: 'Longsword', damage: '1d8+2' }],
      }],
    },
  },
  encounters: [{
    id: 'enc_test',
    snapshot: { monsterInstances: { moninst_1: { id: 'moninst_1', name: 'Adult Red Dragon', templateId: 'mon_88', hp: { current: 20, max: 20 } } } },
  }],
};

test('migration maps local rule IDs, drops unmatched rules, and preserves mutable data', () => {
  const { database, report } = migrateDatabase(fixture);
  const character = database.users.player.characters[0];
  assert.deepEqual(character.ruleSelections, {
    classId: 'fighter',
    subclassId: null,
    speciesId: 'tiefling',
    backgroundId: null,
    featIds: [],
    ruleset: { edition: '2024', databaseSchemaVersion: 4 },
  });
  assert.deepEqual(character.spells, [{ id: 'fireball' }]);
  assert.equal(character.attacks[0].damage, '1d8+2');
  assert.equal(character.attacks[0].equipmentId, 'longsword');
  assert.equal(character.notes, 'keep me');
  assert.equal(database.users.player.pin, '1234');
  assert.deepEqual(database.ruleData, { formatVersion: 1, edition: '2024', databaseSchemaVersion: 4 });
  assert.equal(database.encounters[0].snapshot.monsterInstances.moninst_1.templateId, 'adult-red-dragon');
  assert.equal(database.encounters[0].snapshot.monsterInstances.moninst_1.hp.current, 20);
  assert.equal(report.spellsKept, 1);
  assert.equal(report.spellsDropped, 1);
  assert.ok(report.dropped.some((entry) => entry.location.endsWith('/spell') && entry.reason === 'unmatched'));
});
