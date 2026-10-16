import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPageLinks, catalogRecordLinks, extractBackgroundCatalog, extractEquipmentCatalog, extractFeatCatalog, extractSpeciesCatalog, extractSpellCatalog } from '../src/parse/catalogExtractor.js';
import { validate } from '../src/schema/schemas.js';

const raw = (requestedTitle, html) => ({
  source: 'wikidot', title: requestedTitle.split(':').at(-1), requestedTitle,
  url: `https://dnd2024.wikidot.com/${requestedTitle}`, fetchedAt: '2026-01-01T00:00:00.000Z', html,
});

test('spell catalog extracts filterable metadata and full detail separately', () => {
  const index = raw('spell:all', `<div id="page-content"><div class="yui-navset">
    <ul class="yui-nav"><li>Cantrip</li><li>1st Level</li></ul><div class="yui-content">
      <div id="wiki-tab-0-0"><table><tr><th>Name</th><th>School</th><th>Spell lists</th><th>Casting Time</th><th>Range</th><th>Components</th><th>Duration</th></tr>
        <tr><td><a href="/spell:acid-splash">Acid Splash</a></td><td>Evocation</td><td>Wizard, Sorcerer</td><td>Action</td><td>60 feet</td><td>V, S</td><td>Instantaneous</td></tr></table></div>
      <div id="wiki-tab-0-1"><table><tr><th>Name</th><th>School</th><th>Spell lists</th><th>Casting Time</th><th>Range</th><th>Components</th><th>Duration</th></tr>
        <tr><td><a href="/spell:alarm">Alarm</a></td><td>Abjuration</td><td>Wizard</td><td>1 minute or R</td><td>30 feet</td><td>V, S, M</td><td>8 hours</td></tr></table></div>
    </div></div><a href="/spell:abjuration-school">School index</a></div>`);
  const detail = raw('spell:acid-splash', `<div id="page-content"><p>Source: Player's Handbook</p><p><em>Evocation Cantrip (Wizard)</em></p>
    <p><strong>Casting Time:</strong> Action<br><strong>Range:</strong> 60 feet<br><strong>Components:</strong> V, S<br><strong>Duration:</strong> Instantaneous</p>
    <p>You create an acidic bubble.</p><p>While active, you gain the following benefits:</p>
    <p><strong>Climbing.</strong> You gain a Climb Speed equal to your Speed.</p>
    <p><strong>Venomous Bite.</strong> Make an attack; the target takes 1d6 Force damage.</p>
    <p><strong>Cantrip Upgrade.</strong> Damage increases at higher levels.</p></div>`);
  assert.deepEqual(catalogRecordLinks(index.html, 'spell'), ['spell:acid-splash', 'spell:alarm']);
  assert.deepEqual(catalogPageLinks(index.html, 'spell'), ['spell:abjuration-school', 'spell:acid-splash', 'spell:alarm']);
  const [acid, alarm] = extractSpellCatalog(index, { 'spell:acid-splash': detail });
  assert.deepEqual([acid.name, acid.level, acid.school, acid.classes], ['Acid Splash', 0, 'Evocation', [{ id: 'wizard', name: 'Wizard' }, { id: 'sorcerer', name: 'Sorcerer' }]]);
  assert.equal(acid.feature.description, [
    'You create an acidic bubble.',
    'While active, you gain the following benefits:',
    'Climbing. You gain a Climb Speed equal to your Speed.',
    'Venomous Bite. Make an attack; the target takes 1d6 Force damage.',
    'Cantrip Upgrade. Damage increases at higher levels.',
  ].join('\n\n'));
  assert.equal(alarm.level, 1);
  assert.equal(alarm.ritual, true);
  assert.equal(alarm.feature.description, '');
  assert.deepEqual(validate('spell', acid), []);
});

test('spell combat parser normalizes area, saving throw, damage, and slot scaling', () => {
  const index = raw('spell:all', `<div id="page-content"><div class="yui-navset"><ul class="yui-nav"><li>3rd Level</li></ul><div class="yui-content">
    <div id="wiki-tab-0-0"><table><tr><th>Name</th><th>School</th><th>Spell lists</th><th>Casting Time</th><th>Range</th><th>Components</th><th>Duration</th></tr>
      <tr><td><a href="/spell:fireball">Fireball</a></td><td>Evocation</td><td>Wizard</td><td>Action</td><td>150 feet</td><td>V, S, M</td><td>Instantaneous</td></tr></table></div>
  </div></div></div>`);
  const detail = raw('spell:fireball', `<div id="page-content"><p><em>Level 3 Evocation</em></p>
    <p><strong>Casting Time:</strong> Action<br><strong>Range:</strong> 150 feet<br><strong>Components:</strong> V, S, M<br><strong>Duration:</strong> Instantaneous</p>
    <p>Each creature in a 20-foot-radius Sphere centered on that point makes a Dexterity saving throw, taking 8d6 Fire damage on a failed save, or half as much damage on a successful one.</p>
    <p><strong>Using a Higher-Level Spell Slot.</strong> The damage increases by 1d6 for each spell slot level above 3.</p></div>`);
  const [fireball] = extractSpellCatalog(index, { 'spell:fireball': detail });
  assert.equal(fireball.feature.resolution, 'structured');
  assert.deepEqual(fireball.feature.activation, { type: 'action', cost: 1, unit: 'action', trigger: null });
  assert.deepEqual(fireball.feature.range, { kind: 'range', distance: 150, unit: 'feet' });
  assert.deepEqual(fireball.feature.area, { shape: 'sphere', size: 20, unit: 'feet', origin: 'point' });
  assert.deepEqual(fireball.feature.target, { kind: 'each-creature', count: null });
  assert.equal(fireball.feature.attackRoll, null);
  assert.deepEqual(fireball.feature.save, { ability: 'dex', dcFormula: { kind: 'spellcasting' } });
  assert.deepEqual(fireball.feature.damage, [{ formula: '8d6', damageType: 'fire', onSave: 'half' }]);
  assert.deepEqual(fireball.feature.scaling, { kind: 'per-slot-level', minimumSpellLevel: 3, damage: [{ formula: '1d6', damageType: 'fire' }] });
  assert.deepEqual(validate('spell', fireball), []);
});

test('spell combat parser marks unrecognized effects manual without inventing mechanics', () => {
  const index = raw('spell:all', `<div id="page-content"><div class="yui-navset"><ul class="yui-nav"><li>1st Level</li></ul><div class="yui-content">
    <div id="wiki-tab-0-0"><table><tr><th>Name</th><th>School</th><th>Spell lists</th></tr><tr><td><a href="/spell:unknown-effect">Unknown Effect</a></td><td>Illusion</td><td>Bard</td></tr></table></div>
  </div></div></div>`);
  const detail = raw('spell:unknown-effect', `<div id="page-content"><p>The target experiences an unusual effect described in the source.</p></div>`);
  const [spell] = extractSpellCatalog(index, { 'spell:unknown-effect': detail });
  assert.equal(spell.feature.resolution, 'manual');
  assert.deepEqual(spell.feature.damage, []);
  assert.equal(spell.feature.save, null);
  assert.deepEqual(validate('spell', spell), []);
});

test('feat catalog keeps category, tab variant, prerequisites, and named benefits', () => {
  const index = raw('feat:all', `<div id="page-content"><h1>Origin Feats</h1><div class="yui-navset">
    <ul class="yui-nav"><li>Common</li><li>Faerun</li><li>Exotic</li></ul><div class="yui-content">
      <div id="wiki-tab-0-0"><table><tr><th>Name</th></tr><tr><td><a href="/feat:alert">Alert</a></td></tr></table></div>
    </div></div></div>`);
  const detail = raw('feat:alert', `<div id="page-content"><p>Source: Player's Handbook</p><p>You gain the following benefits.</p>
    <p><strong>Prerequisite:</strong> Level 4+, Strength 13</p>
    <p><strong>Initiative Proficiency.</strong> Add your Proficiency Bonus to Initiative.</p>
    <p><strong>Repeatable.</strong> You can take this feat more than once.</p></div>`);
  assert.deepEqual(catalogRecordLinks(index.html, 'feat'), ['feat:alert']);
  const [alert] = extractFeatCatalog(index, { 'feat:alert': detail });
  assert.equal(alert.category, 'Origin Feats');
  assert.deepEqual(alert.variants, ['Common']);
  assert.equal(alert.minimumCharacterLevel, 4);
  assert.deepEqual(alert.abilityScorePrerequisites, [{ ability: 'str', minimum: 13 }]);
  assert.deepEqual(alert.benefits.map(({ name, description }) => ({ name, description })), [
    { name: 'Initiative Proficiency', description: 'Add your Proficiency Bonus to Initiative.' },
  ]);
  assert.equal(alert.benefits[0].id, 'alert-initiative-proficiency');
  assert.equal(alert.repeatable, 'You can take this feat more than once.');
  assert.deepEqual(validate('feat', alert), []);
});

test('feat ability-score increases become structured one-pick allocations', () => {
  const index = raw('feat:all', `<div id="page-content">
    <h1>General Feats</h1><table><tr><th>Name</th></tr>
      <tr><td><a href="/feat:actor">Actor</a></td></tr>
      <tr><td><a href="/feat:fairy-trickster">Fairy Trickster</a></td></tr>
      <tr><td><a href="/feat:potent-dragonmark">Potent Dragonmark</a></td></tr>
      <tr><td><a href="/feat:resilient">Resilient</a></td></tr>
      <tr><td><a href="/feat:unparsed-score">Unparsed Score</a></td></tr></table></div>`);
  const details = {
    'feat:actor': raw('feat:actor', `<div id="page-content"><p>Source: Test</p><p><strong>Ability Score Increase.</strong> Increase your Charisma score by 1, to a maximum of 20.</p></div>`),
    'feat:fairy-trickster': raw('feat:fairy-trickster', `<div id="page-content"><p>Source: Test</p><p><strong>Ability Score Increase.</strong> Increase your Dexterity or Charisma ability score by 1, to a maximum of 20.</p></div>`),
    'feat:potent-dragonmark': raw('feat:potent-dragonmark', `<div id="page-content"><p>Source: Test</p><p><strong>Ability Score Increase.</strong> Increase the spellcasting ability score used by your Dragonmark feat by 1, to a maximum of 20.</p></div>`),
    'feat:resilient': raw('feat:resilient', `<div id="page-content"><p>Source: Test</p><p><strong>Ability Score Increase.</strong> Choose one ability in which you lack saving throw proficiency. Increase the chosen ability score by 1, to a maximum of 20.</p></div>`),
    'feat:unparsed-score': raw('feat:unparsed-score', `<div id="page-content"><p>Source: Test</p><p><strong>Score Choice.</strong> Choose an ability score and increase it as determined by your lineage.</p></div>`),
  };
  const feats = extractFeatCatalog(index, details);
  const actor = feats.find(({ id }) => id === 'actor');
  const actorChoice = actor.choices[0];
  assert.equal(actorChoice.resolution, 'structured');
  assert.deepEqual(actorChoice.options.map(({ label }) => label), ['Charisma']);
  assert.deepEqual(actorChoice.options[0].effects, [
    { type: 'ability-score-increase', ability: 'cha', amount: 1, maximum: 20 },
  ]);

  const fairy = feats.find(({ id }) => id === 'fairy-trickster');
  assert.deepEqual(fairy.choices[0].options.map(({ label }) => label), ['Dexterity', 'Charisma']);
  assert.equal(fairy.choices[0].resolution, 'structured');

  const dragonmark = feats.find(({ id }) => id === 'potent-dragonmark').choices[0];
  assert.equal(dragonmark.resolution, 'partial');
  assert.equal(dragonmark.optionSource.type, 'selected-feat-spellcasting-ability');
  assert.equal(dragonmark.effects[0].type, 'ability-score-increase');

  const resilient = feats.find(({ id }) => id === 'resilient').choices[0];
  assert.equal(resilient.resolution, 'partial');
  assert.equal(resilient.optionSource.type, 'abilities-without-saving-throw-proficiency');

  const unknown = feats.find(({ id }) => id === 'unparsed-score');
  assert.equal(unknown.choices[0].resolution, 'manual');
  assert.deepEqual(unknown.choices[0].options, []);
  for (const feat of feats) assert.deepEqual(validate('feat', feat), []);
});

test('background catalog extracts character-building choices and starting equipment', () => {
  const index = raw('background:all', `<div id="page-content"><table><tr><th>Name</th></tr><tr><td><a href="/background:acolyte">Acolyte</a></td></tr></table></div>`);
  const detail = raw('background:acolyte', `<div id="page-content"><p>Source: Player's Handbook</p><p>Temple description.</p>
    <p><strong>Ability Scores:</strong> Intelligence, Wisdom, Charisma<br><strong>Feat:</strong> <a href="/feat:magic-initiate">Magic Initiate (Cleric)</a><br>
    <strong>Skill Proficiencies:</strong> Insight and Religion<br><strong>Tool Proficiency:</strong> Calligrapher's Supplies<br>
    <strong>Equipment:</strong> Choose A or B: (A) Book, Robe, 8 GP; or (B) 50 GP</p></div>`);
  assert.deepEqual(catalogRecordLinks(index.html, 'background'), ['background:acolyte']);
  const [acolyte] = extractBackgroundCatalog(index, { 'background:acolyte': detail });
  assert.deepEqual(acolyte.abilityScores.map(({ id }) => id), ['int', 'wis', 'cha']);
  assert.deepEqual(acolyte.feat, { id: 'magic-initiate', name: 'Magic Initiate (Cleric)' });
  assert.deepEqual(acolyte.skillProficiencies.map(({ id }) => id), ['insight', 'religion']);
  assert.equal(acolyte.equipment.options[0].gold, 8);
  assert.equal(acolyte.equipment.options[1].gold, 50);
  assert.equal(acolyte.description, 'Temple description.');
  const abilityChoice = acolyte.choices.find(({ feature }) => feature === 'Ability Scores');
  assert.equal(abilityChoice.resolution, 'structured');
  assert.equal(abilityChoice.options.length, 7);
  assert.deepEqual(abilityChoice.options.find(({ id }) => id === 'acolyte-ability-scores-int-2-wis-1').effects, [
    { type: 'ability-score-increase', ability: 'int', amount: 2, maximum: 20 },
    { type: 'ability-score-increase', ability: 'wis', amount: 1, maximum: 20 },
  ]);
  assert.deepEqual(abilityChoice.options.find(({ id }) => id === 'acolyte-ability-scores-all-plus-1').effects, [
    { type: 'ability-score-increase', ability: 'int', amount: 1, maximum: 20 },
    { type: 'ability-score-increase', ability: 'wis', amount: 1, maximum: 20 },
    { type: 'ability-score-increase', ability: 'cha', amount: 1, maximum: 20 },
  ]);
  assert.equal(acolyte.choices.find(({ feature }) => feature === 'Starting Equipment').resolution, 'partial');
  assert.equal(acolyte.choices[0].sources[0].publication, "Player's Handbook");
  assert.deepEqual(validate('background', acolyte), []);
});

test('background links to the feat index do not become a bogus feat ID', () => {
  const index = raw('background:all', `<div id="page-content"><table><tr><th>Name</th></tr><tr><td><a href="/background:mist-wanderer">Mist Wanderer</a></td></tr></table></div>`);
  const detail = raw('background:mist-wanderer', `<div id="page-content"><p><strong>Feat:</strong> <a href="/feat:all">Dark Gift</a></p></div>`);
  const [background] = extractBackgroundCatalog(index, { 'background:mist-wanderer': detail });
  assert.deepEqual(background.feat, { id: null, name: 'Dark Gift' });
  assert.deepEqual(validate('background', background), []);
});

test('species catalog normalizes core traits and preserves named trait descriptions', () => {
  const index = raw('species:all', `<div id="page-content"><table><tr><th>Name</th></tr><tr><td><a href="/species:aasimar">Aasimar</a></td></tr></table></div>`);
  const detail = raw('species:aasimar', `<div id="page-content"><p>Source: Player's Handbook</p><p>Celestial-descended people.</p><h1>Aasimar Traits</h1>
    <p><strong>Creature Type:</strong> Humanoid<br><strong>Size:</strong> Medium or Small, chosen when you select this species<br><strong>Speed:</strong> 30 feet</p>
    <p>As an Aasimar, you have these special traits.</p><p><strong>Darkvision.</strong> You have Darkvision with a range of 60 feet.</p>
    <p>Choose a revelation:<br><strong>Heavenly Wings.</strong> You gain a Fly Speed.<br><strong>Inner Radiance.</strong> You emit light.</p></div>`);
  assert.deepEqual(catalogRecordLinks(index.html, 'species'), ['species:aasimar']);
  const [aasimar] = extractSpeciesCatalog(index, { 'species:aasimar': detail });
  assert.equal(aasimar.creatureType, 'Humanoid');
  assert.equal(aasimar.speed.walkingFeet, 30);
  assert.deepEqual(aasimar.traits.map(({ id, name, description }) => ({ id, name, description })), [
    { id: 'aasimar-darkvision', name: 'Darkvision', description: 'You have Darkvision with a range of 60 feet.' },
    { id: 'aasimar-heavenly-wings', name: 'Heavenly Wings', description: 'You gain a Fly Speed.' },
    { id: 'aasimar-inner-radiance', name: 'Inner Radiance', description: 'You emit light.' },
  ]);
  assert.ok(aasimar.traits.every((trait) => Array.isArray(trait.conditionEffects) && Array.isArray(trait.choices)));
  assert.equal(aasimar.choices[0].resolution, 'manual');
  assert.deepEqual(aasimar.choices[0].options, []);
  assert.deepEqual(validate('species', aasimar), []);
});

test('catalogs parse period-terminated species labels and singular background ability scores', () => {
  const backgroundIndex = raw('background:all', `<div id="page-content"><table><tr><th>Name</th></tr><tr><td><a href="/background:shadowmasters-exile">Shadowmasters Exile</a></td></tr></table></div>`);
  const backgroundDetail = raw('background:shadowmasters-exile', `<div id="page-content"><p>Source: Heroes of Faerun</p>
    <p><strong>Ability Score:</strong> Dexterity, Intelligence, Charisma</p><p>Feat: <a href="/feat:savage-attacker">Savage Attacker</a></p>
    <p><strong>Skill Proficiencies:</strong> Acrobatics and Stealth</p><p><strong>Equipment:</strong> Choose A or B: (A) Daggers, 10 GP; or (B) 50 GP</p></div>`);
  const [background] = extractBackgroundCatalog(backgroundIndex, { 'background:shadowmasters-exile': backgroundDetail });
  assert.deepEqual(background.abilityScores.map(({ id }) => id), ['dex', 'int', 'cha']);
  assert.deepEqual(background.feat, { id: 'savage-attacker', name: 'Savage Attacker' });
  assert.equal(background.choices.find(({ feature }) => feature === 'Ability Scores').resolution, 'structured');

  const speciesIndex = raw('species:all', `<div id="page-content"><table><tr><th>Name</th></tr><tr><td><a href="/species:boggart">Boggart</a></td></tr></table></div>`);
  const speciesDetail = raw('species:boggart', `<div id="page-content"><p>Source: Lorwyn - First Light</p><p>A folk of the wetlands.</p>
    <p><strong>Creature Type.</strong> You are a Humanoid. You are also considered a goblinoid.</p><p><strong>Size.</strong> You are Small (about 2–4 feet tall).</p>
    <p><strong>Speed.</strong> Your walking speed is 30 feet.</p><p><strong>Fury of the Small.</strong> Deal extra damage to a larger creature.<br>You can use this trait once per turn.</p></div>`);
  const [species] = extractSpeciesCatalog(speciesIndex, { 'species:boggart': speciesDetail });
  assert.equal(species.creatureType, 'Humanoid');
  assert.equal(species.size, 'Small (about 2–4 feet tall)');
  assert.equal(species.speed.walkingFeet, 30);
  assert.equal(species.description, 'A folk of the wetlands.');
  assert.deepEqual(species.traits.map(({ id, name, description }) => ({ id, name, description })), [{
    id: 'boggart-fury-of-the-small', name: 'Fury of the Small',
    description: 'Deal extra damage to a larger creature. You can use this trait once per turn.',
  }]);
});

test('background ability-score choice stays manual unless exactly three distinct abilities are listed', () => {
  const index = raw('background:all', `<div id="page-content"><table><tr><th>Name</th></tr><tr><td><a href="/background:oddity">Oddity</a></td></tr></table></div>`);
  const detail = raw('background:oddity', `<div id="page-content"><p>Source: Test Source</p>
    <p><strong>Ability Scores:</strong> Strength and Wisdom</p></div>`);
  const [background] = extractBackgroundCatalog(index, { 'background:oddity': detail });
  const choice = background.choices.find(({ feature }) => feature === 'Ability Scores');
  assert.equal(choice.resolution, 'manual');
  assert.deepEqual(choice.options, []);
  assert.match(choice.unresolvedReason, /not safely normalized/);
  assert.deepEqual(validate('background', background), []);

  const extraDetail = raw('background:oddity', `<div id="page-content"><p>Source: Test Source</p>
    <p><strong>Ability Scores:</strong> Strength, Wisdom, Charisma, Grit</p></div>`);
  const [extraCandidateBackground] = extractBackgroundCatalog(index, { 'background:oddity': extraDetail });
  assert.equal(extraCandidateBackground.choices.find(({ feature }) => feature === 'Ability Scores').resolution, 'manual');
});

test('background tool proficiency choices resolve known categories and preserve unknown choices as manual', () => {
  const index = raw('background:all', `<div id="page-content"><table><tr><th>Name</th></tr>
    <tr><td><a href="/background:artisan-choice">Artisan Choice</a></td></tr>
    <tr><td><a href="/background:haunted-choice">Haunted Choice</a></td></tr>
    <tr><td><a href="/background:unknown-choice">Unknown Choice</a></td></tr></table></div>`);
  const details = {
    'background:artisan-choice': raw('background:artisan-choice', `<div id="page-content"><p>Source: Test</p><p><strong>Tool Proficiencies:</strong> Choose one kind of Artisan’s Tools</p></div>`),
    'background:haunted-choice': raw('background:haunted-choice', `<div id="page-content"><p>Source: Test</p><p><strong>Tool Proficiencies:</strong> Choose one kind of Gaming Set</p></div>`),
    'background:unknown-choice': raw('background:unknown-choice', `<div id="page-content"><p>Source: Test</p><p><strong>Tool Proficiency:</strong> Choose one kind of a special kit</p></div>`),
  };
  const backgrounds = extractBackgroundCatalog(index, details);
  const artisan = backgrounds.find(({ id }) => id === 'artisan-choice');
  const artisanChoice = artisan.choices.find(({ feature }) => feature === 'Tool Proficiency');
  assert.equal(artisanChoice.resolution, 'structured');
  assert.equal(artisanChoice.selection.count, 1);
  assert.equal(artisanChoice.options.length, 17);
  assert.deepEqual(artisanChoice.options.find(({ id }) => id === 'tool-calligraphers-supplies').effects, [
    { type: 'proficiency-grant', proficiency: { type: 'tool', id: 'calligraphers-supplies', name: 'Calligrapher’s supplies' } },
  ]);

  const haunted = backgrounds.find(({ id }) => id === 'haunted-choice');
  assert.equal(haunted.toolProficiency, 'Choose one kind of Gaming Set');
  const gamingChoice = haunted.choices.find(({ feature }) => feature === 'Tool Proficiency');
  assert.equal(gamingChoice.resolution, 'structured');
  assert.deepEqual(gamingChoice.options.map(({ label }) => label), ['Dice', 'Dragonchess', 'Playing Cards', 'Three-dragon Ante']);

  const unknown = backgrounds.find(({ id }) => id === 'unknown-choice');
  const unknownChoice = unknown.choices.find(({ feature }) => feature === 'Tool Proficiency');
  assert.equal(unknownChoice.resolution, 'manual');
  assert.deepEqual(unknownChoice.options, []);
  for (const background of backgrounds) assert.deepEqual(validate('background', background), []);
});

test('equipment catalog normalizes values while retaining source table fields', () => {
  const armor = raw('equipment:armor', `<div id="page-content"><h2>Light Armor</h2><table><tr><th>Armor</th><th>Armor Class (AC)</th><th>Weight</th><th>Cost</th></tr>
    <tr><td>Leather Armor</td><td>11 + Dex modifier</td><td>10 lb.</td><td>10 GP</td></tr></table></div>`);
  const weapons = raw('equipment:weapon', `<div id="page-content"><h2>Simple Weapons</h2><table><tr><th>Simple Melee Weapons Name</th><th>Simple Melee Weapons Damage</th><th>Simple Melee Weapons Properties</th><th>Simple Melee Weapons Mastery</th><th>Simple Melee Weapons Weight</th><th>Simple Melee Weapons Cost</th></tr>
    <tr><td>Dagger</td><td>1d4 Piercing</td><td>Finesse, Light, Thrown (Range 20/60)</td><td>Nick</td><td>1 lb.</td><td>2 GP</td></tr></table></div>`);
  const items = extractEquipmentCatalog([armor, weapons]);
  const item = items.find(({ name }) => name === 'Leather Armor');
  assert.equal(item.category, 'armor');
  assert.equal(item.subcategory, 'Light Armor');
  assert.equal(item.cost.copperValue, 1000);
  assert.equal(item.weight.pounds, 10);
  assert.equal(item.properties['armor-class-ac'], '11 + Dex modifier');
  assert.deepEqual(item.armorClass, { raw: '11 + Dex modifier', base: 11, bonus: null, dexterityModifier: true, maxDexterityModifier: null });
  assert.deepEqual(validate('equipment', item), []);
  const dagger = items.find(({ name }) => name === 'Dagger');
  assert.deepEqual(dagger.damage, { raw: '1d4 Piercing', dice: { count: 1, sides: 4 }, flat: 0, damageType: 'piercing' });
  assert.deepEqual(dagger.weaponProperties.map(({ id }) => id), ['finesse', 'light', 'thrown']);
  assert.equal(dagger.mastery, 'Nick');
  assert.deepEqual(validate('equipment', dagger), []);
});
