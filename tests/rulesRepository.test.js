import test from 'node:test';
import assert from 'node:assert/strict';

import { RulesRepository } from '../public/js/rulesRepository.js';

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('rules repository lazily loads and caches the manifest, catalog, and detail records', async () => {
  const records = {
    '/rules/index.json': {
      schemaVersion: 4,
      edition: '2024',
      classes: [{ id: 'fighter', path: 'classes/fighter/class.json', subclasses: [{ id: 'champion', path: 'classes/fighter/champion.json' }] }],
      catalogs: { species: { path: 'species/index.json' } },
    },
    '/rules/species/index.json': { items: [{ id: 'human', name: 'Human', path: 'species/human.json' }] },
    '/rules/species/human.json': { id: 'human', name: 'Human', sources: [{ publication: 'Player Handbook' }] },
    '/rules/classes/fighter/class.json': { id: 'fighter', name: 'Fighter' },
    '/rules/classes/fighter/champion.json': { id: 'champion', name: 'Champion' },
  };
  const fetched = [];
  const repository = new RulesRepository({
    baseUrl: 'http://localhost/rules/',
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      fetched.push(pathname);
      return records[pathname] ? response(records[pathname]) : response({}, false, 404);
    },
  });

  const [human, catalog, classRecord, subclass] = await Promise.all([
    repository.getCatalogRecord('species', 'human'),
    repository.getCatalog('species'),
    repository.getClass('fighter'),
    repository.getSubclass('fighter', 'champion'),
  ]);
  assert.equal(human.name, 'Human');
  assert.equal(catalog.items.length, 1);
  assert.equal(classRecord.name, 'Fighter');
  assert.equal(subclass.name, 'Champion');
  assert.equal(fetched.filter((path) => path === '/rules/index.json').length, 1);
  assert.equal(fetched.filter((path) => path === '/rules/species/human.json').length, 1);
  assert.equal(await repository.getCatalogRecord('species', 'missing'), null);
});

test('rules repository filters catalog summaries without loading detail records', async () => {
  const repository = new RulesRepository({
    baseUrl: 'http://localhost/rules/',
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/rules/index.json') return response({ schemaVersion: 4, classes: [], catalogs: { feats: { path: 'feats/index.json' } } });
      if (pathname === '/rules/feats/index.json') {
        return response({ items: [
          { id: 'alert', name: 'Alert', path: 'feats/alert.json' },
          { id: 'actor', name: 'Actor', path: 'feats/actor.json' },
        ] });
      }
      throw new Error(`Unexpected detail fetch: ${pathname}`);
    },
  });

  assert.deepEqual(await repository.searchCatalog('feats', 'act'), [
    { id: 'actor', name: 'Actor', path: 'feats/actor.json' },
  ]);
});

test('rules repository finds a generated full-caster progression for multiclass slots', async () => {
  const records = {
    '/rules/index.json': {
      schemaVersion: 4,
      edition: '2024',
      classes: [
        { id: 'barbarian', name: 'Barbarian', path: 'classes/barbarian.json' },
        { id: 'wizard', name: 'Wizard', path: 'classes/wizard.json' },
      ],
    },
    '/rules/classes/barbarian.json': { id: 'barbarian', spellcasting: null },
    '/rules/classes/wizard.json': {
      id: 'wizard',
      name: 'Wizard',
      sources: [{ publication: 'Player’s Handbook' }],
      spellcasting: { type: 'full', slotsByLevel: { 4: { 1: 4, 2: 3 } } },
    },
  };
  const fetched = [];
  const repository = new RulesRepository({
    baseUrl: 'http://localhost/rules/',
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      fetched.push(pathname);
      return records[pathname] ? response(records[pathname]) : response({}, false, 404);
    },
  });

  const table = await repository.getMulticlassSpellSlotTable();
  const cached = await repository.getMulticlassSpellSlotTable();
  assert.equal(table.classId, 'wizard');
  assert.deepEqual(table.slotsByLevel[4], { 1: 4, 2: 3 });
  assert.equal(table.sources[0].publication, 'Player’s Handbook');
  assert.equal(cached, table);
  assert.equal(fetched.filter((path) => path === '/rules/index.json').length, 1);
});

test('rules repository audits every builder-facing class, subclass, and catalog record for handoff', async () => {
  const records = {
    '/rules/index.json': {
      schemaVersion: 4,
      edition: '2024',
      classes: [{
        id: 'fighter', name: 'Fighter', path: 'classes/fighter/class.json',
        subclasses: [{ id: 'battle-master', name: 'Battle Master', path: 'classes/fighter/battle-master.json' }],
      }],
      catalogs: {
        species: { path: 'species/index.json' },
        backgrounds: { path: 'backgrounds/index.json' },
        feats: { path: 'feats/index.json' },
        spells: { path: 'spells/index.json' },
        equipment: { path: 'equipment/index.json' },
      },
    },
    '/rules/classes/fighter/class.json': {
      kind: 'class', id: 'fighter', name: 'Fighter', sources: [{ publication: 'Player’s Handbook' }],
      featuresByLevel: { 1: [{ name: 'Fighting Style', description: 'Choose a fighting style feat.' }] },
      choices: [{
        id: 'fighter-fighting-style', level: 1, feature: 'Fighting Style',
        prompt: 'Choose a feat.', selection: { count: 1 }, options: [],
        optionSource: { type: 'future-list' },
      }],
    },
    '/rules/classes/fighter/battle-master.json': {
      kind: 'subclass', id: 'battle-master', classId: 'fighter', name: 'Battle Master', choices: [],
    },
    '/rules/species/index.json': { items: [{ id: 'human', name: 'Human', path: 'species/human.json' }] },
    '/rules/backgrounds/index.json': { items: [{ id: 'acolyte', name: 'Acolyte', path: 'backgrounds/acolyte.json' }] },
    '/rules/feats/index.json': { items: [{ id: 'alert', name: 'Alert', path: 'feats/alert.json' }] },
    '/rules/spells/index.json': { items: [{ id: 'shield', name: 'Shield', path: 'spells/shield.json' }] },
    '/rules/equipment/index.json': { items: [{ id: 'longsword', name: 'Longsword', path: 'equipment/longsword.json' }] },
    '/rules/species/human.json': {
      kind: 'species', id: 'human', name: 'Human', traits: [{ id: 'skillful', name: 'Skillful', description: 'Choose one skill of your choice.' }],
    },
    '/rules/backgrounds/acolyte.json': {
      kind: 'background', id: 'acolyte', name: 'Acolyte', abilityScores: [{ id: 'wis', name: 'Wisdom' }],
      equipment: { raw: 'Choose A or B', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    },
    '/rules/feats/alert.json': { kind: 'feat', id: 'alert', name: 'Alert', description: 'A clear benefit.', prerequisites: null },
    '/rules/spells/shield.json': { kind: 'spell', id: 'shield', name: 'Shield', level: 1, classes: ['wizard'] },
    '/rules/equipment/longsword.json': { kind: 'equipment', id: 'longsword', name: 'Longsword', category: 'weapon' },
  };
  const fetched = [];
  const repository = new RulesRepository({
    baseUrl: 'http://localhost/rules/',
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      fetched.push(pathname);
      return records[pathname] ? response(records[pathname]) : response({}, false, 404);
    },
  });

  const audit = await repository.auditResolutionCoverage({ concurrency: 3 });

  assert.equal(audit.format, 'dnd-tracker-rules-resolution-audit');
  assert.ok(audit.items.some((item) => item.choiceId === 'fighter-fighting-style' && item.issueCode === 'unsupported-option-resolver'));
  assert.ok(audit.items.some((item) => item.choiceId === 'adapter:human:trait:skillful'));
  assert.ok(audit.items.some((item) => item.choiceId === 'adapter:acolyte:ability-scores'));
  assert.ok(fetched.includes('/rules/classes/fighter/battle-master.json'));
  assert.ok(fetched.includes('/rules/equipment/longsword.json'));
});

test('rules repository refuses absolute and traversal paths', async () => {
  let fetchCount = 0;
  const repository = new RulesRepository({
    baseUrl: 'http://localhost/rules/',
    fetchImpl: async () => { fetchCount += 1; return response({}); },
  });

  await assert.rejects(repository.getRecord('../secret.json'), /rules database/);
  await assert.rejects(repository.getRecord('/secret.json'), /rules database/);
  await assert.rejects(repository.getRecord('%2e%2e/secret.json'), /rules database/);
  assert.equal(fetchCount, 0);
});

test('rules repository can read species and background records from the generated local database', async () => {
  const rulesRoot = new URL('../5e_rules/rules/', import.meta.url);
  const repository = new RulesRepository({
    baseUrl: 'http://local.test/rules/',
    fetchImpl: async (url) => {
      const relativePath = new URL(url).pathname.replace('/rules/', '');
      const fileUrl = new URL(relativePath, rulesRoot);
      try {
        const data = await import('node:fs/promises').then(({ readFile }) => readFile(fileUrl, 'utf8'));
        return response(JSON.parse(data));
      } catch {
        return response({}, false, 404);
      }
    },
  });

  const [species, backgrounds, human, acolyte] = await Promise.all([
    repository.getCatalog('species'),
    repository.getCatalog('backgrounds'),
    repository.getCatalogRecord('species', 'human'),
    repository.getCatalogRecord('backgrounds', 'acolyte'),
  ]);
  assert.ok(species.items.length > 0);
  assert.ok(backgrounds.items.length > 0);
  assert.equal(human.id, 'human');
  assert.equal(acolyte.id, 'acolyte');
  assert.ok(Array.isArray(human.sources));
  assert.ok(Array.isArray(acolyte.sources));
});
