import * as cheerio from 'cheerio';
import { clean, slug } from '../util.js';
import { normalizeFeature } from './featureNormalizer.js';
import { RULES_SCHEMA_VERSION } from '../schema/version.js';

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_NAMES = { str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha' };
const content = ($) => $('.jaune').first().length ? $('.jaune').first() : $('body');

const number = (value) => {
  const match = /-?\d[\d,]*(?:\s+\d{3})*/.exec(String(value ?? '').replace(/[\u202f\u00a0]/g, ' ').replace(/[−–—]/g, '-'));
  return match ? Number(match[0].replace(/[\s,]/g, '')) : null;
};

function parseCr(value) {
  const raw = clean(value);
  const match = /^(\d+(?:\/\d+)?)\b/.exec(raw);
  const fraction = match?.[1];
  const numeric = fraction ? (fraction.includes('/') ? Number(fraction.split('/')[0]) / Number(fraction.split('/')[1]) : Number(fraction)) : null;
  return { raw, numeric };
}

function rowField($, row, selector) { return clean($(row).find(selector).first().text()) || null; }

/** Extract the compact table data exposed directly by Aidedd's all-monsters page. */
export function extractMonsterIndex(html) {
  const $ = cheerio.load(html);
  const records = [];
  $('#liste tbody tr').each((_, row) => {
    const anchor = $(row).find('td.item a[href^="/monster/"]').first();
    if (!anchor.length) return;
    const href = anchor.attr('href');
    const id = slug(href.replace(/^\/monster\//, '').replace(/\/$/, ''));
    const crRaw = rowField($, row, '.tag2');
    const abilityValues = $(row).find('td.colC').toArray().slice(0, 6).map((cell) => number($(cell).text()));
    const sources = $(row).find('.colS .tagS').toArray().map((element) => clean($(element).text())).filter(Boolean);
    records.push({
      id, name: clean(anchor.text()), detailUrl: new URL(href, 'https://www.aidedd.org').href,
      challengeRating: parseCr(crRaw), creatureType: rowField($, row, '.colT .tag1'), size: rowField($, row, '.colD .tag3'),
      armorClass: { raw: clean($(row).find('td.colP').eq(0).text()) || null, value: number($(row).find('td.colP').eq(0).text()) },
      hitPoints: { raw: clean($(row).find('td.colP').eq(1).text()) || null, average: number($(row).find('td.colP').eq(1).text()), hitDice: null },
      speed: { raw: rowField($, row, '.colQ'), walkingFeet: null, modes: [] },
      abilityScores: Object.fromEntries(ABILITIES.map((ability, index) => [ability, { score: abilityValues[index], modifier: null, savingThrow: null }])),
      alignment: rowField($, row, '.colA'), legendary: Boolean(rowField($, row, '.colL')),
      publications: sources,
    });
  });
  return records;
}

function directFieldValues($, root) {
  const fields = {};
  const nodes = $(root).contents().toArray();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type !== 'tag' || node.name !== 'strong') continue;
    const label = clean($(node).text()).toLowerCase();
    if (!label || ['initiative'].includes(label)) continue;
    let value = '';
    for (let j = i + 1; j < nodes.length; j++) {
      const next = nodes[j];
      if (next.type === 'tag' && (next.name === 'br' || next.name === 'strong' || next.name === 'div')) break;
      value += next.type === 'text' ? next.data : $(next).text();
    }
    fields[label] = clean(value);
  }
  return fields;
}

function parseSpeed(raw) {
  const modes = [];
  for (const match of String(raw ?? '').matchAll(/(walk|burrow|climb|fly|swim)?\s*(\d+)\s*ft\.?/gi)) {
    modes.push({ mode: (match[1] || 'walk').toLowerCase(), feet: Number(match[2]) });
  }
  return { raw: raw || null, walkingFeet: modes.find(({ mode }) => mode === 'walk')?.feet ?? null, modes };
}

function parseAbilityMechanics(description) {
  const source = String(description ?? '').replace(/[−–—]/g, '-');
  const damage = [];
  const damagePattern = /(\d[\d,\s\u202f\u00a0]*)\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s*([A-Za-z]+)?\s+damage\b/gi;
  for (const match of source.matchAll(damagePattern)) {
    const raw = clean(match[0]);
    damage.push({ formula: clean(match[2]).replace(/\s+/g, ' '), average: number(match[1]), damageType: match[3] ? clean(match[3]) : null, raw });
  }
  const plainDamagePattern = /\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+([A-Za-z]+)?\s+damage\b/gi;
  for (const match of source.matchAll(plainDamagePattern)) {
    const formula = clean(match[1]).replace(/\s+/g, ' ');
    if (!damage.some((entry) => entry.formula === formula && entry.raw.includes(match[0]))) {
      damage.push({ formula, average: null, damageType: match[2] ? clean(match[2]) : null, raw: clean(match[0]) });
    }
  }

  const healing = [];
  const healingPattern = /(?:regains?|regain|heals?)\s+(\d[\d,\s\u202f\u00a0]*)\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s*(?:Hit Points|HP)\b/gi;
  for (const match of source.matchAll(healingPattern)) {
    healing.push({ formula: clean(match[2]).replace(/\s+/g, ' '), average: number(match[1]), raw: clean(match[0]) });
  }

  const attackRolls = [...source.matchAll(/((?:Melee|Ranged)(?:\s+or\s+(?:Melee|Ranged))? Attack Roll):\s*([+-]\d+)/gi)]
    .map((match) => ({ kind: clean(match[1]), bonus: Number(match[2]), raw: clean(match[0]) }));
  const savingThrows = [
    ...[...source.matchAll(/((?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw):\s*(?:DC\s*)?(\d+)/gi)]
      .map((match) => ({ ability: clean(match[1].replace(/\s+Saving Throw/i, '')), dc: Number(match[2]), raw: clean(match[0]) })),
    ...[...source.matchAll(/\bDC\s*(\d+)\s+((?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw)\b/gi)]
      .map((match) => ({ ability: clean(match[2].replace(/\s+Saving Throw/i, '')), dc: Number(match[1]), raw: clean(match[0]) })),
  ].filter((save, index, all) => all.findIndex((candidate) => candidate.ability === save.ability && candidate.dc === save.dc) === index);
  const targeting = [...source.matchAll(/\b(reach|range)\s+(?:of\s+)?(\d+)(?:\s*\/\s*(\d+))?\s*ft\.?/gi)]
    .map((match) => ({ kind: match[1].toLowerCase(), distanceFeet: Number(match[2]), longDistanceFeet: match[3] ? Number(match[3]) : null }));
  const conditions = [...new Set([...source.matchAll(/\b(Blinded|Charmed|Deafened|Exhaustion|Frightened|Grappled|Incapacitated|Invisible|Paralyzed|Petrified|Poisoned|Prone|Restrained|Stunned|Unconscious)\b/gi)].map((match) => match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()))];
  const rechargeMatch = /\bRecharge\s+(\d+(?:\s*[-–]\s*\d+)?)\b/i.exec(source);
  const usesMatch = /\b(?:has\s+)?(\d+)(?:\s*\/\s*(day|short rest|long rest))?\s+(?:uses?|charges?)\b/i.exec(source)
    ?? /\b(\d+)\s*\/\s*(day|short rest|long rest)\b/i.exec(source);

  return {
    damage, healing, attackRolls, savingThrows, targeting,
    conditions, recharge: rechargeMatch ? `Recharge ${rechargeMatch[1].replace(/\s+/g, '')}` : null,
    uses: usesMatch ? Number(usesMatch[1]) : null, usesPerPeriod: usesMatch?.[2]?.toLowerCase() ?? null,
  };
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function parseSpellcasting(text, spellLines) {
  const abilityMatch = /using\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+as\s+the\s+spellcasting\s+ability/i.exec(text);
  const saveDCMatch = /spell\s+save\s+DC\s*(\d+)/i.exec(text);
  const spellsByFrequency = spellLines.filter(({ spellIds, spellNames }) => spellIds.length || spellNames.length);
  return {
    ability: abilityMatch ? abilityMatch[1] : null,
    saveDC: saveDCMatch ? Number(saveDCMatch[1]) : null,
    spellsByFrequency,
  };
}

function spellIdsFrom($, node) {
  return $(node).find('a[href*="/spell/"]').toArray().map((anchor) => {
    const match = /\/spell\/([a-z0-9-]+)/i.exec($(anchor).attr('href') ?? '');
    return match?.[1] ?? null;
  }).filter(Boolean);
}

function parseActionSections($, root, monsterId) {
  const categories = ['traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions', 'mythicActions', 'lairActions'];
  const result = Object.fromEntries(categories.map((category) => [category, []]));
  const keys = {
    traits: 'traits', actions: 'actions', 'bonus actions': 'bonusActions', reactions: 'reactions',
    'legendary actions': 'legendaryActions', 'mythic actions': 'mythicActions', 'lair actions': 'lairActions',
  };
  for (const heading of $(root).find('h2.rub').toArray()) {
    const key = keys[clean($(heading).text()).toLowerCase()];
    if (!key) continue;
    let lastAbility = null;
    let continuationParent = null;
    let spellLine = { text: '', spellIds: [], spellNames: [] };
    const flushSpellLine = () => {
      if (!lastAbility || lastAbility.name.toLowerCase() !== 'spellcasting') { spellLine = { text: '', spellIds: [], spellNames: [] }; return; }
      const frequencyMatch = /\b(At will|\d+\s*\/\s*(?:day|short rest|long rest)(?:\s+each)?|Cantrips?)\s*:/i.exec(spellLine.text);
      if (frequencyMatch && (spellLine.spellIds.length || spellLine.spellNames.length)) {
        const frequency = clean(frequencyMatch[1]).replace(/\s+/g, ' ');
        const entry = { frequency, spellIds: [...new Set(spellLine.spellIds)], spellNames: [...new Set(spellLine.spellNames)] };
        const existing = lastAbility.spellcasting.spellsByFrequency.find((item) => item.frequency.toLowerCase() === frequency.toLowerCase());
        if (existing) {
          existing.spellIds = [...new Set([...existing.spellIds, ...entry.spellIds])];
          existing.spellNames = [...new Set([...existing.spellNames, ...entry.spellNames])];
        } else lastAbility.spellcasting.spellsByFrequency.push(entry);
      }
      spellLine = { text: '', spellIds: [], spellNames: [] };
    };
    const siblings = $(heading).parent().contents().toArray();
    const headingIndex = siblings.indexOf(heading);
    for (const node of siblings.slice(headingIndex + 1)) {
      if (node.type === 'tag' && node.name === 'h2') break;
      const sibling = $(node);
      if (node.type === 'text') {
        const text = clean(node.data);
        if (lastAbility && text) {
          lastAbility.description = clean(`${lastAbility.description} ${text}`);
          if (lastAbility.name.toLowerCase() === 'spellcasting') spellLine.text += ` ${text}`;
        }
        continue;
      }
      if (node.name === 'br') {
        flushSpellLine();
        continue;
      }
      if (node.name === 'p') {
        flushSpellLine();
        const emphasized = sibling.find('> strong > em').first();
        if (!emphasized.length) {
          const text = clean(sibling.text());
          if (!text) continue;
          if (lastAbility) {
            lastAbility.description = clean(`${lastAbility.description} ${text}`);
            lastAbility.spellIds = [...new Set([...lastAbility.spellIds, ...spellIdsFrom($, node)])];
          }
          continue;
        }
        const sourceName = emphasized.text();
        const indentedSubentry = /^[\s\u00a0\u2002\u2003\u2009]/.test(sourceName);
        if (continuationParent && !indentedSubentry) continuationParent = null;
        const name = clean(sourceName).replace(/[.]$/, '');
        const body = sibling.clone();
        body.children('strong').first().remove();
        const description = clean(body.text()).replace(/^[.:]\s*/, '');
        const spellIds = spellIdsFrom($, node);
        if (!name || result[key].some((entry) => entry.id === slug(name))) continue;
        if (indentedSubentry && continuationParent) {
          continuationParent.description = clean(`${continuationParent.description}\n${name}: ${description}`);
        }
        const mechanics = parseAbilityMechanics(`${name}. ${description}`);
        const spellcasting = /spellcasting/i.test(name) ? parseSpellcasting(description, []) : null;
        lastAbility = {
          id: slug(name), name, description, spellIds: [...new Set(spellIds)], ...mechanics,
          spellcasting,
        };
        result[key].push(lastAbility);
        if (!indentedSubentry && description.endsWith(':')) continuationParent = lastAbility;
        continue;
      }

      if (lastAbility?.name.toLowerCase() === 'spellcasting') {
        const ids = spellIdsFrom($, node);
        const names = sibling.find('a[href*="/spell/"]').toArray().map((anchor) => clean($(anchor).text())).filter(Boolean);
        spellLine.text += ` ${clean(sibling.text())}`;
        spellLine.spellIds.push(...ids);
        spellLine.spellNames.push(...names);
        lastAbility.spellIds = [...new Set([...lastAbility.spellIds, ...ids])];
      }
      if (lastAbility) {
        const text = clean(sibling.text());
        if (text) lastAbility.description = clean(`${lastAbility.description} ${text}`);
        lastAbility.spellIds = [...new Set([...lastAbility.spellIds, ...spellIdsFrom($, node)])];
      }
    }
    flushSpellLine();
    result[key] = result[key].map((ability) => {
      const mechanicsFound = ability.attackRolls.length || ability.savingThrows.length || ability.damage.length
        || ability.healing.length || ability.targeting.length || ability.conditions.length || ability.recharge || ability.uses;
      const feature = normalizeFeature({
        id: `${monsterId}-${ability.id}`, name: ability.name, description: ability.description,
        mechanics: {
          attackRoll: ability.attackRolls[0] ? {
            type: /ranged/i.test(ability.attackRolls[0].kind) ? 'ranged' : 'melee', kind: 'unknown', ability: null,
            bonus: ability.attackRolls[0].bonus,
          } : undefined,
          range: ability.targeting[0] ? { kind: ability.targeting[0].kind, distance: ability.targeting[0].distanceFeet, unit: 'feet' } : undefined,
          save: ability.savingThrows[0] ? {
            ability: ({ Strength: 'str', Dexterity: 'dex', Constitution: 'con', Intelligence: 'int', Wisdom: 'wis', Charisma: 'cha' })[ability.savingThrows[0].ability] ?? null,
            dcFormula: { kind: 'fixed', value: ability.savingThrows[0].dc },
          } : undefined,
          damage: ability.damage.map(({ formula, damageType }) => ({ formula: formula.replace(/\s+/g, ''), damageType: damageType?.toLowerCase() ?? null, onSave: null })),
          healing: ability.healing.map(({ formula }) => ({ formula: formula.replace(/\s+/g, ''), onSave: null })),
          conditionEffects: ability.conditions.map((condition) => ({ condition: condition.toLowerCase(), duration: null })),
          recharge: ability.recharge ? { kind: 'roll', minimumRoll: Number(/\d+/.exec(ability.recharge)?.[0]) } : null,
          uses: ability.uses ? {
            maximum: ability.uses,
            period: /long rest/i.test(ability.usesPerPeriod ?? '') ? 'long-rest' : /short rest/i.test(ability.usesPerPeriod ?? '') ? 'short-rest' : 'day',
          } : null,
          resolution: mechanicsFound ? 'partial' : undefined,
        },
      });
      if (ability.spellcasting) {
        const groups = ability.spellcasting.spellsByFrequency.map(({ frequency, spellIds }) => ({ frequency, spellIds }));
        const allSpellIds = [...new Set([...ability.spellIds, ...groups.flatMap(({ spellIds }) => spellIds)])];
        if (!groups.length && allSpellIds.length) groups.push({ frequency: 'listed', spellIds: allSpellIds });
        feature.spellcasting = { ...ability.spellcasting, spellsByFrequency: groups };
      }
      return { id: ability.id, name: ability.name, feature };
    });
  }
  return result;
}

/** Extracts monster facts, full ability content, and parseable roll mechanics. */
export function extractMonsterDetail(indexRecord, raw) {
  const $ = cheerio.load(raw?.html ?? '');
  const root = content($);
  const statBlock = root.find('.red').first();
  const detailAvailable = Boolean(statBlock.length && statBlock.find('strong').length);
  const fields = directFieldValues($, statBlock);
  const initiativeText = clean(statBlock.find('.init').text());
  const initiativeMatch = /([+-]\d+)\s*\((\d+)\)/.exec(initiativeText);
  const hpText = fields.hp ?? '';
  const hpMatch = /([\d,]+)\s*\(([^)]*)\)/.exec(hpText);
  const abilityScores = { ...indexRecord.abilityScores };
  for (const label of statBlock.find('.car1, .car4').toArray()) {
    const abilityName = clean($(label).text()).toLowerCase();
    const ability = Object.keys(ABILITY_NAMES).find((key) => ABILITY_NAMES[key].toLowerCase() === abilityName);
    if (!ability) continue;
    const values = $(label).nextAll('div').slice(0, 3).toArray().map((element) => clean($(element).text()));
    abilityScores[ability] = {
      score: number(values[0]) ?? abilityScores[ability]?.score ?? null,
      modifier: number(values[1]),
      savingThrow: number(values[2]),
    };
  }
  const crText = fields.cr || indexRecord.challengeRating.raw;
  const cr = parseCr(crText);
  const xpMatch = /XP\s+([\d,\s\u202f\u00a0]+?)(?:\s*,|\s*;|\s*\)|$)/i.exec(crText);
  const pbMatch = /PB\s*([+-]\d+)/i.exec(crText);
  const skillMatches = [...String(fields.skills ?? '').matchAll(/([^,;]+?)\s+([+-]\d+)\s*(?=,|;|$)/g)];

  return {
    schemaVersion: RULES_SCHEMA_VERSION, kind: 'monster', id: indexRecord.id, name: indexRecord.name,
    creatureType: indexRecord.creatureType, size: indexRecord.size, alignment: indexRecord.alignment,
    challengeRating: cr, experiencePoints: xpMatch ? number(xpMatch[1]) : null,
    proficiencyBonus: pbMatch ? Number(pbMatch[1]) : null,
    initiative: { raw: initiativeText || null, modifier: initiativeMatch ? Number(initiativeMatch[1]) : null, score: initiativeMatch ? Number(initiativeMatch[2]) : null },
    armorClass: { raw: fields.ac || indexRecord.armorClass.raw, value: number(fields.ac) ?? indexRecord.armorClass.value },
    hitPoints: { raw: hpText || indexRecord.hitPoints.raw, average: number(hpText) ?? indexRecord.hitPoints.average, hitDice: hpMatch?.[2] ?? null },
    speed: parseSpeed(fields.speed || indexRecord.speed.raw), abilityScores,
    skills: skillMatches.map((match) => ({ name: clean(match[1]), bonus: Number(match[2]) })),
    senses: fields.senses || null, languages: fields.languages || null,
    damageVulnerabilities: fields['damage vulnerabilities'] || fields.vulnerabilities || null,
    damageResistances: fields['damage resistances'] || fields.resistances || null,
    damageImmunities: fields['damage immunities'] || fields.immunities || null,
    conditionImmunities: fields['condition immunities'] || null,
    publications: indexRecord.publications,
    abilities: parseActionSections($, root, indexRecord.id), detailAvailable,
    sources: [{ id: raw?.source ?? 'aidedd-monsters', title: indexRecord.name, url: raw?.url ?? indexRecord.detailUrl,
      fetchedAt: raw?.fetchedAt ?? null, publications: indexRecord.publications }],
  };
}
