import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateAbilityModifier,
  calculateCharacterDerivedValues,
  calculatePointBuyCost,
  calculateProficiencyBonus,
  enrichChoiceOptions,
  getManualRecordChoiceAdapters,
  getLevelGatedChoices,
  getSubclassUnlockLevel,
  getCharacterFeatures,
  resolveChoiceOptions,
  resolveChoiceSelectionCount,
  setBuildManualChoice,
  setBuildSelection,
  setBuildSpell,
  setBuildSubclass,
  sortChoiceEntriesByLevel,
  validateAbilityScores,
  validateBuildLevelAllocation,
} from '../shared/characterBuilder.js';

test('getCharacterFeatures combines class and subclass features through the chosen level', () => {
  const features = getCharacterFeatures({
    featuresByLevel: {
      1: [{ name: 'First', description: 'Class level one' }],
      3: [{ name: 'Third', description: 'Class level three' }],
    },
  }, {
    featuresByLevel: { 2: [{ name: 'Archetype', description: 'Subclass level two' }] },
  }, 2);

  assert.deepEqual(features.map(({ name, level, source }) => ({ name, level, source })), [
    { name: 'First', level: 1, source: 'class' },
    { name: 'Archetype', level: 2, source: 'subclass' },
  ]);
});

test('resolveChoiceOptions filters spell and fighting-style options from local catalogs', () => {
  const catalogs = {
    spells: [
      { id: 'spark', name: 'Spark', level: 0, classes: [{ id: 'wizard' }] },
      { id: 'fireball', name: 'Fireball', level: 3, classes: [{ id: 'wizard' }] },
      { id: 'heal', name: 'Heal', level: 1, classes: [{ id: 'cleric' }] },
    ],
    feats: [
      { id: 'defense', name: 'Defense', category: 'Fighting Style Feats' },
      { id: 'alert', name: 'Alert', category: 'Origin Feats' },
    ],
  };

  assert.deepEqual(resolveChoiceOptions({ optionSource: { type: 'spell-list', id: 'class-spell-list', spellKind: 'cantrip' } }, {
    catalogs,
    classId: 'wizard',
  }).items.map((item) => item.id), ['spark']);
  assert.deepEqual(resolveChoiceOptions({ feature: 'Fighting Style', optionSource: { type: 'feat-list' } }, { catalogs }).items.map((item) => item.id), ['defense']);
});

test('spell choice resolution uses class-level slot progression to hide later-level spells', () => {
  const result = resolveChoiceOptions({
    optionSource: { type: 'spell-list', id: 'wizard', spellKind: 'spell', eligibility: 'spell-level-unlocked-at-class-level' },
  }, {
    catalogs: { spells: [
      { id: 'shield', name: 'Shield', level: 1, classes: ['wizard'] },
      { id: 'fireball', name: 'Fireball', level: 3, classes: ['wizard'] },
    ] },
    classId: 'wizard',
    classLevel: 1,
    classRecord: { spellcasting: { slotsByLevel: { 1: { 1: 2 } } } },
  });

  assert.equal(result.state, 'options');
  assert.deepEqual(result.items.map((spell) => spell.id), ['shield']);
});

test('feat lists hide explicitly later-level records but leave other prerequisites manual', () => {
  const result = resolveChoiceOptions({
    optionSource: { type: 'feat-list', eligibility: 'character-and-rule-prerequisites' },
  }, {
    catalogs: { feats: [
      { id: 'alert', name: 'Alert', minimumCharacterLevel: null, prerequisites: 'See source text' },
      { id: 'epic-boon', name: 'Epic Boon', minimumCharacterLevel: 19 },
    ] },
    characterLevel: 5,
  });

  assert.equal(result.state, 'manual');
  assert.deepEqual(result.items.map((feat) => feat.id), ['alert']);
  assert.match(result.reason, /not fully validated/);
});

test('choice resolution distinguishes manual, unavailable, no-options, and unsupported states', () => {
  const manual = resolveChoiceOptions({ id: 'manual-choice', feature: 'Maneuvers', options: [], optionSource: null });
  const unavailable = resolveChoiceOptions({ optionSource: { type: 'skill-list' } }, { catalogs: {} });
  const noOptions = resolveChoiceOptions({ resolution: 'none', noOptions: true });
  const unsupported = resolveChoiceOptions({ optionSource: { type: 'future-list' } });
  const invalidInlineIds = resolveChoiceOptions({
    options: [{ name: 'No stable ID' }],
    selection: { count: 1 },
  });
  const partial = resolveChoiceOptions({
    resolution: 'partial',
    optionSource: { type: 'feat-list', eligibility: 'character-and-rule-prerequisites' },
  }, { catalogs: { feats: [{ id: 'alert', name: 'Alert' }] } });

  assert.equal(manual.state, 'manual');
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(noOptions.state, 'none');
  assert.equal(unsupported.state, 'unsupported');
  assert.equal(invalidInlineIds.state, 'manual');
  assert.match(invalidInlineIds.reason, /stable local IDs/);
  assert.equal(partial.state, 'manual');
  assert.deepEqual(partial.items.map((item) => item.id), ['alert']);
});

test('level-gated choices use class level and exclude later/runtime records', () => {
  const record = {
    id: 'wizard',
    name: 'Wizard',
    choices: [
      { id: 'wizard-1-cantrips', level: 1, scope: 'progression' },
      { id: 'wizard-3-spells', level: 3, scope: 'progression' },
      { id: 'wizard-5-spells', level: 5, scope: 'progression' },
      { id: 'total-level-4-choice', level: 4, levelContext: 'character-level', scope: 'progression' },
      { id: 'wizard-runtime', level: 1, scope: 'runtime' },
      { id: 'unlevelled-choice', scope: 'progression' },
    ],
  };

  assert.deepEqual(getLevelGatedChoices(record, 3).map((choice) => choice.id), ['wizard-1-cantrips', 'wizard-3-spells']);
  assert.deepEqual(getLevelGatedChoices(record, 3, { characterLevel: 5 }).map((choice) => choice.id), ['wizard-1-cantrips', 'wizard-3-spells', 'total-level-4-choice']);
  assert.deepEqual(getLevelGatedChoices(record, 20).map((choice) => choice.id), ['wizard-1-cantrips', 'wizard-3-spells', 'wizard-5-spells', 'total-level-4-choice']);
  assert.equal(getSubclassUnlockLevel({ featuresByLevel: {
    3: [{ name: 'Arcane Tradition', description: 'Choose a Wizard subclass.' }],
    6: [{ name: 'Subclass Feature', description: 'Gain your subclass feature.' }],
  } }), 3);
});

test('level-first choice ordering is deterministic for class, subclass, and manual entries', () => {
  const entries = sortChoiceEntriesByLevel([
    { choice: { id: 'later', level: 4, prompt: 'Later' }, classIndex: 0, recordOrder: 0 },
    { choice: { id: 'subclass', level: 3, prompt: 'Subclass' }, classIndex: 0, recordOrder: 1 },
    { choice: { id: 'class-z', level: 1, feature: 'Spellcasting', prompt: 'Prepare spells' }, classIndex: 0, recordOrder: 0 },
    { choice: { id: 'class-a', level: 1, feature: 'Spellcasting', prompt: 'Know cantrips' }, classIndex: 0, recordOrder: 0 },
    { choice: { id: 'other-class', level: 1, prompt: 'Skills' }, classIndex: 1, recordOrder: 0 },
  ]);

  assert.deepEqual(entries.map((entry) => entry.choice.id), ['class-a', 'class-z', 'other-class', 'subclass', 'later']);
});

test('generated progression count rules resolve cantrips and ability-based prepared spell counts', () => {
  const classRecord = {
    id: 'wizard',
    spellcasting: {
      cantripsKnownByLevel: { 1: 3 },
    },
  };
  assert.deepEqual(resolveChoiceSelectionCount({ selection: { count: null, countRule: 'progression.cantripsKnownByLevel' } }, {
    classRecord, classLevel: 1, classId: 'wizard',
  }), { count: 3, resolved: true, reason: null });
  assert.deepEqual(resolveChoiceSelectionCount({ selection: { count: null, countRule: 'max(1, abilityModifier(int) + classLevel(wizard))' } }, {
    classRecord, classLevel: 3, classId: 'wizard', abilityScores: { int: 16 },
  }), { count: 6, resolved: true, reason: null });
});

test('spellbook choices resolve against earlier selected IDs and honor per-class-level gates', () => {
  const classRecord = {
    id: 'wizard',
    choices: [
      { id: 'wizard-spellbook-starting', level: 1 },
      { id: 'wizard-2-spellbook-spells', level: 2 },
      { id: 'wizard-prepared-spells', level: 1 },
    ],
  };
  const choice = { id: 'wizard-prepared-spells', optionSource: { type: 'character-spellbook', id: 'wizard-spellbook', spellKind: 'spell' } };
  const catalogs = { spells: [
    { id: 'shield', name: 'Shield', level: 1 },
    { id: 'misty-step', name: 'Misty Step', level: 2 },
  ] };
  const selections = [
    { choiceId: 'wizard-spellbook-starting', selectedOptionIds: ['shield'] },
    { choiceId: 'wizard-2-spellbook-spells', selectedOptionIds: ['misty-step'] },
  ];

  const level1 = resolveChoiceOptions(choice, { catalogs, classId: 'wizard', classLevel: 1, classRecord, buildSelections: selections });
  const level2 = resolveChoiceOptions(choice, { catalogs, classId: 'wizard', classLevel: 2, classRecord, buildSelections: selections });
  assert.equal(level1.state, 'options');
  assert.deepEqual(level1.items.map((spell) => spell.id), ['shield']);
  assert.deepEqual(level2.items.map((spell) => spell.id), ['shield', 'misty-step']);
});

test('spell-list choices use class-level slot caps and flag unparsed eligibility as manual', () => {
  const result = resolveChoiceOptions({
    id: 'bard-prepared',
    optionSource: { type: 'spell-list', id: 'bard', spellKind: 'spell' },
  }, {
    catalogs: { spells: [
      { id: 'healing-word', name: 'Healing Word', level: 1, classes: ['bard'] },
      { id: 'fireball', name: 'Fireball', level: 3, classes: ['bard'] },
    ] },
    classId: 'bard',
    classLevel: 1,
    classRecord: { spellcasting: { slotsByLevel: { 1: { 1: 2 } } } },
  });

  assert.equal(result.state, 'manual');
  assert.deepEqual(result.items.map((spell) => spell.id), ['healing-word']);
  assert.match(result.reason, /capped by the local class-level slot table/);
});

test('manual adapters retain stable record IDs and never invent choice counts', () => {
  const adapters = getManualRecordChoiceAdapters({
    id: 'human',
    kind: 'species',
    size: 'Medium or Small, chosen when you select this species.',
    traits: [{ id: 'skillful', name: 'Skillful', description: 'Choose one skill of your choice.' }],
  });
  const equipmentAdapters = getManualRecordChoiceAdapters({
    id: 'acolyte',
    kind: 'background',
    abilityScores: [{ id: 'wis', name: 'Wisdom' }],
    equipment: { raw: 'Choose A or B', options: [{ id: 'a', label: 'A', raw: 'A kit' }, { id: 'b', label: 'B', raw: 'Gold' }] },
  });
  const classAdapters = getManualRecordChoiceAdapters({
    id: 'wizard',
    kind: 'class',
    startingEquipment: { raw: 'Choose A or B', options: [{ id: 'A', raw: 'A kit' }, { id: 'B', raw: 'Gold' }] },
  });

  const skillChoice = adapters.find((choice) => choice.id === 'adapter:human:trait:skillful');
  assert.ok(skillChoice);
  assert.equal(skillChoice.selection.count, null);
  assert.equal(skillChoice.description, 'Choose one skill of your choice.');
  assert.ok(adapters.some((choice) => choice.id === 'adapter:human:size' && choice.description.includes('Small')));
  assert.deepEqual(equipmentAdapters.map((choice) => choice.id), [
    'adapter:acolyte:ability-scores',
    'adapter:acolyte:starting-equipment',
  ]);
  assert.equal(equipmentAdapters[1].selection.count, null);
  assert.equal(classAdapters[0].id, 'adapter:wizard:starting-equipment');
  assert.deepEqual(classAdapters[0].options.map((option) => option.id), ['A', 'B']);
});

test('starting-equipment option labels are enriched from local package records', () => {
  const enriched = enrichChoiceOptions({ feature: 'Starting Equipment' }, {
    startingEquipment: { options: [
      { id: 'A', label: 'A', raw: '2 Daggers, Spellbook, and 5 GP', items: [{ name: 'Dagger', quantity: 2 }], gold: 5 },
      { id: 'B', label: 'B', raw: '55 GP', items: [], gold: 55 },
    ] },
  }, [
    { id: 'a', label: 'Option A' },
    { id: 'b', label: 'Option B' },
  ]);

  assert.equal(enriched[0].id, 'a');
  assert.match(enriched[0].description, /2 Daggers/);
  assert.match(enriched[0].description, /Dagger ×2/);
  assert.match(enriched[1].description, /55 GP/);
});

test('resolveChoiceOptions marks unresolved sources as unsupported instead of returning silent emptiness', () => {
  const result = resolveChoiceOptions({ optionSource: { type: 'future-source' } });
  assert.equal(result.supported, false);
  assert.match(result.reason, /not supported/);
});

test('ability modifiers use floor for odd scores and proficiency bonus follows total level', () => {
  assert.equal(calculateAbilityModifier(9), -1);
  assert.equal(calculateAbilityModifier(7), -2);
  assert.deepEqual([1, 4, 5, 9, 13, 17, 20].map(calculateProficiencyBonus), [2, 2, 3, 4, 5, 6, 6]);
  assert.equal(calculateProficiencyBonus(21), null);
});

test('ability score methods expose standard-array and point-buy constraints', () => {
  assert.equal(calculatePointBuyCost({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }), 27);
  assert.equal(validateAbilityScores('standard-array', { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }).valid, true);
  assert.equal(validateAbilityScores('standard-array', { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }).valid, false);
  assert.match(validateAbilityScores('point-buy', { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 }).errors[0], /8 to 15|27/);
  assert.equal(validateAbilityScores('rolled', { str: 18, dex: 14, con: 12, int: 10, wis: 8, cha: 6 }).valid, true);
});

test('class-level allocations report mismatches and never redistribute levels', () => {
  const classes = [
    { classId: 'fighter', classLevel: 3 },
    { classId: 'wizard', classLevel: 2 },
  ];
  assert.equal(validateBuildLevelAllocation(classes, 5).valid, true);
  assert.match(validateBuildLevelAllocation(classes, 6).errors.join(' '), /total 5.*target character level is 6/);
  assert.match(validateBuildLevelAllocation([{ classId: 'fighter', classLevel: 20 }, { classId: 'wizard', classLevel: 1 }], 20).errors.join(' '), /maximum is 20/);
});

test('derived saves and spellcasting values use selected class records', () => {
  const wizard = {
    id: 'wizard',
    savingThrows: ['int', 'wis'],
    spellcasting: {
      type: 'full', ability: 'int',
      slotsByLevel: { 5: { 1: 4, 2: 3, 3: 2 } },
    },
  };
  const derived = calculateCharacterDerivedValues({
    level: 5,
    abilityScores: { str: 10, dex: 12, con: 14, int: 16, wis: 10, cha: 8 },
    build: { classes: [{ classId: 'wizard', classLevel: 5 }] },
    classRecords: { wizard: { classRecord: wizard, subclassRecord: null } },
  });

  assert.equal(derived.proficiencyBonus, 3);
  assert.deepEqual(derived.savingThrows.proficientAbilities, ['int', 'wis']);
  assert.equal(derived.savingThrows.byAbility.int, 6);
  assert.equal(derived.spellSlots.status, 'calculated');
  assert.deepEqual(derived.spellSlots.byLevel, { 1: 4, 2: 3, 3: 2 });
  assert.deepEqual(derived.spellcasters[0], {
    classId: 'wizard', subclassId: null, classLevel: 5, ability: 'int',
    spellAttackModifier: 6, spellSaveDC: 14, status: 'calculated', reason: null,
  });
});

test('multiclass slots combine local full and half-caster contributions while Pact Magic stays separate', () => {
  const fullCaster = { id: 'wizard', spellcasting: { type: 'full', ability: 'int', slotsByLevel: { 3: { 1: 4, 2: 2 } } } };
  const halfCaster = { id: 'paladin', spellcasting: { type: 'half', ability: 'cha', slotsByLevel: { 2: { 1: 2 } } } };
  const combined = calculateCharacterDerivedValues({
    level: 5,
    abilityScores: { int: 16, cha: 14 },
    build: { classes: [{ classId: 'wizard', classLevel: 3 }, { classId: 'paladin', classLevel: 2 }] },
    classRecords: {
      wizard: { classRecord: fullCaster },
      paladin: { classRecord: halfCaster },
    },
    multiclassSlotTable: { slotsByLevel: { 4: { 1: 4, 2: 3 } } },
  });
  assert.equal(combined.spellSlots.casterLevel, 4);
  assert.deepEqual(combined.spellSlots.byLevel, { 1: 4, 2: 3 });

  const pact = calculateCharacterDerivedValues({
    level: 10,
    abilityScores: { int: 16, cha: 18 },
    build: { classes: [{ classId: 'wizard', classLevel: 5 }, { classId: 'warlock', classLevel: 5 }] },
    classRecords: {
      wizard: { classRecord: { ...fullCaster, spellcasting: { ...fullCaster.spellcasting, slotsByLevel: { 5: { 1: 4, 2: 3, 3: 2 } } } } },
      warlock: { classRecord: { id: 'warlock', spellcasting: { type: 'pact', ability: 'cha', pactSlotsByLevel: { 5: { slots: 2, slotLevel: 3 } } } } },
    },
  });
  assert.equal(pact.spellSlots.status, 'calculated');
  assert.deepEqual(pact.spellSlots.byLevel, { 1: 4, 2: 3, 3: 2 });
  assert.deepEqual({ slots: pact.pactMagic.slots, slotLevel: pact.pactMagic.slotLevel }, { slots: 2, slotLevel: 3 });
});

test('third-caster subclass progression and unresolved multiclass inputs are handled explicitly', () => {
  const rogue = { id: 'rogue', savingThrows: ['dex', 'int'], spellcasting: null };
  const trickster = { id: 'arcane-trickster', spellcasting: {
    type: 'third', ability: 'int', slotsByLevel: { 6: { 1: 3 } },
  } };
  const derived = calculateCharacterDerivedValues({
    level: 6,
    abilityScores: { int: 16 },
    build: { classes: [{ classId: 'rogue', classLevel: 6, subclassId: 'arcane-trickster' }] },
    classRecords: { rogue: { classRecord: rogue, subclassRecord: trickster } },
  });
  assert.deepEqual(derived.spellSlots.byLevel, { 1: 3 });
  assert.equal(derived.spellcasters[0].spellSaveDC, 14);

  const unsupportedHalf = calculateCharacterDerivedValues({
    level: 5,
    build: { classes: [{ classId: 'unknown-half', classLevel: 2 }, { classId: 'wizard', classLevel: 3 }] },
    classRecords: {
      'unknown-half': { classRecord: { spellcasting: { type: 'half', slotsByLevel: {} } } },
      wizard: { classRecord: { spellcasting: { type: 'full', slotsByLevel: { 3: { 1: 4, 2: 2 } } } } },
    },
    multiclassSlotTable: { slotsByLevel: { 4: { 1: 4, 2: 3 } } },
  });
  assert.equal(unsupportedHalf.spellSlots.status, 'unresolved');
});

test('setBuildSelection and setBuildSpell preserve independent build entries', () => {
  const build = {
    selections: [{ choiceId: 'class:skills', selectedOptionIds: ['perception'] }],
    spells: [{ spellId: 'shield', status: 'prepared', sourceClassId: 'wizard' }],
  };
  const withSelection = setBuildSelection(build, 'class:feat', ['alert', 'alert', '../invalid']);
  const withSpell = setBuildSpell(withSelection, { id: 'fireball' }, { status: 'known', sourceClassId: 'wizard' });

  assert.deepEqual(withSpell.selections, [
    { choiceId: 'class:skills', selectedOptionIds: ['perception'] },
    { choiceId: 'class:feat', selectedOptionIds: ['alert'] },
  ]);
  assert.deepEqual(withSpell.spells, [
    { spellId: 'shield', status: 'prepared', sourceClassId: 'wizard' },
    { spellId: 'fireball', status: 'known', sourceClassId: 'wizard' },
  ]);
});

test('manual selections preserve stable option IDs and explicit confirmation', () => {
  const build = setBuildSelection({}, 'feature:manual', ['option-a']);
  const confirmed = setBuildManualChoice(build, 'feature:manual', {
    manualValue: 'Selected from full feature text.',
    manualConfirmed: true,
  });
  const cleared = setBuildManualChoice(confirmed, 'feature:manual', { manualValue: '', manualConfirmed: false });

  assert.deepEqual(confirmed.selections, [{
    choiceId: 'feature:manual',
    selectedOptionIds: ['option-a'],
    manualValue: 'Selected from full feature text.',
    manualConfirmed: true,
  }]);
  assert.deepEqual(cleared.selections, [{
    choiceId: 'feature:manual',
    selectedOptionIds: ['option-a'],
    manualValue: '',
    manualConfirmed: false,
  }]);
});

test('setBuildSubclass updates only the matching class entry', () => {
  const build = {
    classes: [
      { classId: 'wizard', classLevel: 3, subclassId: null },
      { classId: 'fighter', classLevel: 2, subclassId: 'champion' },
    ],
  };
  const selected = setBuildSubclass(build, 'wizard', 'diviner');
  const cleared = setBuildSubclass(selected, 'wizard', null);
  assert.equal(selected.classes[0].subclassId, 'diviner');
  assert.equal(selected.classes[1].subclassId, 'champion');
  assert.equal(cleared.classes[0].subclassId, null);
  assert.equal(cleared.classes[1].subclassId, 'champion');
  assert.deepEqual(setBuildSubclass(build, 'missing', 'x'), build);
});
