import test from 'node:test';
import assert from 'node:assert/strict';

import { migrateCharacterBuild } from '../shared/characterMigration.js';

const classes = [
  { id: 'wizard', name: 'Wizard' },
  { id: 'fighter', name: 'Fighter' },
];
const species = [{ id: 'human', name: 'Human' }];
const backgrounds = [{ id: 'acolyte', name: 'Acolyte' }, { id: 'sage', name: 'Sage' }];
const catalogs = {
  classCatalog: classes,
  speciesCatalog: species,
  backgroundCatalog: backgrounds,
  edition: '2024',
  databaseSchemaVersion: 4,
};

test('legacy character maps exact unambiguous labels and keeps a recoverable original snapshot', () => {
  const legacy = {
    id: 'char_legacy',
    name: 'Mira',
    class: 'Wizard',
    race: 'Human',
    background: 'Sage',
    level: 5,
    hp: { current: 8, max: 22 },
    abilityScores: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
    spellSlots: { 1: { max: 4, current: 2 } },
    attacks: [{ name: 'Dagger', toHit: '+5' }],
    notes: 'Keep this note.',
  };
  const before = structuredClone(legacy);
  const result = migrateCharacterBuild(legacy, { ...catalogs, sourceRecord: legacy, sourceBuild: null });

  assert.equal(result.migrated, true);
  assert.equal(result.character.build.schemaVersion, 2);
  assert.deepEqual(result.character.build.classes, [{ classId: 'wizard', classLevel: 5, subclassId: null }]);
  assert.equal(result.character.build.speciesId, 'human');
  assert.equal(result.character.build.backgroundId, 'sage');
  assert.equal(result.character.build.abilityScoreMethod, 'manual');
  assert.equal(result.character.build.ruleset.databaseSchemaVersion, 4);
  assert.equal(result.character.build.migration.state, 'complete');
  assert.deepEqual(result.character.build.migration.backup.sourceCharacter, before);
  assert.equal(result.character.hp.max, 22);
  assert.deepEqual(result.character.spellSlots, legacy.spellSlots);
  assert.deepEqual(result.character.attacks, legacy.attacks);
  assert.equal(result.character.notes, legacy.notes);
  assert.deepEqual(legacy, before, 'migration must not mutate the source record');
});

test('partial version-1 build preserves existing choices and overrides while mapping missing fields', () => {
  const record = {
    id: 'char_partial',
    name: 'Rook',
    class: 'Fighter',
    race: 'Human',
    background: 'Acolyte',
    level: 3,
    build: {
      schemaVersion: 1,
      ruleset: { edition: '2024', databaseSchemaVersion: 4 },
      classes: [{ classId: 'fighter', classLevel: 3, subclassId: null }],
      speciesId: 'human',
      selections: [{ choiceId: 'fighter-1-weapon-mastery', selectedOptionIds: ['longsword'] }],
      overrides: { armorClass: 17 },
    },
  };
  const result = migrateCharacterBuild(record, { ...catalogs, sourceRecord: record, sourceBuild: record.build });

  assert.equal(result.character.build.classes[0].classLevel, 3);
  assert.equal(result.character.build.speciesId, 'human');
  assert.equal(result.character.build.backgroundId, 'acolyte');
  assert.deepEqual(result.character.build.selections[0].selectedOptionIds, ['longsword']);
  assert.deepEqual(result.character.build.overrides, { armorClass: 17 });
  assert.deepEqual(result.character.build.migration.backup.sourceBuild, record.build);
  assert.equal(result.character.build.migration.state, 'complete');
});

test('ambiguous, unknown, and unavailable legacy labels remain visible for review', () => {
  const ambiguousRecord = { class: 'Sage', race: 'Unknown Folk', level: 2, build: { schemaVersion: 1, classes: [] } };
  const result = migrateCharacterBuild(ambiguousRecord, {
    ...catalogs,
    classCatalog: [{ id: 'sage-class-a', name: 'Sage' }, { id: 'sage-class-b', name: 'Sage' }],
    speciesCatalog: species,
    sourceRecord: ambiguousRecord,
    sourceBuild: ambiguousRecord.build,
  });

  assert.equal(result.character.class, 'Sage');
  assert.equal(result.character.race, 'Unknown Folk');
  assert.deepEqual(result.character.build.classes, []);
  assert.equal(result.character.build.migration.state, 'review');
  assert.deepEqual(result.character.build.migration.unresolved.find((entry) => entry.field === 'class').candidateIds, ['sage-class-a', 'sage-class-b']);
  assert.match(result.character.build.migration.unresolved.find((entry) => entry.field === 'race').reason, /No exact/);

  const unavailable = migrateCharacterBuild({ class: 'Wizard', race: 'Human', level: 1 }, {});
  assert.equal(unavailable.character.class, 'Wizard');
  assert.equal(unavailable.character.build.migration.state, 'review');
  assert.ok(unavailable.unresolved.length >= 2);
});

test('valid but unknown saved IDs are preserved and reported, not discarded', () => {
  const record = {
    class: 'Retired Class',
    level: 4,
    build: {
      schemaVersion: 1,
      classes: [{ classId: 'retired-class', classLevel: 4, subclassId: 'old-path' }],
      speciesId: 'lost-species',
    },
  };
  const result = migrateCharacterBuild(record, { ...catalogs, sourceRecord: record, sourceBuild: record.build });

  assert.equal(result.character.build.classes[0].classId, 'retired-class');
  assert.equal(result.character.build.classes[0].subclassId, 'old-path');
  assert.equal(result.character.build.speciesId, 'lost-species');
  assert.ok(result.unresolved.some((entry) => entry.field === 'classes[0].classId'));
  assert.ok(result.unresolved.some((entry) => entry.field === 'classes[0].subclassId'));
  assert.ok(result.unresolved.some((entry) => entry.field === 'speciesId'));
});

test('already migrated records are idempotent', () => {
  const old = { name: 'Mira', class: 'Wizard', race: 'Human', level: 2 };
  const migrated = migrateCharacterBuild(old, { ...catalogs, sourceRecord: old, sourceBuild: null }).character;
  const second = migrateCharacterBuild(migrated, { ...catalogs, sourceRecord: old, sourceBuild: null });

  assert.equal(second.migrated, false);
  assert.deepEqual(second.character, migrated);
});
