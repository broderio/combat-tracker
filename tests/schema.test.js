import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Validators,
  HitPoints,
  Character,
  MonsterInstance,
  Grid,
  Token,
  Overlay,
  TurnOrder,
  Encounter,
  computeCondition,
  getOverlayMeta,
  STATUS_EFFECTS,
} from '../shared/schema.js';

test('Validators.clampInt clamps values within [min, max]', () => {
  assert.equal(Validators.clampInt(5, 0, 10, 0), 5);
  assert.equal(Validators.clampInt(-5, 0, 10, 0), 0);
  assert.equal(Validators.clampInt(50, 0, 10, 0), 10);
});

test('Validators.clampInt falls back when value is not a number', () => {
  assert.equal(Validators.clampInt('abc', 0, 10, 7), 7);
  assert.equal(Validators.clampInt(undefined, 0, 10, 7), 7);
});

test('computeCondition reports healthy/hurt/critical/dead based on hp ratio', () => {
  assert.equal(computeCondition({ current: 10, max: 10 }), 'healthy');
  assert.equal(computeCondition({ current: 5, max: 10 }), 'hurt');
  assert.equal(computeCondition({ current: 2, max: 10 }), 'critical');
  assert.equal(computeCondition({ current: 0, max: 10 }), 'dead');
  assert.equal(computeCondition({ current: -3, max: 10 }), 'dead');
});

test('computeCondition treats missing/zero-max hp as healthy', () => {
  assert.equal(computeCondition(null), 'healthy');
  assert.equal(computeCondition({ current: 0, max: 0 }), 'healthy');
});

test('HitPoints.fromInput clamps current/max and preserves existing values when absent', () => {
  const existing = new HitPoints(8, 10);
  const updated = HitPoints.fromInput({ current: 99999 }, existing);
  assert.equal(updated.current, 9999); // clamped to HP_FIELDS max
  assert.equal(updated.max, 10); // unspecified field kept from existing
});

test('HitPoints.default returns schema default current/max', () => {
  const hp = HitPoints.default();
  assert.equal(hp.current, 10);
  assert.equal(hp.max, 10);
});

test('Character.default produces a character with default ability scores and empty collections', () => {
  const c = Character.default();
  assert.equal(c.name, 'New Character');
  assert.equal(c.level, 1);
  assert.deepEqual(c.abilityScores, { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
  assert.deepEqual(c.attacks, []);
  assert.deepEqual(c.statusEffects, []);
  assert.equal(c.build.schemaVersion, 2);
  assert.equal(c.build.ruleset.edition, '2024');
  assert.equal(c.build.migration.version, 0);
  assert.equal(c.background, '');
});

test('Character.fromInput sanitizes builder IDs while preserving explicit class-level allocations', () => {
  const c = Character.fromInput({
    build: {
      speciesId: 'human',
      backgroundId: '../invalid',
      abilityScoreMethod: 'point-buy',
      classes: [
        { classId: 'fighter', classLevel: 12, subclassId: 'champion' },
        { classId: 'wizard', classLevel: 12 },
        { classId: '../bad', classLevel: 1 },
      ],
      selections: [{ choiceId: 'fighter.skill', selectedOptionIds: ['athletics', 'athletics', '../bad'] }],
      spells: [
        { spellId: 'fireball', status: 'prepared', sourceClassId: 'wizard' },
        { spellId: '../invalid', status: 'unknown', sourceClassId: 'wizard' },
      ],
      inventory: [{ equipmentId: 'longsword', quantity: 4, equipped: true }],
      proficiencies: { skills: ['athletics', 'athletics', '../bad'] },
      roleplay: { ideals: 'Protect the town', unexpectedField: 'drop me' },
      overrides: { armorClass: 99, hidden: 10 },
    },
  }, null);

  assert.equal(c.build.speciesId, 'human');
  assert.equal(c.build.backgroundId, null);
  assert.equal(c.build.abilityScoreMethod, 'point-buy');
  assert.deepEqual(c.build.classes, [
    { classId: 'fighter', classLevel: 12, subclassId: 'champion' },
    { classId: 'wizard', classLevel: 12, subclassId: null },
    { classId: null, classLevel: 1, subclassId: null },
  ]);
  assert.ok(c.build.migration.unresolved.some((entry) => entry.field === 'backgroundId'));
  assert.ok(c.build.migration.unresolved.some((entry) => entry.field === 'classes[2].classId'));
  assert.deepEqual(c.build.selections[0].selectedOptionIds, ['athletics']);
  assert.deepEqual(c.build.spells, [{ spellId: 'fireball', status: 'prepared', sourceClassId: 'wizard' }]);
  assert.deepEqual(c.build.proficiencies.skills, ['athletics']);
  assert.equal(c.build.inventory[0].quantity, 4);
  assert.equal(c.build.roleplay.ideals, 'Protect the town');
  assert.equal(c.build.roleplay.unexpectedField, undefined);
  assert.deepEqual(c.build.overrides, { armorClass: 40 });
});

test('Character legacy saves migrate to builder defaults and partial builder edits preserve other selections', () => {
  const legacy = Character.fromInput({ name: 'Mira', class: 'Fighter', race: 'Human' }, null).toJSON();
  delete legacy.build;
  const migrated = Character.clone(legacy);
  assert.equal(migrated.build.schemaVersion, 2);
  assert.equal(migrated.build.speciesId, null);

  migrated.build = Character.fromInput({ build: {
    speciesId: 'human',
    classes: [{ classId: 'fighter', classLevel: 3, subclassId: 'champion' }],
    proficiencies: { skills: ['athletics'] },
  } }, migrated).build;
  const updated = Character.fromInput({ build: { backgroundId: 'acolyte' } }, migrated);
  assert.equal(updated.build.speciesId, 'human');
  assert.equal(updated.build.backgroundId, 'acolyte');
  assert.equal(updated.build.classes[0].subclassId, 'champion');
  assert.deepEqual(updated.build.proficiencies.skills, ['athletics']);
});

test('Character.fromInput preserves manual choice text and confirmation in build selections', () => {
  const character = Character.fromInput({
    build: {
      selections: [{
        choiceId: 'fighter-3-maneuvers',
        selectedOptionIds: ['trip-attack'],
        manualValue: 'Confirmed manually from the feature text.',
        manualConfirmed: true,
      }],
      proficiencies: { savingThrows: ['str', 'con'] },
    },
  }, null);

  assert.deepEqual(character.build.selections, [{
    choiceId: 'fighter-3-maneuvers',
    selectedOptionIds: ['trip-attack'],
    manualValue: 'Confirmed manually from the feature text.',
    manualConfirmed: true,
  }]);
  assert.deepEqual(character.build.proficiencies.savingThrows, ['str', 'con']);
});

test('older partial build payloads cannot downgrade migration version or erase backup/review data', () => {
  const originalBuild = {
    schemaVersion: 1,
    migration: {
      version: 1,
      state: 'review',
      backup: {
        sourceBuild: { schemaVersion: 1, classes: [] },
        sourceCharacter: { name: 'Legacy' },
        legacy: { class: 'Unknown', race: '', background: '', level: 1 },
      },
      unresolved: [{ field: 'class', value: 'Unknown', reason: 'No exact match.', candidateIds: [] }],
    },
  };
  const existing = Character.fromInput({ build: originalBuild }, null);
  const updated = Character.fromInput({ build: {
    schemaVersion: 2,
    migration: { version: 0, state: 'pending', backup: null, unresolved: [] },
  } }, existing);

  assert.equal(updated.build.migration.version, 1);
  assert.equal(updated.build.migration.state, 'review');
  assert.deepEqual(updated.build.migration.backup.sourceCharacter, { name: 'Legacy' });
  assert.ok(updated.build.migration.unresolved.some((entry) => entry.value === 'Unknown'));
});

test('Character.fromInput sanitizes text fields and falls back to "Unnamed" when name is blank', () => {
  const c = Character.fromInput({ name: '   ', class: 'Wizard' }, null);
  assert.equal(c.name, 'Unnamed');
  assert.equal(c.class, 'Wizard');
});

test('Character.fromInput clamps level and ac to schema-defined ranges', () => {
  const c = Character.fromInput({ level: 999, ac: -5 }, null);
  assert.equal(c.level, 20);
  assert.equal(c.ac, 0);
});

test('Character.fromInput keeps only known status effects and respects custom status effect cap', () => {
  const c = Character.fromInput(
    {
      statusEffects: ['poisoned', 'not-a-real-effect'],
      customStatusEffects: [{ label: 'Blessed', color: '#112233' }],
    },
    null
  );
  assert.ok(c.statusEffects.includes('poisoned'));
  assert.ok(!c.statusEffects.includes('not-a-real-effect'));
  assert.equal(c.customStatusEffects.length, 1);
  assert.equal(c.customStatusEffects[0].key, 'custom-blessed');
});

test('Character.fromInput drops attacks/features/spells with no name', () => {
  const c = Character.fromInput(
    {
      attacks: [{ name: 'Longsword', damage: '1d8' }, { name: '' }, {}],
      spells: [{ name: 'Fireball', level: 3 }],
    },
    null
  );
  assert.equal(c.attacks.length, 1);
  assert.equal(c.attacks[0].name, 'Longsword');
  assert.equal(c.spells[0].level, 3);
});

test('Character preserves stable local weapon and spell references while keeping manual entries valid', () => {
  const c = Character.fromInput({
    attacks: [
      { name: 'Mace', equipmentId: 'mace', damage: '1d6 Bludgeoning' },
      { name: 'Unlinked attack', equipmentId: '../invalid' },
    ],
    spells: [
      { name: 'Fireball', spellId: 'fireball', level: 3, school: 'Evocation' },
      { name: 'Manual spell', level: 1 },
    ],
  }, null);

  assert.equal(c.attacks[0].equipmentId, 'mace');
  assert.equal(c.attacks[1].equipmentId, null);
  assert.equal(c.spells[0].spellId, 'fireball');
  assert.equal(c.spells[1].spellId, null);
  assert.equal(Character.clone(c.toJSON()).spells[0].spellId, 'fireball');
});

test('Character.condition() reflects current hp state', () => {
  const c = Character.fromInput({ hp: { current: 0, max: 10 } }, null);
  assert.equal(c.condition(), 'dead');
});

test('Character round-trips through toJSON/fromInput without losing data', () => {
  const original = Character.fromInput({ name: 'Aria', class: 'Rogue', hp: { current: 7, max: 12 } }, null);
  const json = original.toJSON();
  const clone = Character.clone(json);
  assert.equal(clone.name, 'Aria');
  assert.equal(clone.hp.current, 7);
  assert.notEqual(clone.hp, original.hp); // independent copy, not shared reference
});

test('MonsterInstance.fromTemplate seeds hp at full from template hpMax', () => {
  const template = { id: 'tmpl_1', name: 'Goblin', hpMax: 7 };
  const instance = MonsterInstance.fromTemplate(template);
  assert.equal(instance.templateId, 'tmpl_1');
  assert.equal(instance.hp.current, 7);
  assert.equal(instance.hp.max, 7);
});

test('MonsterInstance.fromInput applies partial hp updates without touching other fields', () => {
  const instance = MonsterInstance.fromTemplate({ id: 't', name: 'Orc', hpMax: 15 });
  const updated = MonsterInstance.fromInput({ hp: { current: 3 } }, instance);
  assert.equal(updated.hp.current, 3);
  assert.equal(updated.hp.max, 15);
  assert.equal(updated.name, 'Orc');
});

test('STATUS_EFFECTS registry exposes icon/background/color for every builtin effect', () => {
  for (const [key, visual] of Object.entries(STATUS_EFFECTS)) {
    assert.ok(visual.icon, `${key} missing icon`);
    assert.ok(visual.color, `${key} missing color`);
  }
});

test('Grid.fromInput clamps cols/rows/cellSize and preserves unspecified fields', () => {
  const grid = Grid.fromInput({ cols: 1000 }, Grid.default());
  assert.equal(grid.cols, 100);
  assert.equal(grid.rows, 15); // default preserved
});

test('Token.fromInput clamps position to the given grid bounds', () => {
  const grid = Grid.fromInput({ cols: 5, rows: 5 }, Grid.default());
  const token = Token.fromInput({ name: 'Hero', col: 999, row: 999 }, grid);
  assert.equal(token.col, 4);
  assert.equal(token.row, 4);
});

test('Overlay.fromInput rejects unknown overlay types and falls back to generic default', () => {
  const overlay = Overlay.fromInput({ type: 'not-a-real-type' }, Grid.default());
  assert.equal(overlay.type, 'generic');
});

test('Overlay.fromInput accepts a known overlay type', () => {
  const overlay = Overlay.fromInput({ type: 'fire' }, Grid.default());
  assert.equal(overlay.type, 'fire');
});

test('TurnOrder.fromEntries sorts combatants by initiative descending, breaking ties by input order', () => {
  const tokens = { a: {}, b: {}, c: {} };
  const order = TurnOrder.fromEntries(
    [
      { tokenId: 'a', initiative: 10 },
      { tokenId: 'b', initiative: 15 },
      { tokenId: 'c', initiative: 15 },
    ],
    tokens
  );
  assert.deepEqual(
    order.combatants.map((c) => c.tokenId),
    ['b', 'c', 'a']
  );
  assert.equal(order.currentIndex, 0);
  assert.equal(order.round, 1);
});

test('TurnOrder.fromEntries filters out entries whose tokenId no longer exists', () => {
  const order = TurnOrder.fromEntries([{ tokenId: 'missing', initiative: 5 }], {});
  assert.deepEqual(order.combatants, []);
  assert.equal(order.currentIndex, -1);
});

test('TurnOrder.advance wraps around to the first combatant and increments round', () => {
  const order = TurnOrder.fromEntries(
    [
      { tokenId: 'a', initiative: 10 },
      { tokenId: 'b', initiative: 5 },
    ],
    { a: {}, b: {} }
  );
  order.advance(); // -> b
  order.advance(); // wraps -> a, round 2
  assert.equal(order.currentCombatantTokenId(), 'a');
  assert.equal(order.round, 2);
});

test('TurnOrder.removeCombatant resets to empty state when last combatant is removed', () => {
  const order = TurnOrder.fromEntries([{ tokenId: 'a', initiative: 1 }], { a: {} });
  order.removeCombatant('a');
  assert.equal(order.currentCombatantTokenId(), null);
  assert.equal(order.round, 0);
});

test('Encounter.fromInput falls back to "Unnamed Encounter" for blank names', () => {
  const enc = Encounter.fromInput({ name: '   ' }, null);
  assert.equal(enc.name, 'Unnamed Encounter');
});

test('getOverlayMeta returns the matching overlay type\'s label/color', () => {
  const meta = getOverlayMeta('fire');
  assert.equal(meta.label, 'Fire');
  assert.ok(meta.color);
});

test('getOverlayMeta falls back to the generic type for an unknown or missing type', () => {
  assert.equal(getOverlayMeta('not-a-real-type').label, 'Generic');
  assert.equal(getOverlayMeta(undefined).label, 'Generic');
});
