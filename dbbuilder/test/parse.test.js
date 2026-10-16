import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToDoc } from '../src/parse/htmlToDoc.js';
import { extractClass, extractSubclass, findProgressionTables, parseEquipment, parsePrereq, parseSkills, readProgression, subclassPageTitles } from '../src/parse/classExtractor.js';
import { RULES_SCHEMA_VERSION, validate } from '../src/schema/schemas.js';
import { normalizeFeature } from '../src/parse/featureNormalizer.js';
import { casterPage, fighterPage, linkedSubclassPage } from './helpers.js';
import { Character } from '../../shared/schema.js';

const source = { id: 't', title: 'T', url: null, fetchedAt: 'x' };
const run = (html, name, extra = {}) => extractClass(htmlToDoc(html, name), { name, edition: '2024', source, ...extra });

test('htmlToDoc: nested sections, header-row colspan, and facts from label/value tables', () => {
  const doc = htmlToDoc(fighterPage(), 'Fighter');
  assert.equal(doc.facts.hitpointdie, 'D10 per Fighter level');
  assert.equal(doc.facts.primaryability, 'Strength or Dexterity');
  const features = doc.root.children.find((s) => s.heading === 'Fighter Features');
  assert.ok(features.children.some((c) => c.heading === 'Level 1: Fighting Style'));
});

test('htmlToDoc: portable infobox and "Label: value" paragraphs become facts', () => {
  const doc = htmlToDoc('<div class="mw-parser-output"><aside class="portable-infobox"><div class="pi-data"><h3 class="pi-data-label">Hit Die</h3><div class="pi-data-value">d12</div></div></aside><p><b>Saving Throws:</b> Strength, Constitution</p></div>');
  assert.equal(doc.facts.hitdie, 'd12');
  assert.equal(doc.facts.savingthrows, 'Strength, Constitution');
});

test('htmlToDoc: Wikidot content container extracts page IDs from internal namespace links', () => {
  const doc = htmlToDoc(`<html><body><div id="page-content">
    <table class="wiki-content-table"><tr><th>Core Traits</th></tr><tr><td><strong>Hit Point Die</strong></td><td>D10 per Fighter level</td></tr></table>
    <h3>Level 3: Fighter Subclass</h3><ul><li><a href="/fighter:champion">Champion</a></li></ul>
    <h3>Fighter Subclasses</h3><table class="wiki-content-table"><tr><th>Name</th></tr><tr><td><a href="/fighter:battle-master">Battle Master</a></td></tr></table>
    <a href="https://example.com/external">External</a><a href="#feature">Anchor</a>
  </div></body></html>`, 'Fighter');
  assert.equal(doc.facts.hitpointdie, 'D10 per Fighter level');
  assert.deepEqual(doc.links, ['fighter:champion', 'fighter:battle-master']);
  assert.deepEqual(subclassPageTitles(doc), ['fighter:champion', 'fighter:battle-master']);
});

test('fighter: core traits parse into structured fields', () => {
  const { record } = run(fighterPage(), 'Fighter');
  assert.equal(record.hitDie, 10);
  assert.deepEqual(record.savingThrows, ['str', 'con']);
  assert.deepEqual(record.primaryAbility, { abilities: ['str', 'dex'], join: 'or' });
  assert.deepEqual(record.proficiencies.skills.from, ['Athletics', 'Acrobatics', 'History', 'Insight', 'Survival'].sort((a, b) => ['Acrobatics', 'Athletics', 'History', 'Insight', 'Survival'].indexOf(a) - ['Acrobatics', 'Athletics', 'History', 'Insight', 'Survival'].indexOf(b)));
  assert.equal(record.proficiencies.skills.choose, 2);
  assert.deepEqual(record.proficiencies.armor.categories, ['light', 'medium', 'heavy', 'shields']);
  assert.deepEqual(record.proficiencies.weapons.categories, ['simple', 'martial']);
});

test('fighter: starting equipment options keep quantities, gold, and parenthesised commas', () => {
  const { options } = run(fighterPage(), 'Fighter').record.startingEquipment;
  assert.equal(options.length, 2);
  assert.deepEqual(options[0].items.map((i) => [i.name, i.quantity]), [['Chain Mail', 1], ['Greatsword', 1], ['Javelins', 8], ['Dungeoneer\'s Pack (Backpack, Rope)', 1]]);
  assert.equal(options[0].gold, 4);
  assert.equal(options[1].gold, 155);
});

test('starting equipment: parenthesized xN quantities and wrapped item names are normalized', () => {
  const { items } = parseEquipment('Dagger (x2), (Quarterstaff), Handaxe (x4)').options[0];
  assert.deepEqual(items.map(({ name, quantity }) => [name, quantity]), [
    ['Dagger', 2], ['Quarterstaff', 1], ['Handaxe', 4],
  ]);
});

test('fighter: features for all 20 levels, headings and table names merged without duplicates', () => {
  const { record, warnings } = run(fighterPage(), 'Fighter');
  const f = record.featuresByLevel;
  assert.equal(Object.keys(f).length, 20);
  assert.deepEqual(f[1].map((x) => x.name), ['Fighting Style', 'Second Wind']);
  assert.match(f[1][0].description, /Placeholder text for Fighting Style/);
  assert.match(f[1][0].description, /- Option one/);
  assert.deepEqual(f[2].map((x) => x.name), ['Action Surge']);
  assert.match(f[2][0].description, /Placeholder text for Action Surge/, 'heading without "Level N:" prefix is matched by name');
  assert.equal(record.progression[5].proficiencyBonus, 3);
  assert.deepEqual(record.progression[1].values['weapon-mastery'], { status: 'known', value: 2, unit: 'count' });
  assert.equal(record.choices.find((c) => c.id === 'fighter-skill-proficiencies').selection.count, 2);
  assert.equal(record.choices.find((c) => c.id === 'fighter-starting-equipment').options.length, 2);
  const skillChoice = record.choices.find((c) => c.id === 'fighter-skill-proficiencies');
  assert.equal(skillChoice.selection.min, 2);
  assert.equal(skillChoice.selection.max, 2);
  assert.equal(skillChoice.selection.distinct, true);
  assert.equal(skillChoice.resolution, 'structured');
  assert.equal(skillChoice.levelContext.classId, 'fighter');
  assert.equal(skillChoice.sources[0].id, 't');
  assert.deepEqual(warnings, []);
});

test('feature options are emitted as data without removing their prose description', () => {
  const html = fighterPage().replace(
    '<p>Placeholder text for Fighting Style.</p><ul><li>Option one</li><li>Option two</li></ul>',
    '<p>You gain one of the following options of your choice:</p><ul><li>Defense. You gain a bonus to AC.</li><li>Dueling. You gain a damage bonus.</li></ul>',
  );
  const { record } = run(html, 'Fighter');
  const choice = record.choices.find((c) => c.id === 'fighter-1-fighting-style-option');
  assert.equal(choice.selection.count, 1);
  assert.deepEqual(choice.options.map((o) => o.label), ['Defense', 'Dueling']);
  assert.equal(choice.resolution, 'structured');
  assert.ok(choice.featureId);
  assert.match(record.featuresByLevel[1][0].description, /Defense\. You gain a bonus/);
});

test('shared Feature normalizer structures common combat fields and retains source prose', () => {
  const feature = normalizeFeature({
    id: 'barbarian-1-rage', name: 'Rage',
    description: 'As a Bonus Action, you enter a Rage. When you hit a target, you deal 1d6 Fire damage for 1 minute. You can use this once per Long Rest.',
  });
  assert.equal(feature.id, 'barbarian-1-rage');
  assert.equal(feature.description.includes('As a Bonus Action'), true);
  assert.deepEqual(feature.activation, { type: 'bonusAction', cost: 1, unit: 'action', trigger: null });
  assert.deepEqual(feature.damage, [{ formula: '1d6', damageType: 'fire', onSave: null }]);
  assert.deepEqual(feature.duration, { value: 1, unit: 'minute' });
  assert.deepEqual(feature.uses, { maximum: 1, period: 'long-rest' });
  assert.equal(feature.resolution, 'structured');
});

test('shared Feature normalizer marks unrepresented combat effects partial', () => {
  const feature = normalizeFeature({
    id: 'test-gaze', name: 'Gaze',
    description: 'The target must make a Wisdom saving throw or become frightened until the end of its next turn.',
  });
  assert.deepEqual(feature.save, { ability: 'wis', dcFormula: { kind: 'unknown' } });
  assert.deepEqual(feature.conditionEffects, [{ condition: 'frightened', duration: null }]);
  assert.deepEqual(feature.duration, { value: 1, unit: 'turn' });
  assert.equal(feature.resolution, 'partial');

  const incomplete = normalizeFeature({
    id: 'test-wave', name: 'Wave', description: 'The target must make a Dexterity saving throw, takes radiant damage on a failure, and is stunned.',
  });
  assert.equal(incomplete.damage.length, 0);
  assert.deepEqual(incomplete.conditionEffects.map(({ condition }) => condition), ['stunned']);
  assert.equal(incomplete.resolution, 'partial');
});

test('class and subclass features use stable IDs and link their generated choices', () => {
  const { record, subclasses } = run(fighterPage(), 'Fighter');
  const fightingStyle = record.featuresByLevel[1].find(({ name }) => name === 'Fighting Style');
  assert.equal(fightingStyle.id, 'fighter-1-fighting-style');
  assert.ok(Array.isArray(fightingStyle.damage));
  assert.deepEqual(fightingStyle.choices, record.choices
    .filter(({ level, feature }) => level === 1 && feature === fightingStyle.name)
    .map(({ id }) => id));
  const subclassFeature = subclasses[0].featuresByLevel[3][0];
  assert.equal(subclassFeature.id, `champion-3-${subclassFeature.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  assert.deepEqual(validate('subclass', subclasses[0]), []);
});

test('unparsed feature choice prose is retained as an explicit manual choice', () => {
  const html = fighterPage().replace('</div>', '<h4>LEVEL 3: BESTIAL ASPECT</h4><p>Choose an aspect as described below.</p></div>');
  const { record } = run(html, 'Fighter');
  const choice = record.choices.find(({ feature }) => feature === 'BESTIAL ASPECT');
  assert.equal(choice.resolution, 'manual');
  assert.deepEqual(choice.options, []);
  assert.match(choice.unresolvedReason, /not safely normalized/);
});

test('choice extraction models infusion/metamagic progression and keeps combat choices out of build scope', () => {
  const html = `<div class="mw-parser-output"><h3>CLASS FEATURES</h3>
    <h4>LEVEL 2: INFUSE ITEM</h4><p>When you gain this feature, pick four Artificer Infusions to learn. Whenever you gain a level in this class, you can replace one infusion.</p>
    <h4>LEVEL 2: METAMAGIC</h4><p>You gain two Metamagic options of your choice. You gain two more options at Sorcerer level 10 and two more at Sorcerer level 17.</p>
    <h4>LEVEL 5: CUNNING STRIKE</h4><p>When you deal Sneak Attack damage, choose one of the following effects:</p>
    <ul><li>Poison (Cost: 1d6). The target is poisoned.</li><li>Trip (Cost: 1d6). The target falls prone.</li><li>Withdraw (Cost: 1d6). You move away.</li></ul>
    <h4>LEVEL 3: COMBAT SUPERIORITY</h4><p>You learn three different Maneuvers of your choice from the Maneuvers table.</p>
    <h4>LEVEL 3: ARCANE SHOT</h4><p>You learn two Arcane Shot options of your choice.</p>
    <h4>LEVEL 3: RUNE CARVER</h4><p>You learn two runes of your choice.</p>
  </div>`;
  const { record } = run(html, 'Artificer');
  const infusions = record.choices.find((choice) => choice.optionSource?.type === 'infusion-list');
  assert.equal(infusions.selection.count, null);
  assert.equal(infusions.selection.countRule, 'progression.values.infusions-known.value');
  assert.equal(infusions.scope, 'progression');
  assert.ok(infusions.changeRule);
  const metamagic = record.choices.filter((choice) => choice.optionSource?.type === 'metamagic-list');
  assert.deepEqual(metamagic.map(({ level, selection }) => [level, selection.count]), [[2, 2], [10, 2], [17, 2]]);
  assert.equal(new Set(record.choices.map((choice) => choice.id)).size, record.choices.length);
  const cunningStrike = record.choices.find((choice) => choice.feature === 'CUNNING STRIKE');
  assert.equal(cunningStrike.scope, 'runtime');
  assert.deepEqual(cunningStrike.options.map((option) => option.label), ['Poison', 'Trip', 'Withdraw']);
  assert.deepEqual(record.choices.filter((choice) => choice.optionSource?.type === 'feature-option-list')
    .map((choice) => choice.optionSource.id).sort(), ['artificer-arcane-shot-options', 'artificer-maneuvers', 'artificer-runes']);
});

test('bold inline level labels become features and explicit selections', () => {
  const html = `<div class="mw-parser-output">
    <h3>RANGER CLASS FEATURES</h3><h4>LEVEL 1: FAVORED ENEMY</h4><p>Hunter’s Mark is always prepared.</p>
    <p><b>2ND LEVEL: DEFT EXPLORER</b></p>
    <p>Thanks to your travels, you gain the following benefits:</p>
    <ul><li><b>Expertise.</b> Choose one of your proficiencies with which you lack Expertise.</li>
      <li><b>Languages.</b> You know two languages of your choice from the language tables.</li></ul>
  </div>`;
  const { record } = run(html, 'Ranger');
  assert.equal(record.featuresByLevel[1][0].name, 'FAVORED ENEMY');
  assert.doesNotMatch(record.featuresByLevel[1][0].description, /DEFT EXPLORER|Languages\./);
  assert.equal(record.featuresByLevel[2][0].name, 'DEFT EXPLORER');
  assert.match(record.featuresByLevel[2][0].description, /Choose one of your proficiencies/);
  assert.ok(record.choices.some((choice) => choice.optionSource?.id === 'proficiencies-without-expertise'));
  assert.ok(record.choices.some((choice) => choice.optionSource?.id === 'language-list' && choice.selection.count === 2));
});

test('progression values distinguish known zero, dice, not-applicable, and unknown cells', () => {
  const doc = htmlToDoc(`<table><tr><th>Level</th><th>Proficiency Bonus</th><th>Features</th><th>Points</th><th>Martial Arts</th><th>Unused</th><th>Missing</th></tr>
    <tr><td>1</td><td>+2</td><td>Training</td><td>0</td><td>d6</td><td>—</td><td></td></tr></table>`);
  const row = readProgression(doc.root.blocks[0]).rows[1];
  assert.deepEqual(row.values, {
    points: { status: 'known', value: 0, unit: 'points' },
    'martial-arts': { status: 'known', value: { kind: 'dice', count: 1, sides: 6 }, unit: null },
    unused: { status: 'not-applicable', value: null, unit: null },
    missing: { status: 'unknown', value: null, unit: null },
  });
});

test('fighter: inline subclasses are split out and excluded from class features', () => {
  const { record, subclasses } = run(fighterPage(), 'Fighter');
  assert.deepEqual(subclasses.map((s) => s.name), ['Champion', 'Battle Master']);
  assert.deepEqual(Object.keys(subclasses[0].featuresByLevel), ['3', '7']);
  assert.equal(record.subclasses[0].path, 'subclasses/champion.json');
  assert.ok(!Object.values(record.featuresByLevel).flat().some((f) => f.name === 'Improved Critical'));
});

test('fighter: multiclass prerequisites come from the class page, and a Multiclassing-page index overrides them', () => {
  assert.deepEqual(run(fighterPage(), 'Fighter').record.multiclass.prerequisites, { abilities: [{ ability: 'str', min: 13 }, { ability: 'dex', min: 13 }], join: 'or' });
  const override = { prerequisites: { abilities: [{ ability: 'str', min: 15 }], join: null }, proficienciesGained: 'X' };
  assert.equal(run(fighterPage(), 'Fighter', { multiclass: override }).record.multiclass.prerequisites.abilities[0].min, 15);
});

test('full caster: two header rows with rowspan/colspan produce slots, cantrips, ability and spell list', () => {
  const { record } = run(casterPage('full'), 'Wizard');
  const sc = record.spellcasting;
  assert.equal(sc.type, 'full');
  assert.equal(sc.ability, 'int');
  assert.equal(sc.spellList, 'wizard');
  assert.deepEqual(sc.slotsByLevel[1], { 1: 2 });
  assert.deepEqual(Object.keys(sc.slotsByLevel[17]).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(sc.cantripsKnownByLevel[1], 2);
  assert.equal(sc.preparedSpellsByLevel[1], 4);
  assert.equal(record.proficiencies.skills.from.length, 18, '"Choose any 3 skills" expands to all skills');
  assert.equal(record.proficiencies.skills.choose, 3);
});

test('pact caster: slot count and slot level per class level', () => {
  const sc = run(casterPage('pact'), 'Warlock').record.spellcasting;
  assert.equal(sc.type, 'pact');
  assert.equal(sc.ability, 'cha');
  assert.deepEqual(sc.pactSlotsByLevel[1], { slots: 1, slotLevel: 1 });
  assert.deepEqual(sc.pactSlotsByLevel[20], { slots: 3, slotLevel: 5 });
  assert.equal(sc.slotsByLevel, null);
});

test('non-casters have spellcasting: null', () => assert.equal(run(fighterPage(), 'Fighter').record.spellcasting, null));

test('missing progression tables do not fabricate spell slots or cantrip counts', () => {
  const wizard = run('<div class="mw-parser-output"><h3>LEVEL 1: SPELLCASTING</h3><p>Intelligence is your spellcasting ability for your Wizard spells.</p></div>', 'Wizard').record.spellcasting;
  assert.equal(wizard.type, 'full');
  assert.equal(wizard.ability, 'int');
  assert.equal(wizard.slotsByLevel, null);
  assert.equal(wizard.cantripsKnownByLevel, null);

  const knight = run('<div class="mw-parser-output"><h3>LEVEL 3: SPELLCASTING</h3><p>Intelligence is your spellcasting ability for your spells.</p></div>', 'Fighter').record.spellcasting;
  assert.equal(knight.type, 'third');
  assert.equal(knight.slotsByLevel, null);
});

test('linked subclass pages are accepted alongside inline ones', () => {
  const linked = [{ doc: htmlToDoc(linkedSubclassPage, 'Fighter: Wildcard'), source }];
  const { subclasses } = run(fighterPage(), 'Fighter', { linkedSubclasses: linked });
  assert.deepEqual(subclasses.map((s) => s.id).slice(-1), ['wildcard']);
});

test('schema accepts complete records and rejects ones missing required data', () => {
  const ok = run(fighterPage(), 'Fighter');
  assert.deepEqual(validate('class', ok.record), []);
  assert.deepEqual(validate('subclass', ok.subclasses[0]), []);
  assert.match(validate('class', { ...ok.record, injected: true }).join('\n'), /additional properties/);
  assert.match(validate('subclass', { ...ok.subclasses[0], injected: true }).join('\n'), /additional properties/);
  const bad = run(fighterPage({ omit: ['core'] }), 'Fighter').record;
  const errors = validate('class', bad).join('\n');
  assert.match(errors, /hitDie/);
  assert.match(errors, /savingThrows/);
});

test('character selections and mutable state validate separately from shared class rules', () => {
  const character = {
    schemaVersion: RULES_SCHEMA_VERSION, kind: 'character', id: 'test-character', name: 'Test', notes: '', tokenColor: '#e63946',
    classes: [{ classId: 'fighter', classLevel: 1, subclassId: null }],
    speciesId: null, backgroundId: null, featIds: [], equipment: [], spellIds: [], customFeatures: [],
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
    selections: [
      { choiceId: 'fighter-skill-proficiencies', selectedOptionIds: ['athletics', 'history'] },
      { choiceId: 'species-lineage', selectedOptionIds: [], manualValue: 'Recorded manually', manualConfirmed: true },
    ],
    state: {
      hitPoints: { current: 12, maximum: 12, temporary: 0 }, resources: [], spellSlots: {}, conditions: [], customConditions: [],
      concentration: null, turn: { action: true, bonusAction: true, reaction: true },
    },
  };
  assert.deepEqual(validate('character', character), []);
  assert.deepEqual(validate('character', { ...character, classes: [] }), []);
  assert.match(validate('character', { ...character, attacks: [] }).join('\n'), /additional properties/);
});

test('shared Character serializer matches the strict generated v6 schema', () => {
  const character = Character.fromInput({
    id: 'char-test', name: 'Test', classes: [{ classId: 'wizard', classLevel: 5, subclassId: null }],
    speciesId: 'gnome', backgroundId: 'acolyte', featIds: ['alert'], spellIds: ['fireball'],
    equipment: [{ equipmentId: 'quarterstaff', quantity: 1, equipped: true }],
    state: {
      hitPoints: { current: 21, maximum: 30, temporary: 2 },
      resources: [{ id: 'arcane-recovery', remaining: 1 }], spellSlots: { 3: { expended: 1 } },
      conditions: [{ id: 'poisoned', sourceId: null, duration: null }], customConditions: [],
      concentration: { spellId: 'hex', targetIds: ['target-1'] },
      turn: { action: false, bonusAction: true, reaction: false },
    },
  }, null).toJSON();
  assert.deepEqual(validate('character', character), []);
});

test('tool parser exposes the Monk artisan-tool or instrument decision as a choice', () => {
  const html = `<div class="mw-parser-output"><h3>HIT POINTS</h3><p>Hit Dice: 1d8</p>
    <p>Primary Ability: Dexterity</p><p>Saving Throws: Strength, Dexterity</p>
    <p>Skills: Choose one from Acrobatics, Athletics</p><p>Weapons: Simple weapons</p>
    <p>Tools: Choose one type of Artisan’s Tool or Musical Instrument</p></div>`;
  const { record } = run(html, 'Monk');
  assert.equal(record.proficiencies.tools.items.length, 0);
  assert.equal(record.proficiencies.tools.choices[0].from.length, 27);
  const artificerTools = run(`<div id="page-content"><p>Tools: Thieves’ Tools, Tinker’s Tools, and one type of Artisan’s Tools of your choice</p></div>`, 'Artificer').record.proficiencies.tools;
  assert.deepEqual(artificerTools.items, ['Thieves’ Tools', 'Tinker’s Tools']);
  assert.equal(artificerTools.choices[0].count, 1);
  const bard = run(`<div id="page-content"><p>Tools: Choose 3 Musical Instruments</p></div>`, 'Bard').record;
  assert.deepEqual(bard.proficiencies.tools.items, []);
  assert.equal(bard.proficiencies.tools.choices[0].count, 3);
  assert.equal(bard.choices.find((choice) => choice.id === 'bard-tool-proficiencies-1').selection.count, 3);
});

test('small parsers', () => {
  assert.deepEqual(parsePrereq('Strength 13 and Charisma 13').join, 'and');
  assert.deepEqual(parsePrereq('13 in one of the Barbarian’s primary ability', ['str']).abilities, [{ ability: 'str', min: 13 }]);
  assert.equal(parseSkills('Choose two: Arcana or History').choose, 2);
  assert.equal(parseSkills('Any three skills of your choice').choose, 3);
  assert.equal(parseSkills('Any three skills of your choice').from.length, 18);
  assert.equal(parseEquipment('Dagger and 10 GP').options[0].gold, 10);
});

test('plain labels (Skills / Weapons / Armor / Equipment) are recognised as core traits', () => {
  const html = `<div class="mw-parser-output"><p><b>Hit Dice:</b> 1d8 per level</p><p>Saving Throws: Dexterity, Intelligence</p>
    <p>Armor: Light armor</p><p>Weapons: Simple weapons, hand crossbows</p><p>Tools: Thieves' tools</p>
    <p>Skills: Choose three from Acrobatics, Stealth, or Deception</p><p>Equipment: (A) Dagger, Pack; or (B) 50 GP</p></div>`;
  const { record } = run(html, 'Rogue');
  assert.equal(record.hitDie, 8);
  assert.deepEqual(record.proficiencies.weapons.categories, ['simple']);
  assert.equal(record.proficiencies.skills.choose, 3);
  assert.equal(record.startingEquipment.options.length, 2);
  assert.deepEqual(record.proficiencies.tools.items, ["Thieves' tools"]);
});

test('wiki prose layout: parenthetical labels, section traits, equipment choices, and multiclass primary abilities', () => {
  const html = `<div class="mw-parser-output">
    <h2>FIGHTER</h2><ol><li><b>Primary Ability:</b> Strength or Dexterity</li></ol>
    <h3>HIT POINTS</h3><p><b>Hit Dice:</b> 1d10 per Fighter level</p>
    <h3>PROFICIENCIES</h3><ul><li><b>Saving Throws:</b> Strength, Constitution</li>
      <li><b>Skills (Choose 2):</b> Acrobatics, Athletics, History</li>
      <li><b>Weapons:</b> Simple Weapons, Martial Weapons</li><li><b>Tools:</b> None</li></ul>
    <h3>ARMOR TRAINING</h3><p>Light Armor, Medium Armor, Heavy Armor, Shields</p>
    <h3>STARTING EQUIPMENT</h3><p>Choose equipment or forgo it and spend 155 GP.</p>
      <ul><li>(a) Chain Mail, Greatsword, 4 GP</li><li>(b) Studded Leather, Longbow</li><li>Dungeoneer's Pack</li></ul>
    <h3>MULTICLASSING AND THE FIGHTER</h3><ul><li><b>Ability Score Minimum.</b> You need 13 in one of the Fighter's primary abilities.</li></ul>
    <h3>FIGHTER CLASS FEATURES</h3><h4>4TH LEVEL: ABILITY SCORE IMPROVEMENT</h4>
      <p>You gain this feature again at levels 6, 8, 12, 14, and 16.</p>
    <h4>LEVEL 3: FIGHTER SUBCLASS</h4><ul><li><a href="/fighter:champion">Champion</a></li></ul>
  </div>`;
  const doc = htmlToDoc(html, 'Fighter');
  const { record } = extractClass(doc, { name: 'Fighter', edition: '2024', source });

  assert.deepEqual(record.proficiencies.skills, {
    choose: 2, from: ['Acrobatics', 'Athletics', 'History'], raw: '(Choose 2) Acrobatics, Athletics, History',
  });
  assert.deepEqual(record.proficiencies.armor.categories, ['light', 'medium', 'heavy', 'shields']);
  assert.equal(record.startingEquipment.options.length, 3);
  assert.equal(record.startingEquipment.options[0].items.at(-1).name, "Dungeoneer's Pack");
  assert.equal(record.startingEquipment.options[1].items.at(-1).name, "Dungeoneer's Pack");
  assert.equal(record.startingEquipment.options[2].gold, 155);
  assert.deepEqual(record.multiclass.prerequisites, {
    abilities: [{ ability: 'str', min: 13 }, { ability: 'dex', min: 13 }], join: 'or',
  });
  assert.deepEqual(record.featuresByLevel[4].map((f) => f.name), ['ABILITY SCORE IMPROVEMENT']);
  for (const level of [6, 8, 12, 14, 16]) assert.equal(record.featuresByLevel[level][0].name, 'ABILITY SCORE IMPROVEMENT');
  assert.equal(record.progression[20].proficiencyBonus, 6);
  assert.deepEqual(subclassPageTitles(doc), ['fighter:champion']);
});

test('Wikidot Artificer page: class and spell progression tables merge by level', () => {
  const html = `<html><body><div id="page-content">
    <table class="wiki-content-table"><tr><th>Core Artificer Traits</th></tr>
      <tr><td><strong>Primary Ability</strong></td><td>Intelligence</td></tr>
      <tr><td><strong>Hit Point Die</strong></td><td>D8 per Artificer level</td></tr>
      <tr><td><strong>Saving Throw Proficiencies</strong></td><td>Constitution and Intelligence</td></tr>
      <tr><td><strong>Skill Proficiencies</strong></td><td>Choose 2: Arcana, History, Investigation, Medicine, Nature, Perception, or Sleight of Hand</td></tr>
      <tr><td><strong>Weapon Proficiencies</strong></td><td>Simple weapons</td></tr>
      <tr><td><strong>Armor Training</strong></td><td>Light and Medium armor and Shields</td></tr>
      <tr><td><strong>Starting Equipment</strong></td><td>Choose A or B: (A) Dagger and 16 GP; or (B) 150 GP</td></tr></table>
    <h1>Artificer Class Features</h1>
    <h6>Artificer Features (Part A)</h6><table class="wiki-content-table"><tr><th>Level</th><th>Proficiency Bonus</th><th>Class Features</th></tr>
      <tr><td>1</td><td>+2</td><td>Spellcasting, Tinker's Magic</td></tr><tr><td>2</td><td>+2</td><td>Replicate Magic Item</td></tr></table>
    <h6>Artificer Features (Part B)</h6><table class="wiki-content-table"><tr><th>Level</th><th>Plans Known</th><th>Magic Items</th><th>Cantrips</th><th>Prepared Spells</th><th>1st</th><th>2nd</th></tr>
      <tr><td>1</td><td>-</td><td>-</td><td>2</td><td>2</td><td>2</td><td>-</td></tr>
      <tr><td>2</td><td>4</td><td>2</td><td>2</td><td>3</td><td>2</td><td>-</td></tr></table>
    <h3>Level 1: Spellcasting</h3><p>Intelligence is your spellcasting ability for Artificer spells. Use the Artificer spell list.</p>
    <h3>Level 3: Artificer Subclass</h3><ul><li><a href="/artificer:alchemist">Alchemist</a></li></ul>
  </div></body></html>`;
  const doc = htmlToDoc(html, 'Artificer');
  const { record } = extractClass(doc, { name: 'Artificer', edition: '2024', source });

  assert.equal(findProgressionTables(doc.root).length, 2);
  assert.equal(record.hitDie, 8);
  assert.deepEqual(record.primaryAbility.abilities, ['int']);
  assert.deepEqual(record.savingThrows, ['con', 'int']);
  assert.deepEqual(record.startingEquipment.options.map((o) => o.id), ['A', 'B']);
  assert.deepEqual(record.progression[2].values['plans-known'], { status: 'known', value: 4, unit: 'count' });
  assert.deepEqual(record.progression[2].values['magic-items'], { status: 'known', value: 2, unit: 'items' });
  assert.deepEqual(record.spellcasting.slotsByLevel[2], { 1: 2 });
  assert.equal(record.spellcasting.preparedSpellsByLevel[2], 3);
  assert.deepEqual(subclassPageTitles(doc), ['artificer:alchemist']);
});

test('Wikidot subclass spellcasting scans sibling sections and ignores option catalogs as progression tables', () => {
  const doc = htmlToDoc(`<div id="page-content">
    <h2>Level 3: Spellcasting</h2><p>You learn to cast spells.</p>
    <h2>Subclass Spellcasting</h2><table><tr><th>Monk Level</th><th>Cantrips</th><th>Prepared Spells</th><th>1st</th></tr>
      <tr><td>3</td><td>2</td><td>3</td><td>2</td></tr></table>
    <h2>Spellcasting Details</h2><p>Wisdom is your spellcasting ability for these spells.</p>
  </div>`, 'Mystic');
  const subclass = extractSubclass({ section: doc.root, className: 'Monk', name: 'Mystic', edition: '2024', source });
  assert.equal(subclass.spellcasting.ability, 'wis');
  assert.equal(subclass.spellcasting.preparedSpellsByLevel[3], 3);

  const inheritedDoc = htmlToDoc(`<div id="page-content"><h2>Level 3: Spellcasting</h2>
    <table><tr><th>Monk Level</th><th>Prepared Spells</th><th>Spell Slots</th><th>Slot Level</th></tr>
      <tr><td>3</td><td>2</td><td>1</td><td>1</td></tr></table></div>`, 'Mystic');
  const inherited = extractSubclass({
    section: inheritedDoc.root, className: 'Monk', name: 'Mystic', edition: '2024', source,
    classSpellcasting: { ability: 'wis', spellList: 'sorcerer' },
  });
  assert.equal(inherited.spellcasting.ability, 'wis');
  assert.equal(inherited.spellcasting.spellList, 'sorcerer');

  const optionDoc = htmlToDoc(`<div id="page-content"><h2>Level 3: Dread Allegiance</h2>
    <p>Choose one of three gifts.</p><table><tr><th>Rogue Level</th><th>Die Size</th><th>Number</th></tr>
      <tr><td>3</td><td>D6</td><td>4</td></tr><tr><td>5</td><td>D8</td><td>6</td></tr></table></div>`, 'Soulknife');
  const optionSubclass = extractSubclass({ section: optionDoc.root, className: 'Rogue', name: 'Soulknife', edition: '2024', source });
  assert.equal(optionSubclass.spellcasting, null);
});

test('generic multiclassing rule derives the class-specific 13-point requirement from primary abilities', () => {
  const { record } = run(`<div id="page-content"><p>Primary Ability: Strength or Dexterity</p>
    <p>Hit Point Die: D10</p><p>Saving Throw Proficiencies: Strength and Constitution</p>
    <p>Skill Proficiencies: Choose 2: Acrobatics, Athletics</p><p>Weapon Proficiencies: Simple and Martial weapons</p>
    <p>Armor Training: Light armor and Shields</p><p>Starting Equipment: 10 GP</p>
    <h2>As a Multiclass Character</h2><p>Gain the class features for each class level.</p></div>`, 'Fighter');
  assert.deepEqual(record.multiclass.prerequisites, {
    abilities: [{ ability: 'str', min: 13 }, { ability: 'dex', min: 13 }], join: 'or',
  });
});
