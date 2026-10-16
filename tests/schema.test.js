import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Validators,
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

test('Character.default produces a character with default ability scores and empty collections', () => {
  const c = Character.default();
  assert.equal(c.name, 'New Character');
  assert.equal(c.schemaVersion, 6);
  assert.equal(c.kind, 'character');
  assert.deepEqual(c.classes, []);
  assert.deepEqual(c.abilityScores, { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
  assert.deepEqual(c.equipment, []);
  assert.deepEqual(c.state.conditions, []);
});

test('Character.fromInput sanitizes text fields and falls back to "Unnamed" when name is blank', () => {
  const c = Character.fromInput({ name: '   ', classes: [{ classId: 'wizard', classLevel: 3, subclassId: null }] }, null);
  assert.equal(c.name, 'Unnamed');
  assert.deepEqual(c.classes, [{ classId: 'wizard', classLevel: 3, subclassId: null }]);
});

test('Character.fromInput clamps class level, ability scores, and hit points', () => {
  const c = Character.fromInput({
    classes: [{ classId: 'wizard', classLevel: 999, subclassId: null }],
    abilityScores: { int: 99 },
    state: { hitPoints: { current: -5, maximum: 99999 } },
  }, null);
  assert.equal(c.classes[0].classLevel, 20);
  assert.equal(c.abilityScores.int, 30);
  assert.deepEqual(c.state.hitPoints, { current: 0, maximum: 9999, temporary: 0 });
});

test('Character.fromInput keeps known conditions and explicitly declared custom conditions', () => {
  const c = Character.fromInput(
    {
      state: {
        conditions: [{ id: 'poisoned' }, { id: 'not-a-real-effect' }, { id: 'custom-blessed' }],
        customConditions: [{ label: 'Blessed', color: '#112233' }],
      },
    },
    null
  );
  assert.deepEqual(c.state.conditions.map(({ id }) => id), ['poisoned', 'custom-blessed']);
  assert.equal(c.state.customConditions.length, 1);
  assert.equal(c.state.customConditions[0].key, 'custom-blessed');
});

test('Character and MonsterInstance sanitize concentration references and turn flags', () => {
  const character = Character.fromInput({ state: {
    concentration: { spellId: 'hex', targetIds: ['target-1', 'moninst_1', 'bad id'] },
    turn: { action: 'no', bonusAction: false, reaction: 0 },
  } }, null);
  assert.deepEqual(character.state.concentration, { spellId: 'hex', targetIds: ['target-1', 'moninst_1'] });
  assert.deepEqual(character.state.turn, { action: true, bonusAction: false, reaction: true });

  const monster = MonsterInstance.fromInput({ state: {
    concentration: { spellId: 'not a spell', targetIds: [] }, turn: { action: false },
  } }, null);
  assert.equal(monster.state.concentration, null);
  assert.deepEqual(monster.state.turn, { action: false, bonusAction: true, reaction: true });
});

test('Character.fromInput retains only stable equipment, feat, and spell references', () => {
  const c = Character.fromInput(
    {
      equipment: [{ equipmentId: 'longsword', quantity: 2, equipped: true }, { equipmentId: 'invalid id' }],
      spellIds: ['fireball', 'invalid id'],
      featIds: ['alert', 'invalid id'],
    },
    null
  );
  assert.deepEqual(c.equipment, [{ equipmentId: 'longsword', quantity: 2, equipped: true }]);
  assert.deepEqual(c.spellIds, ['fireball']);
  assert.deepEqual(c.featIds, ['alert']);
});

test('Character partial updates preserve references and unmodified combat state', () => {
  const c = Character.fromInput({
    classes: [{ classId: 'fighter', classLevel: 5, subclassId: null }],
    speciesId: 'tiefling', backgroundId: 'criminal', featIds: ['alert'], spellIds: ['fireball'],
    state: { hitPoints: { current: 8, maximum: 12, temporary: 2 }, spellSlots: { 3: { expended: 1 } }, conditions: [{ id: 'poisoned' }] },
  }, null);
  const updated = Character.fromInput({ state: { hitPoints: { current: 6 } } }, c);
  assert.deepEqual(updated.classes, c.classes);
  assert.equal(updated.speciesId, 'tiefling');
  assert.deepEqual(updated.spellIds, ['fireball']);
  assert.deepEqual(updated.state.hitPoints, { current: 6, maximum: 12, temporary: 2 });
  assert.deepEqual(updated.state.spellSlots, { 3: { expended: 1 } });
  assert.deepEqual(updated.state.conditions, [{ id: 'poisoned', sourceId: null, duration: null }]);
});

test('Character.condition() reflects current hp state', () => {
  const c = Character.fromInput({ state: { hitPoints: { current: 0, maximum: 10 } } }, null);
  assert.equal(c.condition(), 'dead');
});

test('Character round-trips through toJSON/fromInput without losing data', () => {
  const original = Character.fromInput({
    name: 'Aria', classes: [{ classId: 'rogue', classLevel: 3, subclassId: 'thief' }],
    spellIds: ['fireball'], state: { hitPoints: { current: 7, maximum: 12 }, conditions: [{ id: 'poisoned' }] },
  }, null);
  const json = original.toJSON();
  const clone = Character.clone(json);
  assert.equal(clone.name, 'Aria');
  assert.deepEqual(clone.classes, original.classes);
  assert.deepEqual(clone.state.hitPoints, { current: 7, maximum: 12, temporary: 0 });
  assert.deepEqual(clone.spellIds, ['fireball']);
  assert.deepEqual(clone.state.conditions, [{ id: 'poisoned', sourceId: null, duration: null }]);
  assert.equal(Object.hasOwn(json, 'attacks'), false);
  assert.equal(Object.hasOwn(json, 'ruleSelections'), false);
});

test('Character persists bounded manual choice notes and confirmation state', () => {
  const character = Character.fromInput({
    selections: [{
      choiceId: 'elf-1-elven-lineage-manual',
      selectedOptionIds: [],
      manualValue: 'Chosen lineage, pending source review',
      manualConfirmed: true,
    }],
  }, null);
  assert.deepEqual(character.toJSON().selections, [{
    choiceId: 'elf-1-elven-lineage-manual',
    selectedOptionIds: [],
    manualValue: 'Chosen lineage, pending source review',
    manualConfirmed: true,
  }]);
  const limited = Character.fromInput({
    selections: [{ choiceId: 'elf-1-elven-lineage-manual', selectedOptionIds: [], manualValue: 'x'.repeat(3000) }],
  }, null);
  assert.equal(limited.selections[0].manualValue.length, 2000);
  assert.equal(Object.hasOwn(limited.toJSON().selections[0], 'manualConfirmed'), false);
});

test('MonsterInstance.fromTemplate persists only a stable template reference and mutable state', () => {
  const template = { id: 'goblin', hitPoints: { average: 7 }, proficiencyBonus: 2, abilities: { actions: [
    { feature: { id: 'goblin-net', uses: { maximum: 1, period: 'day' } } },
  ] } };
  const instance = MonsterInstance.fromTemplate(template, 'moninst_1');
  assert.equal(instance.templateId, 'goblin');
  assert.deepEqual(instance.state.hitPoints, { current: 7, maximum: 7, temporary: 0 });
  assert.deepEqual(instance.state.resources, [{ id: 'goblin-net', remaining: 1 }]);
  assert.deepEqual(Object.keys(instance.toJSON()).sort(), ['id', 'kind', 'schemaVersion', 'state', 'templateId']);
});

test('MonsterInstance.fromInput applies partial state updates without changing its template reference', () => {
  const instance = MonsterInstance.fromTemplate({ id: 'orc', hitPoints: { average: 15 } }, 'moninst_2');
  const updated = MonsterInstance.fromInput({ state: { hitPoints: { current: 3 }, conditions: [{ id: 'frightened' }] } }, instance);
  assert.equal(updated.state.hitPoints.current, 3);
  assert.equal(updated.state.hitPoints.maximum, 15);
  assert.equal(updated.templateId, 'orc');
  assert.deepEqual(updated.state.conditions, [{ id: 'frightened', sourceId: null, duration: null }]);
  assert.equal(Object.hasOwn(updated.toJSON(), 'name'), false);
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
