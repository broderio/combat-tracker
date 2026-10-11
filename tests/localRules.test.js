import test from 'node:test';
import assert from 'node:assert/strict';

import { localRules } from '../server/localRules.js';
import { CharacterOptionsLibrary } from '../server/characterOptions.js';
import { monsterLibrary } from '../server/monsterLibrary.js';

const options = new CharacterOptionsLibrary();

test('local rules expose a manifest, bounded catalog search, and stable spell records', () => {
  assert.equal(localRules.manifest.edition, '2024');
  const results = options.searchSpells({ name: 'fireball', limit: 5 });
  assert.ok(results.some((spell) => spell.id === 'fireball'));
  assert.equal(localRules.getRecordById('spells', 'fireball').feature.description.includes('8d6'), true);
  assert.equal(options.searchSpells({ name: 'not-a-local-spell' }).length, 0);
});

test('local class, species, background, feat, and equipment options return IDs', () => {
  assert.equal(options.searchClasses({ name: 'fighter' })[0].id, 'fighter');
  assert.equal(options.searchRaces({ name: 'tiefling' })[0].id, 'tiefling');
  assert.equal(options.searchBackgrounds({ name: 'criminal' })[0].id, 'criminal');
  assert.equal(options.searchFeats({ name: 'alert' })[0].id, 'alert');
  assert.ok(options.searchWeapons({ name: 'longsword' })[0].id);
});

test('local monster templates use stable catalog IDs and normalized stat fields', () => {
  const [summary] = localRules.getCatalog('monsters').filter((entry) => entry.id === 'adult-red-dragon');
  assert.equal(summary.name, 'Adult Red Dragon');
  assert.equal(Number.isFinite(summary.armorClass), true);
  assert.equal(Number.isFinite(summary.hitPoints), true);
  const template = monsterLibrary.getTemplate('adult-red-dragon');
  assert.equal(template.id, 'adult-red-dragon');
  assert.equal(template.hitPoints.average, 256);
  assert.ok(template.abilities.actions.some(({ name }) => name === 'Rend'));
  const spellcasting = template.abilities.actions.find(({ name }) => name === 'Spellcasting')?.feature.spellcasting;
  assert.ok(spellcasting.spellsByFrequency.some(({ spellIds }) => spellIds.includes('scorching-ray')));
});
