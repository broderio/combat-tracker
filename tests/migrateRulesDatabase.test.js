import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDatabase, writeMigratedDatabase } from '../scripts/migrateRulesDatabase.js';

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
        state: {
          conditions: [{ id: 'poisoned', sourceId: 'moninst_1', duration: { rounds: 2 } }, { id: 'custom-bless', sourceId: null, duration: null }],
          customConditions: [{ key: 'custom-bless', label: 'Bless', color: '#123456' }],
          concentration: { spellId: 'hex', targetIds: ['moninst_1'] },
        },
      }],
    },
  },
  encounters: [{
    id: 'enc_test',
    snapshot: { monsterInstances: { moninst_1: {
      id: 'moninst_1', name: 'Adult Red Dragon', templateId: 'mon_88', hp: { current: 20, max: 20 },
      state: { conditions: [{ id: 'frightened', sourceId: 'char_1', duration: { turns: 1 } }] },
      customStatusEffects: [{ key: 'custom-marked', label: 'Marked', color: '#654321' }],
    } } },
  }],
};

test('v5 importer writes reference-only v6 Characters and MonsterInstances with a resolution report', () => {
  const original = structuredClone(fixture);
  const { database, report } = migrateDatabase(fixture);
  const character = database.users.player.characters[0];
  assert.equal(character.schemaVersion, 6);
  assert.equal(character.kind, 'character');
  assert.deepEqual(character.classes, [{ classId: 'fighter', classLevel: 3, subclassId: null }]);
  assert.equal(character.speciesId, 'tiefling');
  assert.deepEqual(character.spellIds, ['fireball']);
  assert.deepEqual(character.equipment, [{ equipmentId: 'longsword', quantity: 1, equipped: true }]);
  assert.equal(character.notes, 'keep me');
  assert.deepEqual(character.state.hitPoints, { current: 10, maximum: 10, temporary: 0 });
  assert.deepEqual(character.state.conditions, [
    { id: 'poisoned', sourceId: 'moninst_1', duration: { rounds: 2 } },
    { id: 'custom-bless', sourceId: null, duration: null },
  ]);
  assert.deepEqual(character.state.customConditions, [{ key: 'custom-bless', label: 'Bless', color: '#123456' }]);
  assert.deepEqual(character.state.concentration, { spellId: 'hex', targetIds: ['moninst_1'] });
  for (const field of ['class', 'race', 'level', 'attacks', 'spells', 'ruleSelections', 'build', 'hp', 'ac']) {
    assert.equal(Object.hasOwn(character, field), false, `legacy field ${field} remains`);
  }
  assert.equal(database.users.player.pin, '1234');
  assert.equal(Object.hasOwn(database, 'ruleData'), false);
  const instance = database.encounters[0].snapshot.monsterInstances.moninst_1;
  assert.equal(instance.schemaVersion, 6);
  assert.equal(instance.kind, 'monster-instance');
  assert.equal(instance.templateId, 'adult-red-dragon');
  assert.deepEqual(instance.state.hitPoints, { current: 20, maximum: 20, temporary: 0 });
  assert.deepEqual(instance.state.conditions, [{ id: 'frightened', sourceId: 'char_1', duration: { turns: 1 } }]);
  assert.deepEqual(instance.state.customConditions, [{ key: 'custom-marked', label: 'Marked', color: '#654321' }]);
  assert.equal(Object.hasOwn(instance, 'name'), false);
  assert.equal(Object.hasOwn(instance, 'hp'), false);
  assert.equal(report.spellsKept, 1);
  assert.equal(report.spellsDropped, 1);
  assert.ok(report.unresolved.some((entry) => entry.location.endsWith('/spells/1') && entry.reason === 'unmatched'));
  assert.deepEqual(fixture, original);
  assert.deepEqual(migrateDatabase(database).database, database);
});

test('migration write refuses unresolved data unless explicitly acknowledged and then backs up atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-v6-migration-'));
  const dbPath = path.join(dir, 'db.json');
  const reportPath = path.join(dir, 'migration-report.json');
  const originalText = JSON.stringify(fixture, null, 2);
  fs.writeFileSync(dbPath, originalText);
  const { database, report } = migrateDatabase(fixture);

  assert.throws(() => writeMigratedDatabase({ dbPath, reportPath, database, report }), /Refusing migration write/);
  assert.equal(fs.readFileSync(dbPath, 'utf8'), originalText);
  assert.equal(fs.existsSync(reportPath), false);

  const backupPath = writeMigratedDatabase({ dbPath, reportPath, database, report, allowLoss: true });
  assert.equal(fs.readFileSync(backupPath, 'utf8'), originalText);
  assert.deepEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')), database);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), report);
});

test('approved reference map resolves selected templates and retains unmatched attacks as manual data', () => {
  const source = structuredClone(fixture);
  source.users.player.characters[0].spells = [{ name: 'Fireball' }];
  source.users.player.characters[0].attacks = [
    { name: 'Shortsword +1', toHit: '+5', damage: '1d6+3', damageType: 'piercing', desc: 'Magic bonus' },
    { name: 'Crossbow', toHit: '+4', damage: '1d8+2', damageType: 'piercing', desc: 'Unspecified model' },
  ];
  source.encounters[0].snapshot.monsterInstances = {
    ...source.encounters[0].snapshot.monsterInstances,
    moninst_2: { id: 'moninst_2', name: 'Acolyte', hp: { current: 5, max: 11 } },
    moninst_3: { id: 'moninst_3', name: 'Sahuagin', hp: { current: 12, max: 22 } },
  };
  const referenceMap = {
    monsters: { Acolyte: 'priest-acolyte', Sahuagin: 'sahuagin-warrior' },
    weapons: { 'Shortsword +1': 'shortsword' },
  };

  const { database, report } = migrateDatabase(source, undefined, referenceMap);
  const character = database.users.player.characters[0];
  assert.deepEqual(character.equipment, [{ equipmentId: 'shortsword', quantity: 1, equipped: true }]);
  assert.match(character.customFeatures.find(({ name }) => name === 'Shortsword +1').description, /Magic bonus/);
  assert.match(character.customFeatures.find(({ name }) => name === 'Crossbow').description, /Unspecified model/);
  assert.deepEqual(report.unresolved, []);
  assert.deepEqual(report.ambiguous, []);
  assert.deepEqual(report.orphaned, []);
  assert.equal(report.appliedMappings.length, 3);
  assert.equal(report.retainedManualAttacks.length, 2);
  assert.equal(database.encounters[0].snapshot.monsterInstances.moninst_2.templateId, 'priest-acolyte');
  assert.equal(database.encounters[0].snapshot.monsterInstances.moninst_3.templateId, 'sahuagin-warrior');
});
