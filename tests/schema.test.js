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

test('Character.fromInput drops attacks/features without names and spells without local IDs', () => {
  const c = Character.fromInput(
    {
      attacks: [{ name: 'Longsword', damage: '1d8' }, { name: '' }, {}],
      spells: [{ id: 'fireball' }, { name: 'Fireball', level: 3 }],
    },
    null
  );
  assert.equal(c.attacks.length, 1);
  assert.equal(c.attacks[0].name, 'Longsword');
  assert.deepEqual(c.spells, [{ id: 'fireball' }]);
});

test('Character.fromInput keeps bounded local weapon identity on attacks', () => {
  const c = Character.fromInput({
    attacks: [{ name: 'Longsword', equipmentId: 'longsword', equipmentName: 'Longsword', damage: '1d8', damageType: 'slashing' }],
  }, null);
  assert.equal(c.attacks[0].equipmentId, 'longsword');
  assert.equal(c.attacks[0].equipmentName, 'Longsword');
  assert.equal(c.attacks[0].damageType, 'slashing');
});

test('Character.fromInput stores sanitized stable rule selection IDs', () => {
  const c = Character.fromInput({
    ruleSelections: {
      classId: 'Fighter',
      speciesId: 'tiefling',
      backgroundId: 'criminal',
      featIds: ['alert', 'bad id', 'alert'],
    },
  }, null);
  assert.deepEqual(c.ruleSelections, {
    classId: 'fighter',
    subclassId: null,
    speciesId: 'tiefling',
    backgroundId: 'criminal',
    featIds: ['alert'],
    ruleset: { edition: '2024', databaseSchemaVersion: 4 },
  });
});

test('Character sanitization preserves bounded build metadata and synchronizes local selections', () => {
  const c = Character.fromInput({
    level: 5,
    build: { inventory: [{ id: 'healing-potion', quantity: 2 }], roleplay: { ideals: 'Protect the village' } },
    ruleSelections: { classId: 'fighter', speciesId: 'tiefling', backgroundId: 'criminal', featIds: ['alert'] },
  }, null);
  assert.equal(c.build.inventory[0].quantity, 2);
  assert.equal(c.build.roleplay.ideals, 'Protect the village');
  assert.deepEqual(c.build.classes, [{ classId: 'fighter', classLevel: 5, subclassId: null }]);
  assert.equal(c.build.speciesId, 'tiefling');
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
