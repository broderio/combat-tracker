import test from 'node:test';
import assert from 'node:assert/strict';

import { createRulesResolutionAudit } from '../shared/rulesResolutionAudit.js';

const wizard = {
  schemaVersion: 3,
  kind: 'class',
  id: 'wizard',
  name: 'Wizard',
  sources: [{ id: 'phb', publication: 'Player’s Handbook', url: 'https://example.test/wizard' }],
  spellcasting: {
    ability: 'int',
    cantripsKnownByLevel: { 1: 3 },
    preparedSpellsByLevel: { 1: 4 },
    slotsByLevel: { 1: { 1: 2 } },
  },
  progression: { 1: { values: {} } },
  startingEquipment: {
    raw: 'Choose A or B: (A) 2 Daggers and 5 GP; or (B) 55 GP',
    options: [
      { id: 'A', label: 'A', raw: '2 Daggers and 5 GP', items: [{ name: 'Dagger', quantity: 2 }], gold: 5 },
      { id: 'B', label: 'B', raw: '55 GP', items: [], gold: 55 },
    ],
  },
  featuresByLevel: {
    1: [{ name: 'Spellcasting', description: 'Choose three cantrips of your choice. The spellbook starts with six spells of your choice.' }],
  },
  choices: [
    {
      id: 'wizard-1-spellcasting-cantrips', level: 1, feature: 'Spellcasting',
      prompt: 'Know three Wizard cantrips of your choice.',
      selection: { count: null, countRule: 'progression.cantripsKnownByLevel' },
      optionSource: { type: 'spell-list', id: 'wizard', spellKind: 'cantrip' }, options: [],
    },
    {
      id: 'wizard-spellbook-starting', level: 1, feature: 'Spellcasting',
      prompt: 'Choose six level 1 Wizard spells for your starting spellbook.',
      selection: { count: 6, countRule: null },
      optionSource: { type: 'spell-list', id: 'wizard', spellKind: 'spell', spellLevel: 1 }, options: [],
    },
    {
      id: 'wizard-level-eligible', level: 1, feature: 'Spellcasting',
      prompt: 'Choose Wizard spells for which you have spell slots.',
      selection: { count: 1, countRule: null },
      optionSource: { type: 'spell-list', id: 'wizard', spellKind: 'spell', eligibility: 'spell-level-unlocked-at-class-level' }, options: [],
    },
    {
      id: 'wizard-prepared-list', level: 1, feature: 'Spellcasting',
      prompt: 'Choose prepared spells from the Wizard list.',
      selection: { count: 1, countRule: null },
      optionSource: { type: 'spell-list', id: 'wizard', spellKind: 'spell' }, options: [],
    },
    {
      id: 'wizard-prepared-spells', level: 1, feature: 'Spellcasting',
      prompt: 'Prepare spells from your spellbook after each Long Rest.',
      selection: { count: null, countRule: 'max(1, abilityModifier(int) + classLevel(wizard))' },
      optionSource: { type: 'character-spellbook', id: 'wizard-spellbook', spellKind: 'spell' }, options: [],
    },
    {
      id: 'wizard-starting-equipment', level: 1, feature: 'Starting Equipment',
      prompt: 'Choose one starting equipment option.',
      selection: { count: 1, countRule: null },
      options: [
        { id: 'A', label: 'A' },
        { id: 'B', label: 'B' },
      ],
      optionSource: null,
    },
    {
      id: 'wizard-unsupported', level: 1, feature: 'Arcane feature', prompt: 'Choose an option.',
      selection: { count: 1, countRule: null }, optionSource: { type: 'future-option-list' }, options: [],
    },
    {
      id: 'wizard-runtime-choice', level: 1, feature: 'Runtime choice', prompt: 'Choose an in-play option.',
      scope: 'runtime', selection: { count: 1, countRule: null },
      options: [{ id: 'runtime-option', label: 'Runtime option' }], optionSource: null,
    },
    {
      id: 'wizard-skills', level: 1, feature: 'Proficiencies', prompt: 'Choose two skills.',
      selection: { count: 2, countRule: null }, optionSource: { type: 'skill-list' }, options: [],
    },
    {
      id: 'wizard-manual', level: 1, feature: 'Replicate Magic Item', prompt: 'Choose a plan.',
      selection: { count: null, countRule: null }, optionSource: null, options: [],
      resolution: 'partial', unresolvedReason: 'Plan list is not normalized.',
    },
  ],
};
const human = {
  schemaVersion: 1,
  kind: 'species',
  id: 'human',
  name: 'Human',
  sources: [{ publication: 'Player’s Handbook' }],
  traits: [{ id: 'skillful', name: 'Skillful', description: 'You gain proficiency in one skill of your choice.' }],
};
const alertFeat = {
  kind: 'feat', id: 'alert', name: 'Alert',
  prerequisites: 'Level 4+, a qualifying ability score.',
  abilityScorePrerequisites: [{ ability: 'dex', minimum: 13 }],
  sources: [{ publication: 'Player’s Handbook' }],
};

function byChoice(report, choiceId) {
  return report.items.filter((entry) => entry.choiceId === choiceId);
}

test('resolution audit inventories manual, unsupported, and unavailable generated choices', () => {
  const report = createRulesResolutionAudit([
    { record: wizard, recordType: 'class', path: 'classes/wizard/class.json' },
    { record: human, recordType: 'species', path: 'species/human.json' },
    { record: alertFeat, recordType: 'feats', path: 'feats/alert.json' },
  ], {
    edition: '2024',
    databaseSchemaVersion: 4,
    catalogs: {
      spells: [
        { id: 'light', name: 'Light', level: 0, classes: ['wizard'] },
        { id: 'shield', name: 'Shield', level: 1, classes: ['wizard'] },
      ],
      feats: [],
      equipment: [],
      skills: [],
    },
  });

  assert.equal(report.format, 'dnd-tracker-rules-resolution-audit');
  assert.equal(report.edition, '2024');
  assert.ok(byChoice(report, 'wizard-unsupported').some((entry) => entry.issueCode === 'unsupported-option-resolver'));
  assert.ok(byChoice(report, 'wizard-skills').some((entry) => entry.issueCode === 'resolver-empty'));
  assert.ok(byChoice(report, 'wizard-manual').some((entry) => entry.issueCode === 'manual-or-partial-choice'));
  const equipmentGap = byChoice(report, 'wizard-starting-equipment').find((entry) => entry.issueCode === 'option-details-unparsed');
  assert.ok(equipmentGap);
  assert.match(equipmentGap.fullText, /2 Daggers/);
  assert.equal(equipmentGap.options.length, 2);
  assert.ok(report.items.some((entry) => entry.choiceId === 'adapter:human:trait:skillful' && entry.issueCode === 'manual-adapter-choice'));
  assert.ok(report.items.some((item) => item.recordId === 'alert' && item.issueCode === 'feat-prerequisite-validation-incomplete'));
  assert.ok(report.items.some((item) => item.choiceId === 'wizard-runtime-choice' && item.scope === 'runtime' && item.issueCode === 'runtime-choice-review'));
  assert.ok(report.items.some((item) => item.choiceId === 'wizard-prepared-list' && item.issueCode === 'spell-level-eligibility-not-explicit'));
  assert.equal(report.items.some((item) => item.choiceId === 'wizard-level-eligible' && item.issueCode === 'spell-level-eligibility-not-explicit'), false);
  const wizardProse = report.items.find((item) => item.issueCode === 'possible-prose-choice' && item.recordId === 'wizard');
  assert.ok(wizardProse, 'choice-like prose remains a generator coverage-check candidate even when some choices are structured');
  assert.ok(wizardProse.relatedChoiceIds.includes('wizard-spellbook-starting'));
  assert.ok(wizardProse.fullText.includes('spellbook starts with six spells'));
});

test('audit does not mistake a selected-build dependency for a generator gap and links prose candidates to generated IDs', () => {
  const report = createRulesResolutionAudit([
    { record: wizard, recordType: 'class', path: 'classes/wizard/class.json' },
  ], {
    catalogs: {
      spells: [
        { id: 'light', name: 'Light', level: 0, classes: ['wizard'] },
        { id: 'shield', name: 'Shield', level: 1, classes: ['wizard'] },
      ],
      feats: [],
      equipment: [],
    },
  });

  assert.equal(byChoice(report, 'wizard-prepared-spells').some((entry) => entry.issueCode === 'resolver-empty'), false);
  const prose = report.items.find((entry) => entry.issueCode === 'possible-prose-choice');
  assert.equal(prose.sourceField, 'featuresByLevel.1.0');
  assert.ok(prose.relatedChoiceIds.includes('wizard-1-spellcasting-cantrips'));
  assert.ok(prose.fullText.includes('spellbook starts with six spells'));
  assert.ok(prose.sources.some((source) => source.publication === 'Player’s Handbook'));
});

test('resolution audit distinguishes a missing catalog from a resolved empty list', () => {
  const missingCatalog = createRulesResolutionAudit([
    { record: wizard, recordType: 'class', path: 'classes/wizard/class.json' },
  ], { catalogs: { spells: [], feats: [], equipment: [] } });
  const emptyCatalog = createRulesResolutionAudit([
    { record: wizard, recordType: 'class', path: 'classes/wizard/class.json' },
  ], { catalogs: { spells: [], feats: [], equipment: [], skills: [] } });

  assert.ok(byChoice(missingCatalog, 'wizard-skills').some((entry) => entry.issueCode === 'catalog-unavailable'));
  assert.ok(byChoice(emptyCatalog, 'wizard-skills').some((entry) => entry.issueCode === 'resolver-empty'));
});

test('audit reports missing detail records and emits stable record/field references', () => {
  const report = createRulesResolutionAudit([], {
    failures: [{ recordType: 'feats', recordId: 'alert', recordName: 'Alert', path: 'feats/alert.json', error: '404' }],
  });

  assert.equal(report.items[0].auditId, 'feats:alert:record-detail:record-detail-unavailable');
  assert.equal(report.items[0].recordPath, 'feats/alert.json');
  assert.match(report.items[0].reason, /404/);
});
