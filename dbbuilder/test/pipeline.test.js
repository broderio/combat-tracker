import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RawCache, cached } from '../src/cache.js';
import { HttpError, createFetcher } from '../src/fetcher.js';
import { createWikidotSource, rawPageFromHtml } from '../src/sources/wikidot.js';
import { buildClasses, deepMerge } from '../src/build.js';
import {
  backgroundSchema, characterSchema, classSchema, equipmentSchema, featSchema, monsterSchema,
  RULES_SCHEMA_VERSION, speciesSchema, spellSchema, subclassSchema, validate,
} from '../src/schema/schemas.js';
import { casterPage, fighterPage } from './helpers.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'dbbuild-'));

test('cached(): producer runs once; second call is served from disk, even from a new cache object', async () => {
  const dir = await tmp(); let calls = 0;
  const producer = async () => { calls++; return { a: 1 }; };
  assert.equal((await cached(new RawCache(dir, 's'), 'Page One', producer)).fromCache, false);
  assert.equal((await cached(new RawCache(dir, 's'), 'Page One', producer)).fromCache, true);
  assert.equal(calls, 1);
});

test('cached(): a failing producer caches nothing, so the next attempt retries', async () => {
  const cache = new RawCache(await tmp(), 's'); let calls = 0;
  await assert.rejects(cached(cache, 'P', async () => { calls++; throw new Error('boom'); }));
  await cached(cache, 'P', async () => { calls++; return 1; });
  assert.equal(calls, 2);
});

test('fetcher: retries 503 with backoff, then succeeds', async () => {
  const sleeps = []; let n = 0;
  const get = createFetcher({
    userAgent: 'ua', delayMs: 0, sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => (++n < 3 ? { ok: false, status: 503, headers: new Headers() } : { ok: true, text: async () => '<html>done</html>' }),
  });
  assert.equal(await get('http://x'), '<html>done</html>');
  assert.deepEqual(sleeps.filter((s) => s > 0), [2000, 4000]);
});

test('fetcher: a 402/403 is not retried and explains the import-html fallback', async () => {
  let n = 0;
  const get = createFetcher({ userAgent: 'ua', delayMs: 0, sleep: async () => {}, fetchImpl: async () => { n++; return { ok: false, status: 402, headers: new Headers() }; } });
  await assert.rejects(get('http://x'), (e) => e instanceof HttpError && /import-html/.test(e.message));
  assert.equal(n, 1);
});

test('Wikidot source: fetches a page ID as HTML once and caches provenance with it', async () => {
  const cache = new RawCache(await tmp(), 'wikidot'); const urls = [];
  const src = createWikidotSource({
    id: 'wikidot', baseUrl: 'https://dnd2024.wikidot.com', cache,
    getText: async (url) => { urls.push(url); return '<div id="page-content">rules</div>'; },
  });
  const first = await src.getPage('fighter:main');
  const second = await src.getPage('fighter:main');
  assert.equal(urls.length, 1);
  assert.equal(urls[0], 'https://dnd2024.wikidot.com/fighter:main');
  assert.equal(first.value.title, 'Fighter');
  assert.equal(first.value.url, urls[0]);
  assert.equal(first.value.html, second.value.html);
  assert.equal(second.fromCache, true);
});

test('deepMerge: objects merge, arrays and scalars replace', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: [1] }, d: 1 }, { a: { c: [2, 3] }, e: 2 }), { a: { b: 1, c: [2, 3] }, d: 1, e: 2 });
});

async function seed(dir, pages) {
  const cache = new RawCache(dir, 'wiki');
  for (const [title, html] of Object.entries(pages)) await cache.put(title, rawPageFromHtml({ source: 'wiki', title, html }));
  return cache;
}
const cfg = (names) => ({
  source: 'wiki', edition: '2024', classes: { names, titleTemplate: '{name}', titles: {} },
  subclasses: { linkPattern: null, pages: {} }, multiclass: { page: null },
});

test('build: writes the documented layout from the raw cache only, and reports rejected classes', async () => {
  const dir = await tmp(); const outDir = path.join(dir, 'out');
  const rawCache = await seed(path.join(dir, 'raw'), { Fighter: fighterPage(), Wizard: casterPage('full') /* Warlock deliberately absent */ });
  const report = await buildClasses({ config: cfg(['Fighter', 'Wizard', 'Warlock']), rawCache, outDir, overridesDir: null });

  assert.deepEqual(report.summary, { classesOk: 2, classesRejected: 1, subclassesOk: 3, subclassesRejected: 0, spells: 0, feats: 0, equipment: 0, backgrounds: 0, species: 0 });
  assert.ok(report.choiceAudit.summary.choices > 0);
  assert.ok(report.choiceAudit.choices.every(({ id, path, resolution }) => id && path && ['structured', 'partial', 'manual'].includes(resolution)));
  await fs.access(path.join(outDir, '_reports/choice-audit.json'));
  assert.match(report.classes.warlock.errors[0], /not in raw cache/);
  const index = JSON.parse(await fs.readFile(path.join(outDir, 'index.json'), 'utf8'));
  assert.deepEqual(index.classes.map((c) => c.id), ['fighter', 'wizard']);
  assert.equal(index.schemaVersion, RULES_SCHEMA_VERSION);
  assert.equal(index.catalogs.spells.path, 'spells/index.json');
  const champion = path.join(outDir, index.classes[0].subclasses[0].path);
  assert.equal(JSON.parse(await fs.readFile(champion, 'utf8')).classId, 'fighter');
  const fighter = JSON.parse(await fs.readFile(path.join(outDir, 'classes/fighter/class.json'), 'utf8'));
  assert.equal(fighter.hitDie, 10);
  const expectedSchemas = {
    'class.schema.json': classSchema, 'subclass.schema.json': subclassSchema, 'character.schema.json': characterSchema,
    'spell.schema.json': spellSchema, 'feat.schema.json': featSchema, 'equipment.schema.json': equipmentSchema,
    'background.schema.json': backgroundSchema, 'species.schema.json': speciesSchema,
  };
  for (const [file, schema] of Object.entries(expectedSchemas)) {
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(outDir, 'schema', file), 'utf8')), schema);
  }
});

test('build: incomplete pages land in _reports/rejected, never in classes/', async () => {
  const dir = await tmp(); const outDir = path.join(dir, 'out');
  const rawCache = await seed(path.join(dir, 'raw'), { Fighter: fighterPage({ omit: ['core'] }) });
  const report = await buildClasses({ config: cfg(['Fighter']), rawCache, outDir, overridesDir: null });
  assert.equal(report.classes.fighter.status, 'rejected');
  await assert.rejects(fs.access(path.join(outDir, 'classes/fighter/class.json')));
  await fs.access(path.join(outDir, '_reports/rejected/classes/fighter.json'));
});

test('strict build rejects schema-invalid records after writing reports', async () => {
  const dir = await tmp(); const outDir = path.join(dir, 'out');
  const rawCache = await seed(path.join(dir, 'raw'), { Fighter: fighterPage({ omit: ['core'] }) });
  await assert.rejects(
    buildClasses({ config: cfg(['Fighter']), rawCache, outDir, overridesDir: null, strictRecords: true }),
    /schema-rejected records/,
  );
  const report = JSON.parse(await fs.readFile(path.join(outDir, '_reports/classes.json'), 'utf8'));
  assert.equal(report.summary.classesRejected, 1);
});

test('build: a manual override can repair a rejected class without touching code', async () => {
  const dir = await tmp(); const outDir = path.join(dir, 'out'); const ov = path.join(dir, 'overrides');
  const rawCache = await seed(path.join(dir, 'raw'), { Fighter: fighterPage({ omit: ['core'] }) });
  await fs.mkdir(path.join(ov, 'classes'), { recursive: true });
  await fs.writeFile(path.join(ov, 'classes/fighter.json'), JSON.stringify({
    primaryAbility: { abilities: ['str'], join: null }, hitDie: 10, savingThrows: ['str', 'con'],
    proficiencies: { weapons: { categories: ['simple', 'martial'] }, skills: { choose: 2, from: ['Athletics'] } },
    startingEquipment: { options: [{ id: 'A', raw: 'x', items: [], gold: 155 }] },
  }));
  const report = await buildClasses({ config: cfg(['Fighter']), rawCache, outDir, overridesDir: ov });
  assert.equal(report.classes.fighter.status, 'ok');
  assert.ok(report.classes.fighter.warnings.includes('manual override applied'));
});

test('build: rebuilding is deterministic apart from index.generatedAt', async () => {
  const dir = await tmp(); const rawCache = await seed(path.join(dir, 'raw'), { Fighter: fighterPage() });
  const read = async (out) => fs.readFile(path.join(out, 'classes/fighter/class.json'), 'utf8');
  const a = path.join(dir, 'a'); const b = path.join(dir, 'b');
  await buildClasses({ config: cfg(['Fighter']), rawCache, outDir: a, overridesDir: null });
  await buildClasses({ config: cfg(['Fighter']), rawCache, outDir: b, overridesDir: null });
  assert.equal(await read(a), await read(b));
});

test('build: emits compact spell, feat, and equipment catalogs for tracker search', async () => {
  const dir = await tmp(); const outDir = path.join(dir, 'out');
  const pages = {
    Fighter: fighterPage(),
    'spell:all': `<div id="page-content"><div class="yui-navset"><ul class="yui-nav"><li>Cantrip</li></ul><div class="yui-content"><div id="wiki-tab-0-0"><table><tr><th>Name</th><th>School</th><th>Spell lists</th><th>Casting Time</th><th>Range</th><th>Components</th><th>Duration</th></tr><tr><td><a href="/spell:acid-splash">Acid Splash</a></td><td>Evocation</td><td>Wizard</td><td>Action</td><td>60 feet</td><td>V, S</td><td>Instantaneous</td></tr></table></div></div></div>`,
    'spell:acid-splash': `<div id="page-content"><p>Source: PHB</p><p><em>Evocation Cantrip (Wizard)</em></p><p><strong>Casting Time:</strong> Action<br><strong>Range:</strong> 60 feet<br><strong>Components:</strong> V, S<br><strong>Duration:</strong> Instantaneous</p><p>A useful spell.</p></div>`,
    'feat:all': `<div id="page-content"><h1>Origin Feats</h1><div class="yui-navset"><ul class="yui-nav"><li>Common</li></ul><div class="yui-content"><div id="wiki-tab-0-0"><table><tr><th>Name</th></tr><tr><td><a href="/feat:alert">Alert</a></td></tr></table></div></div></div></div>`,
    'feat:alert': `<div id="page-content"><p>Source: PHB</p><p><strong>Initiative Proficiency.</strong> Improve Initiative.</p></div>`,
    'equipment:all': `<div id="page-content"><a href="/equipment:tool">Tools</a></div>`,
    'equipment:tool': `<div id="page-content"><h2>Tools</h2><table><tr><th>Item</th><th>Weight</th><th>Cost</th></tr><tr><td>Thieves' Tools</td><td>1 lb.</td><td>25 GP</td></tr></table></div>`,
    'background:all': `<div id="page-content"><table><tr><th>Name</th></tr><tr><td><a href="/background:acolyte">Acolyte</a></td></tr></table></div>`,
    'background:acolyte': `<div id="page-content"><p>Source: PHB</p><p>A devoted servant.</p><p><strong>Ability Scores:</strong> Intelligence, Wisdom, Charisma<br><strong>Feat:</strong> <a href="/feat:magic-initiate">Magic Initiate</a><br><strong>Skill Proficiencies:</strong> Insight and Religion<br><strong>Tool Proficiency:</strong> Calligrapher's Supplies<br><strong>Equipment:</strong> Choose A or B: (A) Book, Robe, 8 GP; or (B) 50 GP</p></div>`,
    'species:all': `<div id="page-content"><table><tr><th>Name</th></tr><tr><td><a href="/species:aasimar">Aasimar</a></td></tr></table></div>`,
    'species:aasimar': `<div id="page-content"><p>Source: PHB</p><p>Celestial-descended people.</p><h1>Aasimar Traits</h1><p><strong>Creature Type:</strong> Humanoid<br><strong>Size:</strong> Medium or Small<br><strong>Speed:</strong> 30 feet</p><p><strong>Darkvision.</strong> You see in the dark.</p></div>`,
  };
  const rawCache = await seed(path.join(dir, 'raw'), pages);
  const config = {
    ...cfg(['Fighter']),
    catalogs: {
      spells: { index: 'spell:all' }, feats: { index: 'feat:all' },
      equipment: { index: 'equipment:all', pages: ['equipment:tool'] },
      backgrounds: { index: 'background:all' }, species: { index: 'species:all' },
    },
  };
  const report = await buildClasses({ config, rawCache, outDir, overridesDir: null });
  assert.deepEqual([report.summary.spells, report.summary.feats, report.summary.equipment], [1, 1, 1]);
  const rootIndex = JSON.parse(await fs.readFile(path.join(outDir, 'index.json'), 'utf8'));
  assert.deepEqual(Object.keys(rootIndex.catalogs), ['spells', 'feats', 'equipment', 'backgrounds', 'species']);
  const spellIndex = JSON.parse(await fs.readFile(path.join(outDir, 'spells/index.json'), 'utf8'));
  assert.equal(Object.hasOwn(spellIndex, 'facets'), false);
  assert.equal(spellIndex.items[0].path, 'spells/acid-splash.json');
  assert.equal(spellIndex.items[0].sources[0].publication, 'PHB');
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(path.join(outDir, 'spells/acid-splash.json'), 'utf8')), 'path'), false);
  const feat = JSON.parse(await fs.readFile(path.join(outDir, 'feats/alert.json'), 'utf8'));
  assert.equal(feat.benefits[0].name, 'Initiative Proficiency');
  const tool = JSON.parse(await fs.readFile(path.join(outDir, 'equipment/thieves-tools.json'), 'utf8'));
  assert.equal(tool.cost.copperValue, 2500);
  assert.equal(Object.hasOwn(tool, 'path'), false);
  const backgroundIndex = JSON.parse(await fs.readFile(path.join(outDir, 'backgrounds/index.json'), 'utf8'));
  assert.equal(Object.hasOwn(backgroundIndex, 'facets'), false);
  assert.equal(backgroundIndex.items[0].sources[0].publication, 'PHB');
  assert.equal(JSON.parse(await fs.readFile(path.join(outDir, 'backgrounds/acolyte.json'), 'utf8')).feat.id, 'magic-initiate');
  const species = JSON.parse(await fs.readFile(path.join(outDir, 'species/aasimar.json'), 'utf8'));
  assert.equal(species.speed.walkingFeet, 30);
});

test('build: emits the separately cached Aidedd monster catalog and manifest entry', async () => {
  const dir = await tmp(); const outDir = path.join(dir, 'out');
  const config = cfg([]); config.monsters = { source: 'aidedd-monsters' };
  const rawCache = await seed(path.join(dir, 'wiki-raw'), {});
  const monsterCache = await seed(path.join(dir, 'aidedd-raw'), {
    'monster:all': `<table id="liste"><tbody><tr><td class="item"><a href="/monster/aboleth">Aboleth</a></td>
      <td><span class="tag2">10</span></td><td class="colT"><span class="tag1">Aberration</span></td>
      <td class="colD"><span class="tag3">Large</span></td><td class="colP">17</td><td class="colP">150</td>
      <td class="colQ">swim</td><td class="colC">21</td><td class="colC">9</td><td class="colC">15</td>
      <td class="colC">18</td><td class="colC">15</td><td class="colC">18</td><td class="colA">Lawful Evil</td>
      <td class="colL">Legendary</td><td class="colH"><span class="tag2">Underdark</span></td>
      <td class="colS"><span class="tagS">Monster Manual 2024</span></td></tr></tbody></table>`,
    'monster:aboleth': `<div class="jaune"><h1>Aboleth</h1><div class="red"><div class="init"><strong>Initiative</strong> +7 (17)</div>
      <strong>AC</strong> 17<br><strong>HP</strong> 150 (20d10 + 40)<br><strong>Speed</strong> 10 ft., Swim 40 ft.<br>
      <div class="car1">Str</div><div class="car2">21</div><div class="car3">+5</div><div class="car3">+5</div>
      <div class="car1">Dex</div><div class="car2">9</div><div class="car3">-1</div><div class="car3">+3</div>
      <div class="car1">Con</div><div class="car2">15</div><div class="car3">+2</div><div class="car3">+6</div>
      <div class="car4">Int</div><div class="car5">18</div><div class="car6">+4</div><div class="car6">+8</div>
      <div class="car4">Wis</div><div class="car5">15</div><div class="car6">+2</div><div class="car6">+6</div>
      <div class="car4">Cha</div><div class="car5">18</div><div class="car6">+4</div><div class="car6">+4</div><br>
      <strong>CR</strong> 10 (XP 5 900; PB +4)</div><h2 class="rub">Actions</h2><p><strong><em>Tentacle</em></strong>. Attack text.</p>
      <p><strong><em>Spellcasting</em></strong>. It casts spells using Wisdom as the spellcasting ability (spell save DC 12):</p>
      At will: <em><a href="/spell/unpublished-spell">Unpublished Spell</a></em><br></div>`,
  });
  const report = await buildClasses({ config, rawCache, monsterCache, outDir, overridesDir: null });
  assert.equal(report.summary.monsters, 1);
  assert.equal(report.catalogs.monsters.missingDetails, 0);
  assert.deepEqual(report.catalogs.monsters.rejected, []);
  const rootIndex = JSON.parse(await fs.readFile(path.join(outDir, 'index.json'), 'utf8'));
  assert.equal(rootIndex.catalogs.monsters.path, 'monsters/index.json');
  assert.equal(rootIndex.catalogs.monsters.count, 1);
  const record = JSON.parse(await fs.readFile(path.join(outDir, 'monsters/aboleth.json'), 'utf8'));
  assert.equal(record.hitPoints.average, 150);
  assert.equal(Object.hasOwn(record, 'path'), false);
  assert.deepEqual(record.abilities.actions.map(({ name }) => name), ['Tentacle', 'Spellcasting']);
  const spellcasting = record.abilities.actions[1].feature;
  assert.equal(spellcasting.resolution, 'partial');
  assert.deepEqual(spellcasting.spellcasting.spellsByFrequency, [{ frequency: 'At will', spellIds: [] }]);
  assert.deepEqual(report.catalogs.monsters.unresolvedSpellLinks.map(({ spellIds }) => spellIds), [['unpublished-spell']]);
  assert.match(spellcasting.description, /Unpublished Spell/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(outDir, 'schema/monster.schema.json'), 'utf8')), monsterSchema);
});

test('checked-in generated rules validate every detail record and indexed path', async () => {
  const rulesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dbbuilder/data/rules');
  const manifest = JSON.parse(await fs.readFile(path.join(rulesDir, 'index.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, RULES_SCHEMA_VERSION);

  const checked = { classes: 0, subclasses: 0, catalogs: 0 };
  for (const classEntry of manifest.classes) {
    const classRecord = JSON.parse(await fs.readFile(path.join(rulesDir, classEntry.path), 'utf8'));
    assert.deepEqual(validate('class', classRecord), [], `class ${classEntry.id}`);
    assert.equal(classRecord.id, classEntry.id);
    checked.classes += 1;
    for (const subclass of classRecord.subclasses) {
      const record = JSON.parse(await fs.readFile(path.join(rulesDir, 'classes', classEntry.id, subclass.path), 'utf8'));
      assert.deepEqual(validate('subclass', record), [], `subclass ${classEntry.id}/${subclass.id}`);
      assert.equal(record.classId, classEntry.id);
      checked.subclasses += 1;
    }
  }

  const catalogValidators = {
    spells: 'spell', feats: 'feat', equipment: 'equipment', backgrounds: 'background',
    species: 'species', monsters: 'monster',
  };
  for (const [catalogId, kind] of Object.entries(catalogValidators)) {
    const catalogEntry = manifest.catalogs[catalogId];
    const index = JSON.parse(await fs.readFile(path.join(rulesDir, catalogEntry.path), 'utf8'));
    assert.equal(index.schemaVersion, RULES_SCHEMA_VERSION, `${catalogId} index version`);
    assert.equal(index.items.length, catalogEntry.count, `${catalogId} index count`);
    for (const item of index.items) {
      const record = JSON.parse(await fs.readFile(path.join(rulesDir, item.path), 'utf8'));
      assert.deepEqual(validate(kind, record), [], `${catalogId}/${item.id}`);
      assert.equal(record.id, item.id);
      checked.catalogs += 1;
    }
  }

  const linkAudit = JSON.parse(await fs.readFile(path.join(rulesDir, '_reports/link-integrity.json'), 'utf8'));
  assert.deepEqual(linkAudit.issues, []);
  assert.equal(linkAudit.checkedClassRecords, checked.classes);
  assert.equal(linkAudit.checkedCatalogRecords, checked.catalogs);
  assert.deepEqual(checked, { classes: 13, subclasses: 77, catalogs: 1593 });
});
