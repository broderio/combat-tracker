import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAverageMaximumHitPoints, calculateCharacterDerivedValues, composeClassSelections, deriveWeaponAttack } from '../shared/characterBuild.js';
import {
  collectChoiceBackedReferences,
  collectSelectedChoiceEffects,
  validateChoiceSelectionCount,
} from '../shared/characterBuilder.js';

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

test('average maximum HP uses maximum hit die at level one and fixed averages afterward', () => {
  const result = calculateAverageMaximumHitPoints([
    { classId: 'fighter', classLevel: 3 },
    { classId: 'rogue', classLevel: 2 },
  ], { fighter: 10, rogue: 8 }, 14);
  assert.equal(result.status, 'calculated');
  assert.equal(result.maximum, 42);
  assert.deepEqual(result.breakdown.map(({ subtotal }) => subtotal), [12, 16, 14]);
});

test('average maximum HP applies the minimum gain and rejects incomplete Hit Die data', () => {
  const minimum = calculateAverageMaximumHitPoints([{ classId: 'wizard', classLevel: 2 }], { wizard: 6 }, 1);
  assert.equal(minimum.maximum, 2);
  assert.equal(calculateAverageMaximumHitPoints([{ classId: 'wizard', classLevel: 2 }], {}, 10).status, 'unknown');
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

test('selected class-feature choices add only valid catalog references to character lists', () => {
  const choiceEntries = [
    {
      choice: { id: 'wizard-cantrips', optionSource: { type: 'spell-list' } },
      resolvedOptions: [{ id: 'fire-bolt' }, { id: 'light' }],
    },
    {
      choice: { id: 'fighter-weapon', optionSource: { type: 'weapon-list' } },
      resolvedOptions: [{ id: 'longsword' }],
    },
    {
      choice: { id: 'fighter-feat', optionSource: { type: 'feat-list' } },
      resolvedOptions: [{ id: 'alert' }],
    },
  ];
  const references = collectChoiceBackedReferences(choiceEntries, [
    { choiceId: 'wizard-cantrips', selectedOptionIds: ['light', 'fire-bolt', 'missing'] },
    { choiceId: 'fighter-weapon', selectedOptionIds: ['longsword'] },
    { choiceId: 'fighter-feat', selectedOptionIds: ['alert'] },
  ]);
  assert.deepEqual(references, {
    spellIds: ['light', 'fire-bolt'],
    featIds: ['alert'],
    equipmentIds: ['longsword'],
  });
});

test('choice count validation supports fixed and progression-resolved counts', () => {
  const choice = { selection: { count: null, min: 1, max: 3, distinct: true } };
  assert.deepEqual(validateChoiceSelectionCount(choice, ['arcana'], 2), {
    valid: false,
    errors: ['Choose at least 2 options.'],
    min: 2,
    max: 2,
  });
  assert.equal(validateChoiceSelectionCount(choice, ['arcana', 'history'], 2).valid, true);
  assert.equal(validateChoiceSelectionCount(choice, ['arcana', 'arcana'], 2).valid, false);
});

test('only selected effects from structured choices are applied automatically', () => {
  const entries = [
    {
      choice: { id: 'background-ability', resolution: 'structured' },
      resolved: { state: 'options' },
      resolvedOptions: [{ id: 'wisdom-plus-two', effects: [{ type: 'ability-score-increase', ability: 'wis', amount: 2, maximum: 20 }] }],
    },
    {
      choice: { id: 'species-manual', resolution: 'manual' },
      resolved: { state: 'manual' },
      resolvedOptions: [{ id: 'manual-option', effects: [{ type: 'ability-score-increase', ability: 'int', amount: 1, maximum: 20 }] }],
    },
  ];
  assert.deepEqual(collectSelectedChoiceEffects(entries, [
    { choiceId: 'background-ability', selectedOptionIds: ['wisdom-plus-two'] },
    { choiceId: 'species-manual', selectedOptionIds: ['manual-option'] },
  ]), [{
    choiceId: 'background-ability',
    optionId: 'wisdom-plus-two',
    effect: { type: 'ability-score-increase', ability: 'wis', amount: 2, maximum: 20 },
  }]);
});
