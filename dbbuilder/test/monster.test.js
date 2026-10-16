import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RawCache } from '../src/cache.js';
import { createFetcher } from '../src/fetcher.js';
import { extractMonsterDetail, extractMonsterIndex } from '../src/parse/monsterExtractor.js';
import { validate } from '../src/schema/schemas.js';
import { createAideddSource } from '../src/sources/aidedd.js';

const indexHtml = `<table id="liste"><tbody><tr><td class="item"><a href="/monster/aboleth">Aboleth</a></td>
  <td><span class="tag2">10</span></td><td class="colT"><span class="tag1">Aberration</span></td>
  <td class="colD"><span class="tag3">Large</span></td><td class="colP">17</td><td class="colP">150</td>
  <td class="colQ">swim</td><td class="colC">21</td><td class="colC">9</td><td class="colC">15</td>
  <td class="colC">18</td><td class="colC">15</td><td class="colC">18</td><td class="colA">Lawful Evil</td>
  <td class="colL">Legendary</td><td class="colH"><span class="tag2">Underdark, Underwater</span></td>
  <td class="colS"><span class="tagS">Monster Manual 2024</span></td></tr></tbody></table>`;

const detailHtml = `<div class="jaune"><h1>Aboleth</h1><div class="sansSerif"><div class="red">
  <div class="type">Large Aberration, Lawful Evil</div><div class="init"><strong>Initiative</strong> +7 (17)</div>
  <strong>AC</strong> 17<br><strong>HP</strong> 150 (20d10 + 40)<br><strong>Speed</strong> 10 ft., Swim 40 ft.<br>
  <div class="car1">Str</div><div class="car2">21</div><div class="car3">+5</div><div class="car3">+5</div>
  <div class="car1">Dex</div><div class="car2">9</div><div class="car3">-1</div><div class="car3">+3</div>
  <div class="car1">Con</div><div class="car2">15</div><div class="car3">+2</div><div class="car3">+6</div>
  <div class="car4">Int</div><div class="car5">18</div><div class="car6">+4</div><div class="car6">+8</div>
  <div class="car4">Wis</div><div class="car5">15</div><div class="car6">+2</div><div class="car6">+6</div>
  <div class="car4">Cha</div><div class="car5">18</div><div class="car6">+4</div><div class="car6">+4</div><br>
  <strong>Skills</strong> History +12, Perception +10<br><strong>Senses</strong> Darkvision 120 ft., Passive Perception 20<br>
  <strong>Languages</strong> Deep Speech; telepathy 120 ft.<br><strong>CR</strong> 10 (XP 5 900; PB +4)
  </div><h2 class="rub">Traits</h2><p><strong><em>Ethereal Sight</em></strong>. The ghost can see 60 feet into the Ethereal Plane when it is on the Material Plane.</p>
  <p><strong><em>Mucus Cloud</em></strong>. DC 14 Constitution Saving Throw. Failure: The target takes 6 (1d12) Acid damage.</p>
  <p><strong><em>Vampire Weakness</em></strong>. The vampire has these weaknesses:</p>
  <p><strong><em>&nbsp; Forbiddance</em></strong>. The vampire can't enter a residence without an invitation.</p>
  <p><strong><em>&nbsp; Running Water</em></strong>. The vampire takes 20 Acid damage if it ends its turn in running water.</p>
  <h2 class="rub">Actions</h2><p><strong><em>Multiattack</em></strong>. It makes two Tentacle attacks. It can replace any attack with Psychic Drain.</p>
  <p><strong><em>Tentacle</em></strong>. Melee Attack Roll: +9, reach 15 ft. Hit: 12 (2d6 + 5) Bludgeoning damage.</p>
  <p><strong><em>Spellcasting</em></strong>. It casts one of the following spells, using Wisdom as the spellcasting ability (spell save DC 16):</p>At will: <em><a href="/spell/detect-thoughts">Detect Thoughts</a>, <a href="/spell/minor-illusion">Minor Illusion</a></em><br>
  <p><strong><em>Web</em></strong>. Recharge 5–6. Ranged Attack Roll: +5, range 30/60 ft. Hit: The target is Prone.</p>
  <p><strong><em>Limited Use (3/Day)</em></strong>. This ability has three daily uses.</p>
  <h2 class="rub">Legendary actions</h2><p>Legendary Action Uses: 3.</p><p><strong><em>Psychic Drain</em></strong>. It regains 5 (1d10) Hit Points.</p>
  <h2 class="rub">Reactions</h2><p><strong><em>Counterspell (1/Day)</em></strong>. It counters a spell.</p></div></div>`;

test('Aidedd monster parser extracts ability names and structured roll mechanics', () => {
  const [listed] = extractMonsterIndex(indexHtml);
  assert.equal(listed.id, 'aboleth');
  assert.equal(listed.challengeRating.numeric, 10);
  assert.equal(listed.armorClass.value, 17);
  assert.equal(listed.hitPoints.average, 150);

  const record = extractMonsterDetail(listed, {
    source: 'aidedd-monsters', title: 'Aboleth', url: listed.detailUrl, fetchedAt: '2026-10-02T00:00:00.000Z', html: detailHtml,
  });
  assert.equal(record.initiative.score, 17);
  assert.equal(record.experiencePoints, 5900);
  assert.equal(record.proficiencyBonus, 4);
  assert.deepEqual(record.hitPoints, { raw: '150 (20d10 + 40)', average: 150, hitDice: '20d10 + 40' });
  assert.deepEqual(record.speed.modes, [{ mode: 'walk', feet: 10 }, { mode: 'swim', feet: 40 }]);
  assert.deepEqual(record.abilityScores.dex, { score: 9, modifier: -1, savingThrow: 3 });
  assert.deepEqual(record.skills, [{ name: 'History', bonus: 12 }, { name: 'Perception', bonus: 10 }]);
  assert.equal(record.abilities.traits[0].feature.description, 'The ghost can see 60 feet into the Ethereal Plane when it is on the Material Plane.');
  assert.equal(record.abilities.traits[2].feature.description, 'The vampire has these weaknesses: Forbiddance: The vampire can\'t enter a residence without an invitation. Running Water: The vampire takes 20 Acid damage if it ends its turn in running water.');
  assert.equal(record.abilities.traits[2].id, 'vampire-weakness');
  assert.deepEqual(record.abilities.traits[1].feature.save, { ability: 'con', dcFormula: { kind: 'fixed', value: 14 } });
  assert.deepEqual(record.abilities.traits[1].feature.damage, [{ formula: '1d12', damageType: 'acid', onSave: null }]);
  assert.equal(record.abilities.actions[0].feature.resolution, 'partial');
  assert.deepEqual(record.abilities.actions[1].feature.attackRoll, { type: 'melee', kind: 'unknown', ability: null, bonus: 9 });
  assert.deepEqual(record.abilities.actions[1].feature.range, { kind: 'reach', distance: 15, unit: 'feet' });
  assert.deepEqual(record.abilities.actions[1].feature.damage, [{ formula: '2d6+5', damageType: 'bludgeoning', onSave: null }]);
  assert.equal(record.abilities.actions[1].feature.id, 'aboleth-tentacle');
  assert.equal(record.abilities.actions[1].feature.resolution, 'partial');
  assert.deepEqual(record.abilities.actions[2].feature.spellcasting, {
    ability: 'Wisdom', saveDC: 16,
    spellsByFrequency: [{ frequency: 'At will', spellIds: ['detect-thoughts', 'minor-illusion'] }],
  });
  assert.deepEqual(record.abilities.actions[3].feature.range, { kind: 'range', distance: 30, unit: 'feet' });
  assert.deepEqual(record.abilities.actions[3].feature.conditionEffects, [{ condition: 'prone', duration: null }]);
  assert.deepEqual(record.abilities.actions[3].feature.recharge, { kind: 'roll', minimumRoll: 5 });
  assert.deepEqual(record.abilities.actions[4].feature.uses, { maximum: 3, period: 'day' });
  assert.deepEqual(record.abilities.legendaryActions[0].feature.healing, [{ formula: '1d10', onSave: null }]);
  for (const abilities of Object.values(record.abilities).filter(Array.isArray)) {
    for (const entry of abilities) {
      assert.equal(typeof entry.feature.description, 'string', `${entry.name} must retain its plain-text description`);
      assert.ok(!Object.hasOwn(entry, 'sourceHtml'), `${entry.name} must not retain source HTML`);
      assert.deepEqual(Object.keys(entry).sort(), ['feature', 'id', 'name']);
    }
  }
  assert.deepEqual(validate('monster', record), []);
  const unicodeMinus = detailHtml.replace('<div class="car6">+4</div><div class="car6">+8</div>', '<div class="car6">–4</div><div class="car6">–4</div>');
  assert.equal(extractMonsterDetail(listed, { html: unicodeMinus }).abilityScores.int.modifier, -4);
  const summaryOnly = extractMonsterDetail(listed, { html: '<title>Error</title><p>Not found</p>' });
  assert.equal(summaryOnly.detailAvailable, false);
  assert.equal(summaryOnly.armorClass.value, 17);
  assert.deepEqual(validate('monster', summaryOnly), []);
});

test('Aidedd source POSTs the full catalog and caches individual detail pages', async () => {
  const cache = new RawCache(await fs.mkdtemp(path.join(os.tmpdir(), 'aidedd-')), 'aidedd-monsters');
  const requests = [];
  const source = createAideddSource({
    cache, getText: async (url, request) => { requests.push({ url, request }); return `<html>${requests.length}</html>`; },
  });
  const index = await source.getPage('monster:all');
  const detail = await source.getPage('monster:aboleth');
  assert.equal(requests[0].url, 'https://www.aidedd.org/monster/');
  assert.equal(requests[0].request.method, 'POST');
  assert.match(requests[0].request.body, /limit=500/);
  assert.equal(requests[1].url, 'https://www.aidedd.org/monster/aboleth');
  assert.equal(requests[1].request.method, undefined);
  assert.equal((await source.getPage('monster:all')).fromCache, true);
  assert.equal(index.value.source, 'aidedd-monsters');
  assert.equal(detail.value.requestedTitle, 'monster:aboleth');
});

test('Aidedd source uses canonical Will-o-Wisp URL and replaces stale URL cache', async () => {
  const cache = new RawCache(await fs.mkdtemp(path.join(os.tmpdir(), 'aidedd-')), 'aidedd-monsters');
  const requests = [];
  const source = createAideddSource({
    cache, getText: async (url) => { requests.push(url); return '<html>Will-o-Wisp stat block</html>'; },
  });
  await cache.put('monster:will-o-wisp', {
    source: 'aidedd-monsters', requestedTitle: 'monster:will-o-wisp',
    url: 'https://www.aidedd.org/monster/will-o-wisp', html: '<html>Error</html>',
  });

  const detail = await source.getPage('monster:will-o-wisp');
  assert.equal(requests[0], 'https://www.aidedd.org/monster/will-o--wisp');
  assert.equal(detail.value.url, 'https://www.aidedd.org/monster/will-o--wisp');
  assert.equal(detail.fromCache, false);
  assert.equal((await source.getPage('monster:will-o-wisp')).fromCache, true);
});

test('fetcher forwards form requests and sets the expected URL-encoded content type', async () => {
  let request;
  const getText = createFetcher({
    userAgent: 'test-agent', delayMs: 0, sleep: async () => {},
    fetchImpl: async (_url, options) => { request = options; return { ok: true, text: async () => 'ok' }; },
  });
  await getText('https://example.test/', { method: 'POST', body: 'page=1' });
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(request.headers['user-agent'], 'test-agent');
});
