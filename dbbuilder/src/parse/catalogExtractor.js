import * as cheerio from 'cheerio';
import { ABILITY_CODES, clean, slug } from '../util.js';
import { hasChoiceLanguage, manualChoice, normalizeChoice } from '../choiceContract.js';
import { normalizeFeature } from './featureNormalizer.js';
import { RULES_SCHEMA_VERSION } from '../schema/version.js';

const PAGE_ID = /^([a-z][\w-]*):([\w-]+)$/i;
const content = ($) => $('#page-content').first().length ? $('#page-content').first() : $('.page-content').first();
const pageIdFromHref = (href, namespace) => {
  if (!href) return null;
  try {
    const url = new URL(href, 'https://dnd2024.wikidot.com');
    if (url.origin !== 'https://dnd2024.wikidot.com') return null;
    const pageId = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''));
    const match = PAGE_ID.exec(pageId);
    return match && (!namespace || match[1].toLowerCase() === namespace) ? pageId : null;
  } catch { return null; }
};

export function catalogPageLinks(html, namespace) {
  const $ = cheerio.load(html); const ids = new Set();
  content($).find('a[href]').each((_, a) => {
    const id = pageIdFromHref($(a).attr('href'), namespace);
    if (id) ids.add(id);
  });
  return [...ids].sort();
}

export function catalogRecordLinks(html, kind) {
  const namespace = ({ spell: 'spell', feat: 'feat', background: 'background', species: 'species' })[kind] ?? null;
  const $ = cheerio.load(html); const ids = new Set();
  content($).find('table').each((_, table) => {
    const { headers, rows } = tableRows($, table);
    if (kind === 'spell' && (!headers.some((h) => /^school$/i.test(h)) || !headers.some((h) => /spell lists/i.test(h)))) return;
    if (['feat', 'background', 'species'].includes(kind) && !/^name$/i.test(headers[0] ?? '')) return;
    for (const row of rows) {
      const tr = linkedRow($, table, row[0]);
      const id = pageIdFromHref(tr ? $(tr).find('a[href]').first().attr('href') : null, namespace);
      if (id) ids.add(id);
    }
  });
  return [...ids].sort();
}

function labeledParagraphs($, raw) {
  const result = {};
  for (const paragraph of content($).children('p').toArray()) {
    const text = clean($(paragraph).text());
    if (!text || /^source\s*:/i.test(text)) continue;
    for (const segment of ($(paragraph).html() ?? '').split(/<br\s*\/?>/i)) {
      const fragment = cheerio.load(segment);
      const strong = fragment('strong').first();
      const segmentText = clean(fragment.text());
      const plainLabel = /^([a-z][a-z ]*):\s*/i.exec(segmentText);
      if (!strong.length && !plainLabel) continue;
      const labelText = strong.length ? strong.text() : plainLabel[1];
      const label = clean(labelText).replace(/[:.]$/, '').toLowerCase();
      if (!label) continue;
      const value = clean(strong.length ? segmentText.replace(strong.text(), '') : segmentText.slice(plainLabel[0].length)).replace(/^[.:]\s*/, '');
      result[label] = { value, html: segment };
    }
  }
  return result;
}

function linkedPageInHtml(html, namespace) {
  const $ = cheerio.load(html ?? '');
  return pageIdFromHref($('a[href]').first().attr('href'), namespace);
}

const BACKGROUND_ARTISAN_TOOLS = [
  'Alchemist’s supplies', 'Brewer’s supplies', 'Calligrapher’s supplies', 'Carpenter’s tools',
  'Cartographer’s tools', 'Cobbler’s tools', 'Cook’s utensils', 'Glassblower’s tools', 'Jeweler’s tools',
  'Leatherworker’s tools', 'Mason’s tools', 'Painter’s supplies', 'Potter’s tools', 'Smith’s tools',
  'Tinker’s tools', 'Weaver’s tools', 'Woodcarver’s tools',
];
const BACKGROUND_MUSICAL_INSTRUMENTS = ['Bagpipes', 'Drum', 'Dulcimer', 'Flute', 'Horn', 'Lute', 'Lyre', 'Pan Flute', 'Shawm', 'Viol'];

function backgroundAbilityScoreChoice(recordId, abilityScores, prompt, source) {
  const abilities = abilityScores.filter(({ id }) => ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(id));
  if (abilityScores.length !== 3 || abilities.length !== 3 || new Set(abilities.map(({ id }) => id)).size !== 3) {
    return manualChoice({ recordId, recordKind: 'background', feature: 'Ability Scores', prompt, source, idSuffix: 'ability-scores', scope: 'build' });
  }

  const effect = (ability, amount) => ({ type: 'ability-score-increase', ability, amount, maximum: 20 });
  const options = [];
  for (const plusTwo of abilities) for (const plusOne of abilities) {
    if (plusTwo.id === plusOne.id) continue;
    options.push({
      id: `${recordId}-ability-scores-${plusTwo.id}-2-${plusOne.id}-1`,
      label: `+2 ${plusTwo.name}, +1 ${plusOne.name}`,
      effects: [effect(plusTwo.id, 2), effect(plusOne.id, 1)],
    });
  }
  options.push({
    id: `${recordId}-ability-scores-all-plus-1`,
    label: '+1 to all three listed ability scores',
    effects: abilities.map(({ id }) => effect(id, 1)),
  });

  return normalizeChoice({
    id: `${recordId}-1-ability-scores-ability-scores`,
    featureId: `${recordId}-1-ability-scores`,
    level: 1,
    feature: 'Ability Scores',
    prompt: 'Choose one allocation: increase one listed ability score by 2 and a different listed score by 1, or increase all three listed scores by 1.',
    scope: 'build',
    selection: { count: 1, countRule: null, min: 1, max: 1, distinct: true },
    options,
    optionSource: null,
    changeRule: null,
    resolution: 'structured',
  }, { recordId, recordKind: 'background', source });
}

const GAMING_SETS = ['Dice', 'Dragonchess', 'Playing Cards', 'Three-dragon Ante'];
const BACKGROUND_TOOL_OPTIONS = {
  artisan: BACKGROUND_ARTISAN_TOOLS,
  gaming: GAMING_SETS,
  instrument: BACKGROUND_MUSICAL_INSTRUMENTS,
};

function backgroundToolChoice(recordId, raw, source) {
  if (!raw || !/\bchoose\s+(?:one|1)\s+(?:kind|type)\s+of\b/i.test(raw)) return null;
  const category = /\bartisan(?:’|')s tools?\b/i.test(raw) ? 'artisan'
    : /\bgaming sets?\b/i.test(raw) ? 'gaming'
      : /\bmusical instruments?\b/i.test(raw) ? 'instrument' : null;
  const candidates = category ? BACKGROUND_TOOL_OPTIONS[category] : null;
  if (!candidates?.length) {
    return manualChoice({ recordId, recordKind: 'background', feature: 'Tool Proficiency', prompt: raw, source, idSuffix: 'tool-proficiency', scope: 'build' });
  }
  return normalizeChoice({
    id: `${recordId}-1-tool-proficiency-tool-proficiency`,
    featureId: `${recordId}-1-tool-proficiency`,
    level: 1,
    feature: 'Tool Proficiency',
    prompt: raw,
    scope: 'build',
    selection: { count: 1, countRule: null, min: 1, max: 1, distinct: true },
    options: candidates.map((name) => ({
      id: `tool-${slug(name)}`,
      label: name,
      effects: [{ type: 'proficiency-grant', proficiency: { type: 'tool', id: slug(name), name } }],
    })),
    optionSource: null,
    changeRule: null,
    resolution: 'structured',
  }, { recordId, recordKind: 'background', source });
}

function featAbilityScoreChoice(recordId, benefit, source) {
  const text = clean(benefit.description);
  const dependentFeature = /spellcasting ability score used by your (.+?) feat/i.exec(text);
  const missingSave = /choose one ability in which you lack saving throw proficiency\.\s*Increase the chosen ability score by (\d+), to a maximum of (\d+)\.?/i.exec(text);
  if (dependentFeature) {
    const featureId = `${recordId}-1-${slug(benefit.name)}`;
    return normalizeChoice({
      id: `${featureId}-ability-score`, featureId, level: 1, feature: benefit.name,
      prompt: text, scope: 'build',
      selection: { count: 1, countRule: null, min: 1, max: 1, distinct: true },
      options: [],
      optionSource: { type: 'selected-feat-spellcasting-ability', id: slug(dependentFeature[1]) },
      changeRule: null, resolution: 'partial',
      unresolvedReason: 'The score option depends on the spellcasting ability selected for another feat; the frontend must resolve that dependency.',
      dependsOn: [],
      effects: [{ type: 'ability-score-increase', ability: null, amount: 1, maximum: 20, abilityFrom: { type: 'selected-feat-spellcasting-ability', featId: slug(dependentFeature[1]) } }],
    }, { recordId, recordKind: 'feat', source });
  }
  if (missingSave) {
    const featureId = `${recordId}-1-${slug(benefit.name)}`;
    return normalizeChoice({
      id: `${featureId}-ability-score`, featureId, level: 1, feature: benefit.name,
      prompt: text, scope: 'build',
      selection: { count: 1, countRule: null, min: 1, max: 1, distinct: true },
      options: [],
      optionSource: { type: 'abilities-without-saving-throw-proficiency', id: 'character-saving-throw-proficiencies' },
      changeRule: null, resolution: 'partial',
      unresolvedReason: 'The eligible abilities depend on the character’s saving-throw proficiency state.',
      effects: [{ type: 'ability-score-increase', ability: null, amount: Number(missingSave[1]), maximum: Number(missingSave[2]), abilityFrom: { type: 'selected-option' } }],
    }, { recordId, recordKind: 'feat', source });
  }
  const anyAbility = /^increase one ability score of your choice by (\d+), to a maximum of (\d+)\.?$/i.exec(text);
  const explicit = /^increase (?:your )?(.+?)(?: ability)? score by (\d+), to a maximum of (\d+)\.?$/i.exec(text);
  let abilities;
  let amount;
  let maximum;
  if (anyAbility) {
    abilities = Object.keys(ABILITY_CODES);
    amount = Number(anyAbility[1]);
    maximum = Number(anyAbility[2]);
  } else if (explicit) {
    const names = explicit[1].toLowerCase();
    const matches = [...names.matchAll(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b/g)];
    const residue = names.replace(/\b(?:strength|dexterity|constitution|intelligence|wisdom|charisma)\b/g, '').replace(/[\s,]*(?:and|or)?[\s,]*/g, '');
    if (!matches.length || residue) return null;
    abilities = [...new Set(matches.map(([name]) => name))];
    amount = Number(explicit[2]);
    maximum = Number(explicit[3]);
  } else return null;

  const options = abilities.map((name) => ({
    id: `ability-${ABILITY_CODES[name]}`,
    label: name[0].toUpperCase() + name.slice(1),
    effects: [{ type: 'ability-score-increase', ability: ABILITY_CODES[name], amount, maximum }],
  }));
  const featureId = `${recordId}-1-${slug(benefit.name)}`;
  return normalizeChoice({
    id: `${featureId}-ability-score`, featureId, level: 1, feature: benefit.name,
    prompt: text, scope: 'build',
    selection: { count: 1, countRule: null, min: 1, max: 1, distinct: true },
    options, optionSource: null, changeRule: null, resolution: 'structured',
  }, { recordId, recordKind: 'feat', source });
}

export function extractBackgroundCatalog(indexRaw, detailRawById = {}) {
  const $ = cheerio.load(indexRaw.html); const records = new Map();
  content($).find('table').each((_, table) => {
    const { headers, rows } = tableRows($, table);
    if (!/^name$/i.test(headers[0] ?? '')) return;
    for (const row of rows) {
      const tr = linkedRow($, table, row[0]);
      const anchor = tr ? $(tr).find('a[href]').first() : null;
      const pageId = pageIdFromHref(anchor?.attr('href'), 'background');
      if (!pageId) continue;
      const id = pageId.split(':')[1]; const raw = detailRawById[pageId];
      const detail = raw ? cheerio.load(raw.html) : null;
      const labels = detail ? labeledParagraphs(detail, raw) : {};
      const value = (label) => labels[label]?.value ?? null;
      const abilityScores = splitList((value('ability scores') ?? value('ability score') ?? '').replace(/\s+and\s+/gi, ', '));
      const skills = splitList((value('skill proficiencies') ?? '').replace(/\s+and\s+/gi, ', '));
      const featHtml = labels.feat?.html ?? '';
      const linkedFeatPageId = linkedPageInHtml(featHtml, 'feat');
      const featPageId = linkedFeatPageId && linkedFeatPageId !== 'feat:all' ? linkedFeatPageId : null;
      const featName = featHtml ? clean(cheerio.load(featHtml)('a').first().text()) || value('feat') : value('feat');
      const equipmentRaw = value('equipment');
      const toolProficiency = value('tool proficiency') ?? value('tool proficiencies');
      const options = equipmentRaw ? [...equipmentRaw.matchAll(/\(([A-Z])\)\s*/g)].map((match, i, all) => {
        const start = match.index + match[0].length;
        const end = all[i + 1]?.index ?? equipmentRaw.length;
        const optionRaw = clean(equipmentRaw.slice(start, end).replace(/;?\s*(?:or\s*)?$/i, ''));
        const goldMatch = /([\d,]+)\s*GP\b/i.exec(optionRaw);
        const items = optionRaw.replace(/;?\s*[\d,]+\s*GP\b/i, '').split(/,\s*(?![^()]*\))/).map(clean).filter(Boolean);
        return { id: match[1].toLowerCase(), label: match[1], raw: optionRaw, items, gold: goldMatch ? Number(goldMatch[1].replace(/,/g, '')) : null };
      }) : [];
      records.set(id, {
        schemaVersion: RULES_SCHEMA_VERSION, kind: 'background', id, name: clean(anchor.text()),
        description: detail ? detail('#page-content').children('p').toArray().map((p) => clean(detail(p).text())).filter((text) => text && !/^source\s*:/i.test(text) && !/^(?:ability scores?|feat|skill proficiencies|tool proficiency|equipment)\s*[:.]/i.test(text)).join('\n\n') || null : null,
        abilityScores: abilityScores.map((name) => ({ id: ABILITY_CODES[name.toLowerCase()] ?? slug(name), name })),
        feat: featName ? { id: featPageId?.split(':')[1] ?? null, name: featName } : null,
        skillProficiencies: skills.map((name) => ({ id: slug(name), name })),
        toolProficiency, equipment: { raw: equipmentRaw, options },
        choices: [
          ...(abilityScores.length ? [backgroundAbilityScoreChoice(id, abilityScores.map((name) => ({ id: ABILITY_CODES[name.toLowerCase()] ?? slug(name), name })), value('ability scores') ?? value('ability score'), raw ? pageSource(raw) : pageSource(indexRaw))] : []),
          ...(toolProficiency ? [backgroundToolChoice(id, toolProficiency, raw ? pageSource(raw) : pageSource(indexRaw))].filter(Boolean) : []),
          ...(options.length > 1 ? [normalizeChoice({
            id: `${id}-starting-equipment`, level: 1, feature: 'Starting Equipment', prompt: equipmentRaw,
            scope: 'build', selection: { count: 1, countRule: null },
            options: options.map((option) => ({ id: `${id}-equipment-${option.id}`, label: `Option ${option.label}`, description: option.raw })),
            optionSource: null, changeRule: null, resolution: 'partial',
            unresolvedReason: 'Parsed alternatives are available, but the source procedure and equipment resolution are not fully modeled.',
          }, { recordId: id, recordKind: 'background', source: raw ? pageSource(raw) : pageSource(indexRaw) })] : []),
        ],
        sources: [raw ? pageSource(raw) : pageSource(indexRaw)],
      });
    }
  });
  return [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function extractSpeciesCatalog(indexRaw, detailRawById = {}) {
  const $ = cheerio.load(indexRaw.html); const records = new Map();
  content($).find('table').each((_, table) => {
    const { headers, rows } = tableRows($, table);
    if (!/^name$/i.test(headers[0] ?? '')) return;
    for (const row of rows) {
      const tr = linkedRow($, table, row[0]);
      const anchor = tr ? $(tr).find('a[href]').first() : null;
      const pageId = pageIdFromHref(anchor?.attr('href'), 'species');
      if (!pageId) continue;
      const id = pageId.split(':')[1]; const raw = detailRawById[pageId];
      const detail = raw ? cheerio.load(raw.html) : null;
      const labels = detail ? labeledParagraphs(detail, raw) : {};
      const description = []; const traits = [];
      if (detail) for (const paragraph of content(detail).children('p').toArray()) {
        const text = clean(detail(paragraph).text());
        if (!text || /^source\s*:/i.test(text)) continue;
        const segments = (detail(paragraph).html() ?? '').split(/<br\s*\/?>/i);
        let lastTraitIndex = null;
        for (const segment of segments) {
          const fragment = cheerio.load(segment);
          const strong = fragment('strong').first();
          const segmentText = clean(fragment.text());
          const label = strong.length ? clean(strong.text()).replace(/[:.]$/, '').toLowerCase() : '';
          if (['creature type', 'size', 'speed'].includes(label)) continue;
          if (strong.length) {
            const name = clean(strong.text()).replace(/[.:]$/, '');
            const effect = clean(segmentText.replace(strong.text(), '').replace(/^\s*[.:]\s*/, ''));
            if (name && effect) {
              traits.push({ id: slug(name), name, description: effect });
              lastTraitIndex = traits.length - 1;
            }
          } else if (segmentText && !/^(?:as an .+?, you have these special traits\.|here are the transformation options:)$/i.test(segmentText)) {
            if (lastTraitIndex === null) description.push(segmentText);
            else traits[lastTraitIndex].description = clean(`${traits[lastTraitIndex].description} ${segmentText}`);
          }
        }
      }
      const speedText = labels.speed?.value ?? null;
      const speedMatch = /\b(\d+)\s*feet\b/i.exec(speedText ?? '');
      const creatureTypeText = labels['creature type']?.value ?? null;
      const creatureType = creatureTypeText
        ? (/\b(aberration|beast|celestial|construct|dragon|elemental|fey|fiend|giant|humanoid|monstrosity|ooze|plant|undead)\b/i.exec(creatureTypeText)?.[1]
          ?? clean(creatureTypeText.replace(/^you are (?:a |an )?/i, '').replace(/[.]$/, '')))
        : null;
      const size = labels.size?.value?.replace(/^you are\s+/i, '').replace(/[.]$/, '') ?? null;
      const choices = [
        ...traits.filter((trait) => hasChoiceLanguage(trait.description)).map((trait) => manualChoice({
          recordId: id, recordKind: 'species', feature: trait.name, prompt: trait.description,
          source: raw ? pageSource(raw) : pageSource(indexRaw), idSuffix: 'manual',
        })),
        ...(description.some(hasChoiceLanguage) ? [manualChoice({
          recordId: id, recordKind: 'species', feature: 'Species Features', prompt: description.find(hasChoiceLanguage),
          source: raw ? pageSource(raw) : pageSource(indexRaw), idSuffix: 'manual', scope: 'build',
        })] : []),
      ];
      const canonicalTraits = traits.map((trait) => normalizeFeature({
        ...trait, id: `${id}-${slug(trait.name)}`,
      }));
      for (const trait of canonicalTraits) trait.choices = choices
        .filter((choice) => choice.feature === trait.name).map((choice) => choice.id);
      records.set(id, {
        schemaVersion: RULES_SCHEMA_VERSION, kind: 'species', id, name: clean(anchor.text()), description: description.join('\n\n') || null,
        creatureType, size,
        speed: { raw: speedText, walkingFeet: speedMatch ? Number(speedMatch[1]) : null },
        traits: canonicalTraits, choices,
        sources: [raw ? pageSource(raw) : pageSource(indexRaw)],
      });
    }
  });
  return [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function pageSource(raw) {
  const $ = cheerio.load(raw.html);
  const sourceText = content($).find('p').toArray().map((p) => clean($(p).text())).find((text) => /^source\s*:/i.test(text));
  return {
    id: raw.source, title: raw.title, url: raw.url ?? null,
    fetchedAt: raw.fetchedAt ?? null,
    ...(sourceText ? { publication: clean(sourceText.replace(/^source\s*:\s*/i, '')) } : {}),
  };
}

function tableRows($, table) {
  const rows = $(table).find('tr').toArray().filter((tr) => $(tr).closest('table')[0] === table);
  if (!rows.length) return { headers: [], rows: [] };
  const read = (tr) => $(tr).children('th,td').toArray().map((cell) => clean($(cell).text()));
  const firstDataRow = rows.findIndex((tr) => $(tr).children('td').length > 0);
  if (firstDataRow < 0) return { headers: [], rows: [] };
  const headerRows = rows.slice(0, firstDataRow).filter((tr) => $(tr).children('th').length > 0).map(read);
  if (!headerRows.length) return { headers: [], rows: rows.map(read) };
  const width = Math.max(...headerRows.map((row) => row.length));
  const headers = Array.from({ length: width }, (_, column) => [...new Set(headerRows.map((row) => row[column]).filter(Boolean))].join(' '));
  return { headers, rows: rows.slice(firstDataRow).map(read) };
}

function linkedRow($, table, name) {
  return $(table).find('tr').toArray().find((tr) =>
    clean($(tr).children('th,td').first().text()) === name);
}

function enclosingTab($, element) {
  const tab = $(element).closest('[id^="wiki-tab-"]');
  if (!tab.length) return null;
  const tabId = tab.attr('id');
  const index = Number(tabId.slice(tabId.lastIndexOf('-') + 1));
  const set = tab.closest('.yui-navset');
  const labels = set.find('ul.yui-nav > li').toArray().map((li) => clean($(li).text()));
  return { index, label: labels[index] ?? null };
}

function orderedContentNodes($, root) {
  const result = [];
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (child.type !== 'tag') continue;
      if (/^h[1-6]$/.test(child.name) || child.name === 'table') result.push(child);
      if (child.name !== 'table') visit(child);
    }
  };
  visit(root);
  return result;
}

const splitList = (value) => clean(value).split(/\s*,\s*/).filter(Boolean);
const componentFlags = (text) => ['V', 'S', 'M'].filter((flag) => new RegExp(`(?:^|[,\\s])${flag}(?:$|[,\\s(])`, 'i').test(text));

const DAMAGE_TYPES = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const ABILITY_NAMES = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

function parseSpellActivation(value) {
  if (!value) return null;
  const text = clean(value);
  if (/\bbonus action\b/i.test(text)) return { type: 'bonusAction', cost: 1, unit: 'action', trigger: null };
  if (/\breaction\b/i.test(text)) return { type: 'reaction', cost: 1, unit: 'action', trigger: text.replace(/^reaction\s*,?\s*/i, '') || null };
  if (/\baction\b/i.test(text)) return { type: 'action', cost: 1, unit: 'action', trigger: null };
  const timed = /^(\d+)\s+(minute|hour)s?\b/i.exec(text);
  if (timed) return { type: 'special', cost: Number(timed[1]), unit: `${timed[2].toLowerCase()}${Number(timed[1]) === 1 ? '' : 's'}`, trigger: null };
  return { type: 'special', cost: null, unit: null, trigger: text || null };
}

function parseSpellRange(value) {
  if (!value) return null;
  const text = clean(value);
  if (/^self\b/i.test(text)) return { kind: 'self', distance: null, unit: null };
  if (/^touch\b/i.test(text)) return { kind: 'touch', distance: null, unit: null };
  if (/^sight\b/i.test(text)) return { kind: 'sight', distance: null, unit: null };
  if (/^unlimited\b/i.test(text)) return { kind: 'unlimited', distance: null, unit: null };
  const distance = /^(\d+(?:\.\d+)?)\s*(feet|foot|mile|miles)\b/i.exec(text);
  if (distance) return {
    kind: 'range', distance: Number(distance[1]), unit: /^mile/i.test(distance[2]) ? 'mile' : 'feet',
  };
  return { kind: 'special', distance: null, unit: null };
}

function parseSpellCombat(detail) {
  const text = clean(detail.description ?? '');
  const areaMatch = /\b(\d+)\s*-?\s*(foot|feet)-?(?:-|\s)?(radius|diameter)\s+(sphere|cylinder)\b|\b(\d+)\s*-?\s*(foot|feet)\s+(cone|cube|line)\b/i.exec(text);
  let area = null;
  if (areaMatch) {
    if (areaMatch[4]) area = { shape: areaMatch[4].toLowerCase(), size: Number(areaMatch[1]), unit: 'feet', origin: /centered on (?:that )?point/i.test(text) ? 'point' : 'special' };
    else area = { shape: areaMatch[7].toLowerCase(), size: Number(areaMatch[5]), unit: 'feet', origin: 'self' };
  }
  const saveMatch = /\b(?:make|makes|must make)\s+(?:a\s+)?(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw\b/i.exec(text);
  const attackMatch = /\b(Melee|Ranged) Spell Attack(?: Roll)?\b/i.exec(text);
  const damage = [...text.matchAll(new RegExp(`\\b(\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?)\\s+(${DAMAGE_TYPES})\\s+damage\\b`, 'gi'))]
    .map((match) => ({ formula: match[1].replace(/\s+/g, ''), damageType: match[2].toLowerCase(), onSave: null }));
  const successHalf = /(?:half as much damage|half damage) on a successful (?:saving throw|save|one)|on a successful save[^.]{0,80}\bhalf\b/i.test(text);
  if (successHalf) for (const entry of damage) entry.onSave = 'half';

  const scalingMatch = /increases? by\s+(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+for each spell slot level above (\d+)(?:st|nd|rd|th)?/i.exec(text);
  const scaling = scalingMatch ? {
    kind: 'per-slot-level', minimumSpellLevel: Number(scalingMatch[2]),
    damage: [{ formula: scalingMatch[1].replace(/\s+/g, ''), damageType: damage[0]?.damageType ?? null }],
  } : null;
  const save = saveMatch ? {
    ability: ABILITY_NAMES[saveMatch[1].toLowerCase()], dcFormula: { kind: 'spellcasting' },
  } : null;
  const attackRoll = attackMatch ? { type: attackMatch[1].toLowerCase(), kind: 'spell', ability: null, bonus: null } : null;
  const target = /\beach creature\b/i.test(text) ? { kind: 'each-creature', count: null } : null;
  const hasRecognizedMechanic = damage.length > 0 || Boolean(save || attackRoll || area);
  const completeDamageMechanic = damage.length > 0 && Boolean(save || attackRoll);
  return {
    resolution: completeDamageMechanic ? 'structured' : (hasRecognizedMechanic ? 'partial' : (text ? 'manual' : 'unknown')),
    activation: parseSpellActivation(detail.castingTime),
    range: parseSpellRange(detail.range), area, target,
    attackRoll: attackRoll ? { ...attackRoll, kind: 'spell' } : null,
    save, damage, scaling,
    duration: parseSpellDuration(detail.duration), concentration: detail.concentration,
  };
}

function parseSpellDuration(value) {
  if (!value) return null;
  const text = clean(value).replace(/^C\s*,?\s*/i, '');
  if (/^instantaneous$/i.test(text)) return { value: 0, unit: 'instantaneous' };
  const timed = /(?:up to\s+)?(\d+)\s+(round|minute|hour|day)s?\b/i.exec(text);
  if (timed) return { value: Number(timed[1]), unit: `${timed[2].toLowerCase()}${Number(timed[1]) === 1 ? '' : 's'}` };
  return { value: null, unit: 'special' };
}

function parseSpellDetail(raw) {
  if (!raw) return {
    description: null, castingTime: null, range: null, components: [],
    material: null, duration: null, concentration: false, ritual: false, detailSource: null,
  };
  const $ = cheerio.load(raw.html); const paragraphs = content($).children('p').toArray();
  const description = [];
  const meta = {};
  const header = paragraphs.map((p) => clean($(p).text())).find((text) => /(?:cantrip|level\s+\d+)/i.test(text));
  for (const p of paragraphs) {
    const text = clean($(p).text());
    if (!text || /^source\s*:/i.test(text) || text === header) continue;
    const labels = $(p).find('strong').toArray();
    if (labels.length && labels.some((label) => /^(casting time|range|components|duration):?$/i.test(clean($(label).text())))) {
      const html = $(p).html() ?? '';
      for (const [label, value] of html.split(/<br\s*\/?\s*>/i).map(clean).map((part) => {
        const m = /^<strong>([^<]+)<\/strong>\s*(.*)$/i.exec(part);
        return m ? [clean(m[1]).replace(/:$/, '').toLowerCase(), clean(m[2].replace(/<[^>]+>/g, ''))] : [];
      })) if (label) meta[label] = value;
      continue;
    }
    const strong = $(p).children('strong').first();
    const effectName = clean(strong.text()).replace(/[.:]$/, '');
    if (effectName && strong.length) {
      description.push(text);
    } else description.push(text);
  }
  const source = pageSource(raw);
  const ritual = /\bRitual\b/i.test(header ?? '') || /\bRitual\b/i.test(meta['casting time'] ?? '');
  const concentration = /\bC\b/.test(meta.duration ?? '');
  const result = {
    description: description.length ? description.join('\n\n') : null,
    castingTime: meta['casting time'] ?? null, range: meta.range ?? null,
    components: meta.components ? componentFlags(meta.components) : [],
    material: meta.components?.replace(/\b[VSM]\b/gi, '').replace(/^[,\s]+|[,\s]+$/g, '') || null,
    duration: meta.duration?.replace(/^C\s*,?\s*/i, '').trim() || null,
    concentration, ritual, detailSource: source,
  };
  result.combat = parseSpellCombat(result);
  return result;
}

export function extractSpellCatalog(indexRaw, detailRawById = {}) {
  const $ = cheerio.load(indexRaw.html); const spells = new Map();
  content($).find('table').each((_, table) => {
    const { headers, rows } = tableRows($, table);
    const keys = headers.map((h) => clean(h).toLowerCase());
    if (!keys.includes('school') || !keys.some((h) => h.includes('spell lists'))) return;
    const tab = enclosingTab($, table);
    const levelLabel = tab?.label ?? '';
    const level = /cantrip/i.test(levelLabel) ? 0 : Number(/^(\d+)/.exec(levelLabel)?.[1] ?? NaN);
    for (const row of rows) {
      const link = linkedRow($, table, row[0]);
      const anchor = link ? $(link).find('a[href]').first() : null;
      const id = pageIdFromHref(anchor?.attr('href'), 'spell');
      if (!id) continue;
      const values = Object.fromEntries(keys.map((key, index) => [key, row[index] ?? '']));
      const spellId = id.split(':')[1];
      const detail = parseSpellDetail(detailRawById[id]);
      const levelFromDetail = /\b(\d+)(?:st|nd|rd|th)-level\b/i.exec(detailRawById[id]?.html ?? '');
      spells.set(spellId, {
        schemaVersion: RULES_SCHEMA_VERSION, kind: 'spell', id: spellId, name: clean(anchor.text()),
        level: Number.isFinite(level) ? level : levelFromDetail ? Number(levelFromDetail[1]) : null,
        school: clean(values.school) || null,
        classes: splitList(values['spell lists']).map((name) => ({ id: slug(name), name })),
        components: detail.components.length ? detail.components : componentFlags(values.components),
        material: detail.material ?? null,
        ritual: detail.ritual || /\bRitual\b|\bor\s+R\b/i.test(values['casting time'] ?? ''),
        feature: normalizeFeature({
          id: spellId, name: clean(anchor.text()), description: detail.description ?? '',
          mechanics: detail.combat ?? {
          resolution: 'unknown', activation: parseSpellActivation(values['casting time']), range: parseSpellRange(values.range),
            area: null, target: null, attackRoll: null, save: null, damage: [], scaling: null,
            duration: parseSpellDuration(values.duration), concentration: /\bC\b/.test(values.duration ?? ''),
          },
        }),
        sources: [detail.detailSource ?? pageSource(indexRaw)],
      });
    }
  });
  return [...spells.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function featBenefits(raw) {
  if (!raw) return { description: null, benefits: [], prerequisites: null, minimumCharacterLevel: null, abilityScorePrerequisites: [], repeatable: null, source: null };
  const $ = cheerio.load(raw.html); const benefits = []; const description = []; let prerequisites = null; let repeatable = null;
  for (const p of content($).children('p').toArray()) {
    const text = clean($(p).text());
    if (!text || /^source\s*:/i.test(text)) continue;
    const prereq = /^(?:Prerequisite|Prerequisites):\s*(.*)$/i.exec(text);
    if (prereq) { prerequisites = prereq[1]; continue; }
    const repeat = /^Repeatable:?\s*(.*)$/i.exec(text);
    if (repeat) { repeatable = clean(repeat[1]).replace(/^[.:]\s*/, '') || true; continue; }
    const strong = $(p).children('strong').first();
    if (strong.length) {
      const name = clean(strong.text()).replace(/[.:]$/, '');
      const effect = clean(text.slice(strong.text().length).replace(/^\s*[.:]\s*/, ''));
      if (/^prerequisites?$/i.test(name)) { prerequisites = effect; continue; }
      if (/^repeatable$/i.test(name)) { repeatable = effect || true; continue; }
      if (name && effect) benefits.push({ name, description: effect });
      else description.push(text);
    } else description.push(text);
  }
  const minimumCharacterLevel = /\blevel\s+(\d+)\s*\+?/i.exec(prerequisites ?? '');
  const abilityScorePrerequisites = [];
  for (const match of (prerequisites ?? '').matchAll(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+(?:score\s+)?(?:of\s+)?(\d+)\b/gi)) {
    const ability = ABILITY_CODES[match[1].toLowerCase()];
    if (!abilityScorePrerequisites.some((entry) => entry.ability === ability)) abilityScorePrerequisites.push({ ability, minimum: Number(match[2]) });
  }
  return {
    description: description.length ? description.join('\n\n') : null, benefits, prerequisites,
    minimumCharacterLevel: minimumCharacterLevel ? Number(minimumCharacterLevel[1]) : null,
    abilityScorePrerequisites, repeatable, source: pageSource(raw),
  };
}

export function extractFeatCatalog(indexRaw, detailRawById = {}) {
  const $ = cheerio.load(indexRaw.html); const feats = new Map();
  const nodes = orderedContentNodes($, content($)[0]); let heading = '';
  for (const node of nodes) {
    if (/^h[1-6]$/.test(node.name)) { heading = clean($(node).text()); continue; }
    const { headers, rows } = tableRows($, node);
    if (!headers.length || !/^name$/i.test(headers[0])) continue;
    const tab = enclosingTab($, node);
    for (const row of rows) {
      const anchor = linkedRow($, node, row[0]);
      const a = anchor ? $(anchor).find('a[href]').first() : null;
      const pageId = pageIdFromHref(a?.attr('href'), 'feat');
      if (!pageId) continue;
      const id = pageId.split(':')[1];
      const detail = featBenefits(detailRawById[pageId]);
      const benefits = detail.benefits.map((benefit) => normalizeFeature({
        id: `${id}-${slug(benefit.name)}`, ...benefit,
      }));
      const choices = detail.benefits.filter((benefit) => hasChoiceLanguage(benefit.description)).map((benefit) =>
        featAbilityScoreChoice(id, benefit, detail.source ?? pageSource(indexRaw))
          ?? manualChoice({ recordId: id, recordKind: 'feat', feature: benefit.name, prompt: benefit.description,
            source: detail.source ?? pageSource(indexRaw), idSuffix: 'manual' }));
      for (const benefit of benefits) benefit.choices = choices
        .filter((choice) => choice.feature === benefit.name).map((choice) => choice.id);
      const record = feats.get(id) ?? {
        schemaVersion: RULES_SCHEMA_VERSION, kind: 'feat', id, name: clean(a.text()), category: heading,
        variants: [], description: detail.description, benefits,
        prerequisites: detail.prerequisites, minimumCharacterLevel: detail.minimumCharacterLevel,
        abilityScorePrerequisites: detail.abilityScorePrerequisites, repeatable: detail.repeatable,
        sources: [detail.source ?? pageSource(indexRaw)],
        choices,
      };
      if (tab?.label && !record.variants.includes(tab.label)) record.variants.push(tab.label);
      feats.set(id, record);
    }
  }
  return [...feats.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const CURRENCY_CP = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
function parseCost(raw) {
  const m = /^([\d,]+(?:\.\d+)?|\d+\/\d+)\s*(cp|sp|ep|gp|pp)(?:\b|$)/i.exec(clean(raw));
  if (!m) return { raw: raw || null, copperValue: null };
  const amount = m[1].includes('/') ? m[1].split('/').map(Number).reduce((a, b) => a / b) : Number(m[1].replace(/,/g, ''));
  const unit = m[2].toLowerCase();
  return { raw, amount, unit, copperValue: Math.round(amount * CURRENCY_CP[unit]) };
}
function parseWeight(raw) {
  const text = clean(raw);
  const m = /^((?:\d[\d,]*(?:\.\d+)?)(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(lb\.?|lbs?\.?|pound(?:s)?|oz\.?|ounce(?:s)?)$/i.exec(text);
  if (!m) return { raw: raw || null, pounds: null };
  let value;
  if (m[1].includes(' ')) { const [whole, fraction] = m[1].split(/\s+/); value = Number(whole.replace(/,/g, '')) + fraction.split('/').map(Number).reduce((a, b) => a / b); }
  else if (m[1].includes('/')) value = m[1].split('/').map(Number).reduce((a, b) => a / b);
  else value = Number(m[1].replace(/,/g, ''));
  const unit = /^oz|ounce/i.test(m[2]) ? 'oz' : 'lb';
  return { raw, value, unit, pounds: unit === 'oz' ? value / 16 : value };
}

function parseDamage(raw) {
  const match = /^(?:(\d+)d(\d+)|(\d+))\s+([a-z]+)$/i.exec(clean(raw));
  return match ? {
    raw, dice: match[1] ? { count: Number(match[1]), sides: Number(match[2]) } : null,
    flat: match[3] ? Number(match[3]) : 0, damageType: match[4].toLowerCase(),
  } : null;
}

function parseWeaponProperties(raw) {
  return clean(raw).split(/,\s*(?![^()]*\))/).map(clean).filter((entry) => entry && !/^[-—]+$/.test(entry)).map((entry) => {
    const match = /^([^()]+?)(?:\s*\((.*)\))?$/.exec(entry);
    const name = clean(match?.[1] ?? entry);
    return { id: slug(name), name, details: match?.[2] ? clean(match[2]) : null };
  });
}

function parseArmorClass(raw) {
  if (!raw) return null;
  const text = clean(raw);
  const base = /^(\d+)/.exec(text);
  const bonus = /^\+(\d+)/.exec(text);
  const maxDex = /max\s+(\d+)/i.exec(text);
  return {
    raw, base: base ? Number(base[1]) : null, bonus: bonus ? Number(bonus[1]) : null,
    dexterityModifier: /dex\s+modifier/i.test(text), maxDexterityModifier: maxDex ? Number(maxDex[1]) : null,
  };
}

export function extractEquipmentCatalog(rawPages) {
  const items = new Map();
  for (const raw of rawPages) {
    const $ = cheerio.load(raw.html); const nodes = orderedContentNodes($, content($)[0]); let heading = '';
    for (const node of nodes) {
      if (/^h[1-6]$/.test(node.name)) { heading = clean($(node).text()); continue; }
      const { headers, rows } = tableRows($, node);
      if (!headers.length || /^(property|mastery property|condition|damage type)$/i.test(headers[0])) continue;
      for (const row of rows) {
        const name = clean(row[0] ?? '');
        if (!name || /^[-—]+$/.test(name)) continue;
        const id = slug(name);
        const attributes = Object.fromEntries(headers.slice(1).map((header, i) => {
          const key = header.replace(/^(?:(?:simple|martial)\s+)?(?:melee|ranged)\s+weapons?\s+/i, '');
          return [slug(key), row[i + 1] || null];
        }));
        const costText = Object.entries(attributes).find(([key]) => /cost|price/.test(key))?.[1] ?? null;
        const weightText = Object.entries(attributes).find(([key]) => /weight/.test(key))?.[1] ?? null;
        const damageText = attributes.damage ?? null;
        const weaponPropertiesText = Object.entries(attributes).find(([key]) => /weapon-properties$|^properties$/.test(key))?.[1] ?? null;
        const armorClassText = Object.entries(attributes).find(([key]) => /armor-class/.test(key))?.[1] ?? null;
        const strengthText = Object.entries(attributes).find(([key]) => /strength/.test(key))?.[1] ?? null;
        const stealthText = Object.entries(attributes).find(([key]) => /stealth/.test(key))?.[1] ?? null;
        const category = heading || raw.title;
        const isWeapon = /weapon/i.test(raw.requestedTitle) && /weapons?/i.test(category);
        const isArmor = /armor/i.test(raw.requestedTitle);
        const source = pageSource(raw);
        const record = {
          schemaVersion: RULES_SCHEMA_VERSION, kind: 'equipment', id, name,
          category: isWeapon ? 'weapon' : isArmor ? 'armor' : slug(category),
          subcategory: category,
          ...(isWeapon ? { weaponType: /ranged/i.test(headers[0] ?? '') ? 'ranged' : 'melee' } : {}),
          damage: isWeapon ? parseDamage(damageText) : null,
          weaponProperties: isWeapon ? parseWeaponProperties(weaponPropertiesText ?? '') : [],
          mastery: isWeapon ? attributes.mastery ?? null : null,
          armorClass: isArmor ? parseArmorClass(armorClassText) : null,
          strengthRequirement: /^str\s+(\d+)/i.exec(strengthText ?? '') ? Number(/^str\s+(\d+)/i.exec(strengthText)[1]) : null,
          stealthDisadvantage: /disadvantage/i.test(stealthText ?? ''),
          cost: costText ? parseCost(costText) : { raw: null, copperValue: null },
          weight: weightText ? parseWeight(weightText) : { raw: null, pounds: null },
          properties: attributes, description: attributes.function ?? attributes.effect ?? null,
          sources: [source],
        };
        const previous = items.get(id);
        if (previous) {
          if (!previous.sources.some((s) => s.url === source.url)) previous.sources.push(source);
          if (previous.category !== record.category && !previous.alsoCategories?.includes(record.category)) {
            previous.alsoCategories = [...(previous.alsoCategories ?? []), record.category];
          }
        } else items.set(id, record);
      }
    }
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
}
