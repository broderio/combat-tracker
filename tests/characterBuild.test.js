import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCharacterDerivedValues, composeClassSelections, deriveWeaponAttack } from '../shared/characterBuild.js';

test('changing the primary class preserves the former primary and other multiclass levels', () => {
  const classes = composeClassSelections(
    { classId: 'wizard', classLevel: 4, subclassId: null },
    [{ classId: 'rogue', classLevel: 2, subclassId: 'thief' }],
    [
      { classId: 'fighter', classLevel: 5, subclassId: 'champion' },
      { classId: 'rogue', classLevel: 2, subclassId: 'thief' },
    ],
  );
  assert.deepEqual(classes, [
    { classId: 'wizard', classLevel: 4, subclassId: null },
    { classId: 'rogue', classLevel: 2, subclassId: 'thief' },
    { classId: 'fighter', classLevel: 5, subclassId: 'champion' },
  ]);
});

test('promoting an existing secondary class does not duplicate it', () => {
  const classes = composeClassSelections(
    { classId: 'rogue', classLevel: 2, subclassId: 'thief' },
    [{ classId: 'rogue', classLevel: 2, subclassId: 'thief' }],
    [
      { classId: 'fighter', classLevel: 5, subclassId: 'champion' },
      { classId: 'rogue', classLevel: 2, subclassId: 'thief' },
    ],
  );
  assert.deepEqual(classes, [
    { classId: 'rogue', classLevel: 2, subclassId: 'thief' },
    { classId: 'fighter', classLevel: 5, subclassId: 'champion' },
  ]);
});

test('additional class selections are de-duplicated and bounded to valid levels', () => {
  const classes = composeClassSelections(
    { classId: 'wizard', classLevel: 21, subclassId: null },
    [
      { classId: 'rogue', classLevel: 2, subclassId: null },
      { classId: 'rogue', classLevel: 3, subclassId: null },
      { classId: 'bad', classLevel: 0, subclassId: null },
    ],
    [],
  );
  assert.deepEqual(classes, [{ classId: 'rogue', classLevel: 2, subclassId: null }]);
});

test('weapon attacks derive ability, proficiency, and damage from canonical records without persistence', () => {
  const character = {
    classes: [{ classId: 'fighter', classLevel: 5 }],
    abilityScores: { str: 14, dex: 18 },
  };
  const weapon = {
    id: 'shortsword', name: 'Shortsword', category: 'weapon', subcategory: 'Martial Weapons', weaponType: 'melee',
    damage: { dice: { count: 1, sides: 6 }, flat: 0, damageType: 'piercing' },
    weaponProperties: [{ id: 'finesse' }],
  };
  const attack = deriveWeaponAttack(character, weapon, [{ proficiencies: { weapons: { categories: ['martial'] } } }]);
  assert.deepEqual(attack, {
    name: 'Shortsword', equipmentId: 'shortsword', toHit: '+7', damage: '1d6+4', damageType: 'piercing', attackType: 'melee',
  });
  assert.equal(deriveWeaponAttack(character, weapon, [] ).toHit, '+4');
  assert.equal(deriveWeaponAttack(character, { ...weapon, category: 'adventuring-gear' }), null);
});

test('spell slots derive from a single class progression', () => {
  const wizard = {
    classRecord: {
      spellcasting: { type: 'full', slotsByLevel: { 3: { 1: 4, 2: 2 } } },
    },
  };
  const result = calculateCharacterDerivedValues({
    build: { classes: [{ classId: 'wizard', classLevel: 3 }] },
    classRecords: new Map([['wizard', wizard]]),
  });
  assert.deepEqual(result.spellSlots, { status: 'calculated', byLevel: { 1: 4, 2: 2 } });
});

test('multiclass spell slots use effective caster levels and the canonical table', () => {
  const result = calculateCharacterDerivedValues({
    build: { classes: [
      { classId: 'wizard', classLevel: 4 },
      { classId: 'paladin', classLevel: 4 },
    ] },
    classRecords: new Map([
      ['wizard', { classRecord: { spellcasting: { type: 'full' } } }],
      ['paladin', { classRecord: { spellcasting: { type: 'half' } } }],
    ]),
    multiclassSlotTable: { slotsByLevel: { 6: { 1: 4, 2: 3, 3: 3 } } },
  });
  assert.deepEqual(result.spellSlots, { status: 'calculated', byLevel: { 1: 4, 2: 3, 3: 3 } });
});

test('subclass spell slots are read from its generated progression table', () => {
  const rogue = {
    classRecord: { spellcasting: null },
    subclassRecord: {
      featuresByLevel: {
        3: [{
          tables: [{
            headers: ['Rogue Level', 'Prepared Spells', '1st', '2nd'],
            rows: [['3', '3', '2', '-'], ['4', '4', '3', '-']],
          }],
        }],
      },
    },
  };
  const result = calculateCharacterDerivedValues({
    build: { classes: [{ classId: 'rogue', classLevel: 4, subclassId: 'arcane-trickster' }] },
    classRecords: new Map([['rogue', rogue]]),
  });
  assert.deepEqual(result.spellSlots, { status: 'calculated', byLevel: { 1: 3 } });
});

test('Pact Magic slots remain calculated independently and mixed pools are not guessed', () => {
  const classRecords = new Map([
    ['warlock', { classRecord: { spellcasting: { type: 'pact', pactSlotsByLevel: { 3: { slots: 2, slotLevel: 2 } } } } }],
    ['wizard', { classRecord: { spellcasting: { type: 'full', slotsByLevel: {} } } }],
  ]);
  assert.deepEqual(calculateCharacterDerivedValues({
    build: { classes: [{ classId: 'warlock', classLevel: 3 }] }, classRecords,
  }).spellSlots, { status: 'calculated', byLevel: { 2: 2 } });
  assert.equal(calculateCharacterDerivedValues({
    build: { classes: [{ classId: 'warlock', classLevel: 3 }, { classId: 'wizard', classLevel: 1 }] },
    classRecords,
  }).spellSlots.status, 'unsupported');
});
