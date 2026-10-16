import {
  ABILITY_CODES, SKILLS, WORD_NUM, abilitiesIn, clean, coerce, norm, slug, splitTop,
} from '../util.js';
import { hasChoiceLanguage, manualChoice, normalizeChoice } from '../choiceContract.js';
import { findSection, sectionText, tablesIn, walk } from './htmlToDoc.js';
import { normalizeFeature } from './featureNormalizer.js';
import { RULES_SCHEMA_VERSION } from '../schema/version.js';

export const SCHEMA_VERSION = RULES_SCHEMA_VERSION;
const LEVEL_HEADING = /^(?:level\s+(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)\s+level)\s*[:\-–—]\s*(.+)$/i;
const ORDINAL_COL = /(?:^|\s)([1-9])(?:st|nd|rd|th)?$/i;

const FACT_KEYS = {
  hitDie: ['hitpointdie', 'hitdie', 'hitdice', 'hitpointdice'],
  saves: ['savingthrowproficiencies', 'savingthrows', 'savingthrowproficiency', 'savingthrow'],
  primary: ['primaryability', 'primaryabilities'],
  skills: ['skillproficiencies', 'skillproficiency', 'skills', 'skill'],
  weapons: ['weaponproficiencies', 'weapontraining', 'weapons', 'weapon'],
  armor: ['armortraining', 'armorproficiencies', 'armor', 'armour'],
  tools: ['toolproficiencies', 'toolproficiency', 'tools', 'tool'],
  equipment: ['startingequipment', 'equipment'],
  prereq: ['multiclassprerequisites', 'prerequisites', 'prerequisite', 'abilityscoreminimum', 'multiclasspreq', 'multiclassrequirements'],
  mcProfs: ['proficienciesgained', 'multiclassproficiencies'],
};
const fact = (src, group) => {
  const value = FACT_KEYS[group].map((k) => src.facts[k]).find(Boolean);
  if (value) return value;
  const heading = { armor: /^armor training$/i, equipment: /^starting equipment$/i }[group];
  if (!heading || !src.root) return null;
  const section = findSection(src.root, (s) => heading.test(s.heading));
  return section ? sectionText(section) : null;
};

// ---- core traits -------------------------------------------------------------

export function parseSkills(v) {
  if (!v) return { choose: null, from: [], raw: null };
  const found = SKILLS.filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(v));
  const m = /choose\s+(?:any\s+)?(\d+|one|two|three|four|five|six)|(?:choose\s+)?(?:any\s+)?(\d+|one|two|three|four|five|six)\s+skills?\b/i.exec(v);
  const count = m?.[1] ?? m?.[2];
  const choose = count ? Number(count) || WORD_NUM[count.toLowerCase()] : null;
  const any = found.length === 0 && /\bany\b/i.test(v);
  return { choose, from: any ? [...SKILLS] : found, raw: v };
}

const parseArmor = (v) => ({
  raw: v,
  categories: v ? ['light', 'medium', 'heavy', 'shields'].filter((c) => new RegExp(`\\b${c.replace(/s$/, 's?')}\\b`, 'i').test(v)) : [],
});
const parseWeapons = (v) => ({
  raw: v,
  categories: v ? ['simple', 'martial', 'firearms'].filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(v)) : [],
});
const ARTISAN_TOOLS = [
  'Alchemist’s supplies', 'Brewer’s supplies', 'Calligrapher’s supplies', 'Carpenter’s tools',
  'Cartographer’s tools', 'Cobbler’s tools', 'Cook’s utensils', 'Glassblower’s tools', 'Jeweler’s tools',
  'Leatherworker’s tools', 'Mason’s tools', 'Painter’s supplies', 'Potter’s tools', 'Smith’s tools',
  'Tinker’s tools', 'Weaver’s tools', 'Woodcarver’s tools',
];
const MUSICAL_INSTRUMENTS = [
  'Bagpipes', 'Drum', 'Dulcimer', 'Flute', 'Horn', 'Lute', 'Lyre', 'Pan Flute', 'Shawm', 'Viol',
];
function parseTools(v) {
  if (!v || /^none$/i.test(v)) return { raw: v, items: [], choices: [] };
  const countWord = '(?:\\d+|one|two|three|four|five|six)';
  const artisanChoice = new RegExp(`(?:choose\\s+)?${countWord}\\s+types?\\s+of\\s+artisan(?:’|')s tools?`, 'i').test(v);
  const musicalChoice = new RegExp(`(?:choose\\s+)?${countWord}\\s+(?:(?:types?\\s+of\\s+)?musical instruments?)`, 'i').test(v)
    || /(?:or\s+)?(?:one\s+)?(?:type\s+of\s+)?musical instrument(?: of your choice)?/i.test(v);
  const countMatch = new RegExp(`(?:choose\\s+)?(${countWord})\\s+(?:types?\\s+of\\s+)?(?:artisan(?:’|')s tools?|musical instruments?)`, 'i').exec(v);
  const count = countMatch ? Number(countMatch[1]) || WORD_NUM[countMatch[1].toLowerCase()] : 1;
  const choiceText = /,?\s*(?:(?:and|or)\s+)?(?:(?:choose\s+)?(?:\d+|one|two|three|four|five|six)\s+types?\s+of\s+artisan(?:’|')s tools?(?: of your choice)?(?:\s+or\s+(?:(?:one\s+)?(?:type\s+of\s+)?musical instruments?))?|(?:choose\s+)?(?:\d+|one|two|three|four|five|six)\s+(?:(?:types?\s+of\s+)?musical instruments?)(?: of your choice)?)/ig;
  const items = splitTop(v.replace(choiceText, ''), /[,;]/)
    .map((s) => s.replace(/^(and|or)\s+/i, '').replace(/^(and|or)$/i, '').trim()).filter(Boolean);
  const from = [...(artisanChoice ? ARTISAN_TOOLS : []), ...(musicalChoice ? MUSICAL_INSTRUMENTS : [])];
  return { raw: v, items, choices: from.length ? [{ count, from }] : [] };
}

function parseItems(text) {
  let gold = 0; const items = [];
  const parts = []; let depth = 0; let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth = Math.max(0, depth - 1);
    const conjunction = depth === 0 && /^\s+and\s+/i.test(text.slice(i));
    if (depth === 0 && (text[i] === ',' || text[i] === ';' || conjunction)) {
      parts.push(text.slice(start, i).trim());
      i += conjunction ? text.slice(i).match(/^\s+and\s+/i)[0].length - 1 : 0;
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  for (const part of parts.filter(Boolean)) {
    let p = part.replace(/^(and|or)\s+/i, '').replace(/\.$/, '').trim();
    if (!p) continue;
    const g = /^(\d[\d,]*)\s*gp$/i.exec(p);
    if (g) { gold += Number(g[1].replace(/,/g, '')); continue; }
    const choice = /^(?:any\s+)?(\d+|one|two|three|four|five|six)\s+(simple|martial)\s+weapons?$/i.exec(p);
    if (choice) {
      const quantity = Number(choice[1]) || WORD_NUM[choice[1].toLowerCase()];
      items.push({ name: `${choice[2]} weapons`, quantity, choose: quantity, from: `${choice[2]} weapons` });
      continue;
    }
    const suffixQuantity = /\s*\(\s*x\s*(\d+)\s*\)$/i.exec(p);
    const quantity = suffixQuantity ? Number(suffixQuantity[1]) : null;
    if (suffixQuantity) p = p.slice(0, suffixQuantity.index).trim();
    const wrappedName = /^\(([^()]+)\)$/.exec(p);
    if (wrappedName) p = wrappedName[1].trim();
    const q = /^(\d+)\s+(.+)$/.exec(p);
    const name = (q ? q[2] : p).replace(/^(?:a|an|the)\s+/i, '');
    items.push({ name, quantity: q ? Number(q[1]) : quantity ?? 1 });
  }
  return { items, gold: gold || null };
}

export function parseEquipment(v) {
  if (!v) return { raw: null, options: [] };
  const lines = String(v).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const choices = [];
  const fixed = [];
  for (const [lineIndex, line] of lines.entries()) {
    const content = line.replace(/^[-*•]\s*/, '').trim();
    const markers = [...content.matchAll(/\(([a-z])\)\s*/gi)];
    if (markers.length) {
      const alternatives = markers.map((marker, index) => ({
        id: marker[1].toUpperCase(),
        lineIndex,
        text: content.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? content.length)
          .replace(/^\s*or\s+/i, '').replace(/[;,\s]*\bor\b[\s;,]*$/i, '').replace(/[;\s.]+$/, '').trim(),
      }));
      choices.push(...alternatives);
    } else if (/^[-*•]\s*/.test(line)) {
      fixed.push({ lineIndex, text: content });
    }
  }
  if (!choices.length && !fixed.length) {
    const cash = /\b(?:spend|buy equipment with)\s+([\d,]+)\s*gp\b/i.exec(v);
    const text = cash ? v.slice(0, cash.index).replace(/\b(?:choose|starting)?\s*equipment\b/ig, '').trim() : v;
    fixed.push({ lineIndex: 0, text: text || v });
  }

  const preamble = lines.slice(0, Math.max(0, lines.findIndex((line) => /\([a-z]\)/i.test(line)))).join(' ');
  const forgo = /\bforgo (?:it|this equipment|your equipment)[^.]*?\b(?:spend|buy)[^\d]*([\d,]+)\s*gp\b|\bspend\s+([\d,]+)\s*gp\b/i.exec(preamble || v);
  const cashAmount = forgo?.[1] ?? forgo?.[2];
  const options = (choices.length ? choices : [{ id: 'A', text: '' }]).map((choice, index) => {
    const parts = [...fixed, ...(choice.text ? [choice] : [])].sort((a, b) => a.lineIndex - b.lineIndex).map((part) => part.text);
    const text = parts.join(', ');
    return { id: choice.id || String.fromCharCode(65 + index), raw: text, ...parseItems(text) };
  });
  if (cashAmount) {
    const text = `${cashAmount} GP`;
    options.push({ id: String.fromCharCode(65 + options.length), raw: text, ...parseItems(text) });
  }
  return { raw: v, options };
}

function parsePrimary(v) {
  if (!v) return { abilities: [], join: null };
  const abilities = abilitiesIn(v);
  return { abilities, join: abilities.length < 2 ? null : /\bor\b/i.test(v) ? 'or' : 'and' };
}

export function parsePrereq(text, primaryAbilities = []) {
  const pairs = [...String(text || '').matchAll(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+(\d{1,2})\b/gi)];
  const abilities = []; 
  for (const p of pairs) {
    const ability = ABILITY_CODES[p[1].toLowerCase()];
    if (!abilities.some((a) => a.ability === ability)) abilities.push({ ability, min: Number(p[2]) });
  }
  if (!pairs.length && /\bprimary abilit(?:y|ies)\b/i.test(String(text)) && primaryAbilities.length) {
    const minimum = /\b(\d{1,2})\b/.exec(String(text));
    if (minimum) {
      for (const ability of primaryAbilities) abilities.push({ ability, min: Number(minimum[1]) });
      return { abilities, join: abilities.length > 1 ? 'or' : null };
    }
  }
  let join = null;
  if (pairs.length > 1) {
    const between = text.slice(pairs[0].index + pairs[0][0].length, pairs[1].index);
    join = /\bor\b/i.test(between) ? 'or' : 'and';
  }
  return { abilities, join };
}

// ---- progression table ---------------------------------------------------------

const headerKeys = (t) => (t.headers.length ? t.headers : t.rows[0] || []).map(norm);

export function findProgressionTable(section) {
  return tablesIn(section).find((t) => {
    const h = headerKeys(t);
    return h.some((x) => x === 'level' || x.endsWith('level')) && h.some((x) => x.includes('feature'));
  }) ?? null;
}

export function mapColumns(table) {
  const headers = table.headers.length ? table.headers : table.rows[0] || [];
  const keys = headers.map(norm);
  const col = { level: -1, prof: -1, features: -1, cantrips: -1, prepared: -1, known: -1, pactSlots: -1, pactLevel: -1, slots: [], extras: [] };
  const hasSpellCols = keys.some((k) => k.includes('cantrip') || k.includes('prepared') || k.includes('spellsknown') || k.includes('spellslots'));
  keys.forEach((k, i) => {
    const h = headers[i];
    if (col.level < 0 && k.endsWith('level') && !/(?:min|max|slot|spell)/.test(k)) col.level = i;
    else if (k.startsWith('proficiency') || k === 'profbonus' || k === 'pb') col.prof = i;
    else if (k.includes('feature')) col.features = i;
    else if (k.includes('cantrip')) col.cantrips = i;
    else if (k.includes('preparedspell') || k.includes('spellsprepared')) col.prepared = i;
    else if (k.includes('spellsknown')) col.known = i;
    else if (k === 'spellslots') col.pactSlots = i;
    else if (k.includes('slotlevel')) col.pactLevel = i;
    else if (ORDINAL_COL.test(h) && (hasSpellCols || /slot/i.test(h))) col.slots.push({ index: i, spellLevel: Number(ORDINAL_COL.exec(h)[1]) });
    else if (h.trim()) col.extras.push({ index: i, header: h });
  });
  return col;
}

export function findProgressionTables(section) {
  const tables = tablesIn(section).filter((table) => {
    const col = mapColumns(table);
    return col.level >= 0 && (col.features >= 0 || col.prof >= 0 || col.cantrips >= 0
      || col.prepared >= 0 || col.known >= 0 || col.pactSlots >= 0 || col.slots.length > 0 || col.extras.length > 0);
  });
  const primary = tables.find((table) => mapColumns(table).features >= 0);
  return primary ? [primary, ...tables.filter((table) => table !== primary)] : tables.slice(0, 1);
}

export function readProgression(table) {
  const col = mapColumns(table);
  const body = table.headers.length ? table.rows : table.rows.slice(1);
  const rows = {};
  for (const r of body) {
    const level = parseInt(r[col.level], 10);
    if (!(level >= 1 && level <= 20)) continue;
    rows[level] = {
      level,
      proficiencyBonus: col.prof >= 0 ? coerce(r[col.prof]) : null,
      featureNames: col.features >= 0 ? featureNames(r[col.features]) : [],
      cantrips: col.cantrips >= 0 ? coerce(r[col.cantrips]) : null,
      prepared: col.prepared >= 0 ? coerce(r[col.prepared]) : null,
      known: col.known >= 0 ? coerce(r[col.known]) : null,
      slots: Object.fromEntries(col.slots.map((s) => [s.spellLevel, coerce(r[s.index])]).filter(([, n]) => typeof n === 'number' && n > 0)),
      pact: col.pactSlots >= 0 ? { slots: coerce(r[col.pactSlots]), slotLevel: parseInt(r[col.pactLevel], 10) || null } : null,
      values: Object.fromEntries(col.extras.map((e) => [slug(e.header), progressionValue(r[e.index], e.header)])),
    };
  }
  return { col, rows };
}

function progressionValue(cell, header) {
  const raw = String(cell ?? '').trim();
  if (!raw) return { status: 'unknown', value: null, unit: null };
  if (/^[—–-]+$/.test(raw)) return { status: 'not-applicable', value: null, unit: null };
  const die = /^(\d*)d(\d+)$/i.exec(raw);
  const value = die
    ? { kind: 'dice', count: Number(die[1] || 1), sides: Number(die[2]) }
    : coerce(raw);
  const h = norm(header);
  const unit = /feet|speed|movement/.test(h) ? 'feet'
    : /point/.test(h) ? 'points'
      : /use|rage/.test(h) ? 'uses'
        : /item/.test(h) ? 'items'
          : typeof value === 'number' ? 'count' : null;
  return { status: 'known', value, unit };
}

function mergeProgressions(progressions) {
  const rows = {};
  for (const progression of progressions) {
    for (const [level, row] of Object.entries(progression.rows)) {
      const current = rows[level] ??= { ...row, slots: {}, values: {} };
      if (row.proficiencyBonus != null) current.proficiencyBonus = row.proficiencyBonus;
      if (row.featureNames.length) current.featureNames = row.featureNames;
      for (const key of ['cantrips', 'prepared', 'known']) if (row[key] != null) current[key] = row[key];
      current.slots = { ...current.slots, ...row.slots };
      if (row.pact?.slots != null) current.pact = row.pact;
      current.values = { ...current.values, ...row.values };
    }
  }
  return { rows };
}

function featureNames(cell) {
  if (!cell || /^[—–-]+$/.test(cell.trim())) return [];
  return splitTop(cell, /,/);
}

// ---- spellcasting --------------------------------------------------------------

export function extractSpellcasting(progression, featureText, className = '') {
  const { col, rows } = progression ?? { col: null, rows: {} };
  const rowList = Object.values(rows);
  const has = col && (col.cantrips >= 0 || col.prepared >= 0 || col.known >= 0 || col.slots.length || col.pactSlots >= 0);
  if (!has && !featureText) return null;

  const byLevel = (key) => {
    const entries = rowList.filter((r) => typeof r[key] === 'number').map((r) => [r.level, r[key]]);
    return entries.length ? Object.fromEntries(entries) : null;
  };
  const slotEntries = rowList.filter((r) => Object.keys(r.slots).length).map((r) => [r.level, r.slots]);
  const pactEntries = rowList.filter((r) => r.pact && typeof r.pact.slots === 'number').map((r) => [r.level, r.pact]);
  const maxSlot = Math.max(0, ...slotEntries.flatMap(([, s]) => Object.keys(s).map(Number)));

  const abilityMatch = /\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b[^.]{0,80}spellcasting ability/i.exec(featureText || '')
    ?? /spellcasting ability[^.]{0,80}?\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b/i.exec(featureText || '');
  const listMatch = /\b(artificer|bard|cleric|druid|paladin|ranger|sorcerer|warlock|wizard)\s+spell list/i.exec(featureText || '');
  const generic = new Set(['The', 'Your', 'This', 'That', 'Its', 'A', 'An', 'Class']);
  const classType = {
    bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full',
    artificer: 'half', paladin: 'half', ranger: 'half', warlock: 'pact',
  }[norm(className)];
  const subclassCaster = ['fighter', 'rogue'].includes(norm(className)) && /\bspellcasting\b/i.test(featureText || '');
  const inferredType = classType ?? (subclassCaster ? 'third' : 'other');
  const slotMap = slotEntries.length ? Object.fromEntries(slotEntries) : null;
  const pactSlotMap = pactEntries.length ? Object.fromEntries(pactEntries) : null;
  const preparedSpellsRule = /(?:you prepare[^.]*\.|choose a number of [^.]*?spells?[^.]*\.)/i.exec(featureText || '')?.[0] ?? null;

  return {
    ability: abilityMatch ? ABILITY_CODES[abilityMatch[1].toLowerCase()] : null,
    spellList: listMatch && !generic.has(listMatch[1]) ? listMatch[1].toLowerCase() : null,
    type: pactEntries.length ? 'pact' : maxSlot >= 9 ? 'full' : maxSlot >= 5 ? 'half' : maxSlot >= 4 ? 'third' : inferredType,
    cantripsKnownByLevel: byLevel('cantrips'),
    preparedSpellsByLevel: byLevel('prepared'),
    spellsKnownByLevel: byLevel('known'),
    slotsByLevel: slotMap,
    pactSlotsByLevel: pactSlotMap,
    preparedSpellsRule,
  };
}

// ---- features ------------------------------------------------------------------

function describe(section) {
  const tables = tablesIn(section).map(({ caption, headers, rows }) => ({ caption, headers, rows }));
  const out = { description: sectionText(section) };
  if (tables.length) out.tables = tables;
  return out;
}

/** Features from "Level N: Name" headings under `root` (skipping any section in `exclude`). */
export function levelHeadingFeatures(root, exclude = new Set()) {
  const out = [];
  const featureDescription = (section) => {
    const parts = [];
    for (const block of section.blocks) {
      if (block.type === 'p' && LEVEL_HEADING.test(block.text)) break;
      if (block.type === 'p') parts.push(block.text);
      else if (block.type === 'list') parts.push(block.items.map((item) => `- ${item}`).join('\n'));
    }
    for (const child of section.children) {
      if (LEVEL_HEADING.test(child.heading)) continue;
      const text = featureDescription(child);
      if (text) parts.push(`### ${child.heading}\n\n${text}`);
    }
    return parts.join('\n\n');
  };
  const visit = (s) => {
    if (exclude.has(s)) return;
    const m = LEVEL_HEADING.exec(s.heading);
    if (m && s !== root) {
      const tables = tablesIn(s).map(({ caption, headers, rows }) => ({ caption, headers, rows }));
      out.push({ level: Number(m[1] ?? m[2]), name: clean(m[3]), description: featureDescription(s), ...(tables.length ? { tables } : {}) });
    }
    for (let i = 0; i < s.blocks.length; i++) {
      const block = s.blocks[i];
      if (block.type !== 'p') continue;
      const inline = LEVEL_HEADING.exec(block.text);
      if (!inline) continue;
      const body = [];
      for (let j = i + 1; j < s.blocks.length; j++) {
        const next = s.blocks[j];
        if (next.type === 'p' && LEVEL_HEADING.test(next.text)) break;
        if (next.type === 'p') body.push(next.text);
        else if (next.type === 'list') body.push(next.items.map((item) => `- ${item}`).join('\n'));
      }
      out.push({ level: Number(inline[1] ?? inline[2]), name: clean(inline[3]), description: body.join('\n\n') });
    }
    s.children.forEach(visit);
  };
  visit(root);
  return out;
}

const emptyLevels = () => Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 1, []]));

function repeatedFeatureLevels(feature) {
  const levels = new Set();
  for (const match of feature.description.matchAll(/again at (?:[A-Za-z]+\s+)?levels?\s+([^.;]+)/gi)) {
    for (const level of match[1].matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
      const n = Number(level[1]);
      if (n >= 1 && n <= 20) levels.add(n);
    }
  }
  return [...levels];
}

function selectionCount(text) {
  const match = /\bchoose\s+(?:any\s+)?(\d+|one|two|three|four|five|six)\b/i.exec(text)
    ?? /\b(one|two|three|four|five|six)\s+[^.]{0,45}\bof your choice\b/i.exec(text);
  if (!match) return null;
  return Number(match[1]) || WORD_NUM[match[1].toLowerCase()] || null;
}

function makeChoice({ id, level, feature, prompt, count = 1, countRule = null, options = [], optionSource = null, changeRule = null, scope = 'progression' }) {
  return {
    id, level, feature, prompt, scope,
    selection: { count, countRule },
    options: options.map((option) => typeof option === 'string'
      ? { id: slug(option), label: option }
      : option),
    optionSource, changeRule,
  };
}

function featureChoices(featuresByLevel, ownerId) {
  const choices = [];
  for (const [levelText, features] of Object.entries(featuresByLevel)) {
    for (const feature of features) {
      const text = feature.description.split(/\n\n###\s+/)[0];
      const bullets = [...text.matchAll(/^\s*-\s+([^\n]+)$/gm)].map((m) => m[1].trim());
      const optionLabels = bullets.map((line) => /^(.+?)(?:\s*\([^)]*\))?[.:]/.exec(line)?.[1]?.trim()).filter(Boolean);
      const firstPrompt = text.split(/\n\s*-\s+/)[0].split(/\n\n/)[0].trim();
      const scope = /\b(?:when you|whenever you|if you use|as an action|as a bonus action|as a reaction|on your turn|when .* hits|when .* attacks)\b/i.test(firstPrompt)
        ? 'runtime' : 'progression';
      if (optionLabels.length >= 2 && /\b(?:one of the following|following options? of your choice|choose (?:one|two|three|four|five|six) (?:of )?(?:the following )?options?|one \w+ effect of your choice)\b/i.test(firstPrompt)) {
        const prompt = firstPrompt.length > 280 ? firstPrompt.slice(0, 277).trimEnd() + '...' : firstPrompt;
        choices.push(makeChoice({
          id: `${ownerId}-${levelText}-${slug(feature.name)}-option`, level: Number(levelText), feature: feature.name,
          prompt, count: selectionCount(firstPrompt) ?? 1, options: [...new Set(optionLabels)], scope,
        }));
      }
      if (/instead of choosing[^.]*choose the option below/i.test(text) && optionLabels.length) {
        choices.push(makeChoice({
          id: `${ownerId}-${levelText}-${slug(feature.name)}-alternative`, level: Number(levelText), feature: feature.name,
          prompt: firstPrompt, count: 1, options: [...new Set(optionLabels)], scope,
          optionSource: { type: 'feat-list', id: 'eligible-feats', merge: 'union' },
        }));
      }

      const patterns = [
        { kind: 'weapon-list', regex: /(?:mastery propert(?:y|ies) of\s+)?(\d+|one|two|three|four|five|six) kinds? of (?:simple or martial |simple |martial )?weapons? of your choice/i },
        { kind: 'language-list', regex: /know (\d+|one|two|three|four|five|six) languages? of your choice/i },
        { kind: 'language-list', regex: /one other language of your choice/i },
        { kind: 'feat-list', regex: /(?:feat of your choice|another feat of your choice)/i },
        { kind: 'expertise-target', regex: /choose (\d+|one|two|three|four|five|six) of your (?:skill )?proficiencies with which you lack expertise/i },
        { kind: 'expertise-target', regex: /expertise in (\d+|one|two|three|four|five|six) of your skill proficiencies of your choice/i },
        { kind: 'skill-list', regex: /proficiency in (?:another )?(\d+|one|two|three|four|five|six) skill(?:s)? of your choice/i },
        { kind: 'metamagic-options', regex: /gain (\d+|one|two|three|four|five|six) (?:more )?Metamagic options? of your choice/i },
        { kind: 'infusion-options', regex: /pick (\d+|one|two|three|four|five|six) Artificer Infusions? to learn/i },
        { kind: 'invocation-options', regex: /gain (?:one|1) invocation of your choice/i },
        { kind: 'feature-option-list', regex: /learn (\d+|one|two|three|four|five|six) different Maneuvers? of your choice/i },
        { kind: 'feature-option-list', regex: /learn (\d+|one|two|three|four|five|six) Arcane Shot options? of your choice/i },
        { kind: 'feature-option-list', regex: /learn (\d+|one|two|three|four|five|six) runes? of your choice/i },
      ];
      for (const pattern of patterns) {
        const match = pattern.regex.exec(text);
        if (!match) continue;
        if (pattern.kind === 'feat-list' && /instead of choosing[^.]*choose the option below/i.test(text)) continue;
        const count = match[1] ? Number(match[1]) || WORD_NUM[match[1].toLowerCase()] : 1;
        const optionSource = pattern.kind === 'feat-list' ? { type: 'feat-list', id: 'eligible-feats', eligibility: 'character-and-rule-prerequisites' }
          : pattern.kind === 'expertise-target' ? { type: 'character-proficiencies', id: 'proficiencies-without-expertise' }
            : pattern.kind === 'skill-list' ? { type: 'skill-list', id: `${ownerId}-skills` }
              : pattern.kind === 'infusion-options' ? { type: 'infusion-list', id: 'artificer-infusion-options' }
                : pattern.kind === 'metamagic-options' ? { type: 'metamagic-list', id: 'sorcerer-metamagic-options' }
                  : pattern.kind === 'feature-option-list' ? { type: 'feature-option-list', id: `${ownerId}-${slug(match[0].replace(/^learn\s+(?:\d+|one|two|three|four|five|six)\s+(?:different\s+)?/i, '').replace(/\s+of your choice.*$/i, ''))}` }
                    : { type: pattern.kind, id: pattern.kind };
        const dynamicCount = pattern.kind === 'infusion-options'
          ? 'progression.values.infusions-known.value'
          : pattern.kind === 'invocation-options'
            ? 'progression.values.invocations-known.value'
          : pattern.kind === 'weapon-list' && /when you reach certain .* levels/i.test(text)
            ? 'progression.values.weapon-mastery.value' : null;
        if (pattern.kind === 'invocation-options') {
          optionSource.type = 'invocation-list';
          optionSource.id = 'warlock-invocations';
          optionSource.prerequisites = 'invocation-specific-prerequisites';
          optionSource.allowDuplicates = false;
        }
        choices.push(makeChoice({
          id: `${ownerId}-${levelText}-${slug(feature.name)}-${pattern.kind}`, level: Number(levelText), feature: feature.name,
          prompt: match[0], count: dynamicCount ? null : count, countRule: dynamicCount, optionSource,
          scope: 'progression',
          changeRule: /whenever you (?:finish a long rest|gain a .* level)[^.]*replace|can replace one/i.test(text)
            ? 'Replacement is allowed as described in the feature.'
            : /learn additional (?:Maneuvers|Arcane Shot options|runes)/i.test(text) ? 'The number learned increases as stated in the feature.' : null,
        }));
      }

      if (feature.name.toLowerCase() === 'metamagic') {
        for (const level of [10, 17]) {
          const addition = new RegExp(`two more(?: options)? at Sorcerer level ${level}`, 'i').exec(text)?.[0];
          if (addition) choices.push(makeChoice({
            id: `${ownerId}-${level}-metamagic-metamagic-options`, level, feature: feature.name,
            prompt: addition, count: 2,
            optionSource: { type: 'metamagic-list', id: 'sorcerer-metamagic-options' },
            changeRule: 'Whenever you gain a Sorcerer level, you can replace one option.',
            scope: 'progression',
          }));
        }
      }

      const spellChoice = /(?:choose|learn|know)\s+(\d+|one|two|three|four|five|six)\s+(?:level\s+\d+\s+)?(?:([A-Za-z’'-]+)\s+)?(cantrips?|spells?)(?:\s+of your choice)?(?:\s+from the\s+([A-Za-z’'-]+) spell list)?/i.exec(text);
      if (spellChoice) {
        const spellKind = /cantrip/i.test(spellChoice[3]) ? 'cantrip' : 'spell';
        const progressionField = spellKind === 'cantrip' ? 'progression.cantripsKnownByLevel' : 'progression.preparedSpellsByLevel';
        const growsByLevel = /number of (?:cantrips|spells)[^.]*increases[^.]*table|learn another cantrip[^.]*as shown in the .*table/i.test(text);
        const spellSource = spellChoice[4] ?? spellChoice[2];
        choices.push(makeChoice({
          id: `${ownerId}-${levelText}-${slug(feature.name)}-${spellKind}s`, level: Number(levelText), feature: feature.name,
          prompt: spellChoice[0], count: growsByLevel ? null : Number(spellChoice[1]) || WORD_NUM[spellChoice[1].toLowerCase()],
          countRule: growsByLevel ? progressionField : null,
          optionSource: { type: 'spell-list', id: slug(spellSource || ownerId), spellKind },
          changeRule: /whenever you gain a .* level[^.]*replace/i.test(text) ? 'Replacement is allowed as described in the feature.' : null,
        }));
      }
    }
  }
  return [...new Map(choices.map((choice) => [choice.id, choice])).values()];
}

function classChoices({ id, featuresByLevel, proficiencies, startingEquipment, subclasses, multiclass, spellcasting }) {
  const choices = featureChoices(featuresByLevel, id).filter((choice) =>
    !(choice.optionSource?.type === 'spell-list' && choice.optionSource.spellKind === 'spell'));
  if (proficiencies.skills.choose) {
    choices.push(makeChoice({ id: `${id}-skill-proficiencies`, level: 1, feature: 'Proficiencies',
      prompt: proficiencies.skills.raw ?? 'Choose skill proficiencies.', count: proficiencies.skills.choose,
      options: proficiencies.skills.from, scope: 'build' }));
  }
  for (const [index, choice] of (proficiencies.tools.choices ?? []).entries()) {
    choices.push(makeChoice({ id: `${id}-tool-proficiencies-${index + 1}`, level: 1, feature: 'Proficiencies',
      prompt: proficiencies.tools.raw ?? 'Choose a tool proficiency.', count: choice.count, options: choice.from, scope: 'build' }));
  }
  if (/one skill of your choice/i.test(multiclass?.proficienciesGained ?? '')) {
    choices.push(makeChoice({ id: `${id}-multiclass-skill-proficiency`, level: 1, feature: 'Multiclassing',
      prompt: multiclass.proficienciesGained, count: 1, options: proficiencies.skills.from, scope: 'build' }));
  }
  const subclassFeature = Object.entries(featuresByLevel).flatMap(([level, features]) => features
    .filter((f) => /subclass/i.test(f.name)).map((f) => ({ level: Number(level), feature: f })))[0];
  if (subclassFeature && subclasses.length) {
    choices.push(makeChoice({ id: `${id}-subclass`, level: subclassFeature.level, feature: subclassFeature.feature.name,
      prompt: subclassFeature.feature.description.split('\n')[0], options: subclasses.map((s) => ({ id: s.id, label: s.name })), scope: 'build' }));
  }
  if (startingEquipment.options.length > 1) {
    choices.push(makeChoice({ id: `${id}-starting-equipment`, level: 1, feature: 'Starting Equipment',
      prompt: 'Choose one starting equipment option.', options: startingEquipment.options.map((o) => ({ id: o.id.toLowerCase(), label: `Option ${o.id}` })), scope: 'build' }));
  }
  const spellFeatureText = Object.values(featuresByLevel).flat().filter((f) => /spellcasting|pactmagic/i.test(f.name)).map((f) => f.description).join('\n');
  const isSpellbook = /spellbook/i.test(spellFeatureText);
  if (id === 'wizard' && isSpellbook) {
    choices.push(makeChoice({ id: 'wizard-spellbook-starting', level: 1, feature: 'Spellcasting',
      prompt: 'Choose six level 1 Wizard spells for your starting spellbook.', count: 6,
      optionSource: { type: 'spell-list', id: 'wizard', spellKind: 'spell', spellLevel: 1 }, scope: 'progression' }));
    for (let level = 2; level <= 20; level++) choices.push(makeChoice({
      id: `wizard-${level}-spellbook-spells`, level, feature: 'Spellcasting',
      prompt: 'Add two Wizard spells of a level for which you have spell slots to your spellbook.', count: 2,
      optionSource: { type: 'spell-list', id: 'wizard', spellKind: 'spell', eligibility: 'spell-level-unlocked-at-class-level' },
      scope: 'progression',
    }));
    choices.push(makeChoice({ id: 'wizard-prepared-spells', level: 1, feature: 'Spellcasting',
      prompt: 'Prepare spells from your spellbook after each Long Rest.', count: null,
      countRule: 'max(1, abilityModifier(int) + classLevel(wizard))',
      optionSource: { type: 'character-spellbook', id: 'wizard-spellbook', spellKind: 'spell' }, scope: 'preparation' }));
  }
  for (const [field, label] of (isSpellbook ? [] : [['preparedSpellsByLevel', 'Prepared Spells'], ['spellsKnownByLevel', 'Spells Known']])) {
    const progression = spellcasting?.[field];
    if (!progression) continue;
    choices.push(makeChoice({
      id: `${id}-${slug(label)}`, level: 1, feature: 'Spellcasting',
      prompt: spellcasting.preparedSpellsRule ?? `Select ${label.toLowerCase()} as permitted by the spellcasting feature.`,
      count: progression[1] ?? null, countRule: `progression.${field}`,
      optionSource: isSpellbook ? { type: 'spellbook', id: `${id}-spellbook`, spellKind: 'spell' }
        : { type: 'spell-list', id: spellcasting.spellList ?? id, spellKind: 'spell' },
      scope: 'preparation',
    }));
  }
  if (spellcasting?.cantripsKnownByLevel && !choices.some((choice) =>
    choice.optionSource?.spellKind === 'cantrip' && norm(choice.feature) === 'spellcasting')) {
    choices.push(makeChoice({
      id: `${id}-cantrips`, level: 1, feature: 'Spellcasting',
      prompt: `Select cantrips as permitted by the spellcasting feature.`,
      count: spellcasting.cantripsKnownByLevel[1] ?? null, countRule: 'progression.cantripsKnownByLevel',
      optionSource: { type: 'spell-list', id: spellcasting.spellList ?? id, spellKind: 'cantrip' },
      scope: 'progression',
    }));
  }
  const conditionalFollowUps = {
    cleric: { choiceId: 'cleric-1-divine-order-option', selectedOptionIds: ['thaumaturge'], followUpId: 'cleric-1-divine-order-cantrips' },
    druid: { choiceId: 'druid-1-primal-order-option', selectedOptionIds: ['magician'], followUpId: 'druid-1-primal-order-cantrips' },
    paladin: { choiceId: 'paladin-2-fighting-style-alternative', selectedOptionIds: ['blessed-warrior'], followUpId: 'paladin-2-fighting-style-cantrips' },
    ranger: { choiceId: 'ranger-2-fighting-style-alternative', selectedOptionIds: ['druidic-warrior'], followUpId: 'ranger-2-fighting-style-cantrips' },
  }[id];
  if (conditionalFollowUps) for (const choice of choices) {
    if (choice.id === conditionalFollowUps.followUpId) {
      const { followUpId, ...dependency } = conditionalFollowUps;
      choice.dependsOn = dependency;
    }
  }
  if (id === 'warlock' && featuresByLevel[11]?.some((feature) => /mystic arcanum/i.test(feature.name))) {
    for (const [level, spellLevel] of [[11, 6], [13, 7], [15, 8], [17, 9]]) choices.push(makeChoice({
      id: `warlock-${level}-mystic-arcanum-spell`, level, feature: 'MYSTIC ARCANUM',
      prompt: `Choose one level ${spellLevel} Warlock spell for your Mystic Arcanum.`, count: 1,
      optionSource: { type: 'spell-list', id: 'warlock', spellKind: 'spell', spellLevel },
      changeRule: 'Whenever you gain a Warlock level, you can replace this spell with another Warlock spell of the same level.',
      scope: 'progression',
    }));
  }
  if (id === 'wizard' && isSpellbook) {
    for (const spellLevel of [1, 2]) choices.push(makeChoice({
      id: `wizard-18-spell-mastery-level-${spellLevel}`, level: 18, feature: 'SPELL MASTERY',
      prompt: `Choose one level ${spellLevel} spell in your spellbook with a casting time of an action.`, count: 1,
      optionSource: { type: 'character-spellbook', id: 'wizard-spellbook', spellKind: 'spell', spellLevel, castingTime: 'action' },
      scope: 'progression',
    }));
    choices.push(makeChoice({ id: 'wizard-20-signature-spells', level: 20, feature: 'SIGNATURE SPELLS',
      prompt: 'Choose two level 3 spells in your spellbook as your Signature Spells.', count: 2,
      optionSource: { type: 'character-spellbook', id: 'wizard-spellbook', spellKind: 'spell', spellLevel: 3 },
      scope: 'progression',
    }));
  }
  return choices;
}

/** Linked subclass pages listed under a class's level-three subclass feature. */
export function subclassPageTitles(doc) {
  const titles = new Set();
  for (const section of walk(doc.root)) {
    const match = LEVEL_HEADING.exec(section.heading);
    if ((match && Number(match[1] ?? match[2]) === 3 && /subclass/i.test(match[3]))
      || /subclasses/i.test(section.heading)) {
      section.links.forEach((title) => titles.add(title));
    }
  }
  return [...titles];
}

// ---- subclasses ----------------------------------------------------------------

export function extractSubclass({ section, className, name, edition, source, classSpellcasting = null }) {
  const feats = levelHeadingFeatures(section);
  const featuresByLevel = {};
  for (const f of feats) (featuresByLevel[f.level] ??= []).push(normalizeFeature({
    id: `${slug(name)}-${f.level}-${slug(f.name)}`, name: f.name, description: f.description, ...(f.tables ? { tables: f.tables } : {}),
  }));
  const table = findProgressionTables(section).find((candidate) => {
    const col = mapColumns(candidate);
    return col.cantrips >= 0 || col.prepared >= 0 || col.known >= 0 || col.pactSlots >= 0 || col.slots.length > 0;
  }) ?? null;
  const spellFeature = feats.find((f) => norm(f.name) === 'spellcasting');
  const spellcasting = table || spellFeature ? extractSpellcasting(table ? readProgression(table) : null, sectionText(section), className) : null;
  if (spellcasting && classSpellcasting) {
    spellcasting.ability ??= classSpellcasting.ability;
    spellcasting.spellList ??= classSpellcasting.spellList;
  }
  const choices = contractFeatureChoices(featureChoices(featuresByLevel, slug(name)), featuresByLevel, {
    recordId: slug(name), recordKind: 'subclass', classId: slug(className), source,
  });
  linkFeatureChoices(featuresByLevel, choices);
  return {
    schemaVersion: SCHEMA_VERSION, kind: 'subclass',
    id: slug(name), classId: slug(className), name, edition, sources: [source],
    description: sectionText(section, { children: false }),
    featuresByLevel,
    choices,
    spellcasting,
  };
}

function linkFeatureChoices(featuresByLevel, choices) {
  for (const [levelText, features] of Object.entries(featuresByLevel)) for (const feature of features) {
    feature.choices = choices
      .filter((choice) => choice.level === Number(levelText) && norm(choice.feature) === norm(feature.name))
      .map((choice) => choice.id);
  }
}

function contractFeatureChoices(choices, featuresByLevel, context) {
  const result = [...choices];
  for (const [levelText, features] of Object.entries(featuresByLevel)) {
    for (const feature of features) {
      if (!hasChoiceLanguage(feature.description)) continue;
      const represented = result.some((choice) => choice.level === Number(levelText) && norm(choice.feature) === norm(feature.name));
      if (!represented) result.push(manualChoice({
        ...context, level: Number(levelText), feature: feature.name,
        prompt: feature.description.split(/\n\n/)[0].slice(0, 280),
      }));
    }
  }
  return [...new Map(result.map((choice) => [choice.id, normalizeChoice(choice, context)])).values()];
}

function inlineSubclasses(root) {
  const container = findSection(root, (s) => /subclass/i.test(s.heading) && !LEVEL_HEADING.test(s.heading));
  if (!container) return { container: null, sections: [] };
  const sections = container.children.filter((c) => levelHeadingFeatures(c).length > 0);
  return { container, sections };
}

const cleanSubclassName = (heading, className) => clean(
  heading.replace(new RegExp(`^${className}\\s*(subclass)?\\s*[:\\-–—/(]\\s*`, 'i'), '')
    .replace(/^.*\bsubclass\s*[:\-–—]\s*/i, '').replace(/\s*\([^)]*subclass[^)]*\)\s*$/i, '').replace(/\)$/, ''));

// ---- class -----------------------------------------------------------------------

/**
 * @param doc            Doc for the class page
 * @param ctx            { name, edition, source, linkedSubclasses: [{doc, source}], multiclass: {prerequisites, proficienciesGained}|null }
 * @returns { record, subclasses, warnings }
 */
export function extractClass(doc, ctx) {
  const { name, edition, source } = ctx;
  const warnings = [];
  const root = doc.root;
  const { container, sections: inlineSecs } = inlineSubclasses(root);
  const exclude = new Set(container ? [...walk(container)] : []);

  const tables = findProgressionTables(root);
  const table = tables[0] ?? null;
  const progression = tables.length ? mergeProgressions(tables.map(readProgression)) : null;
  if (!progression) warnings.push('no class progression table found; proficiency bonuses inferred from level');
  const resolvedProgression = progression ?? { rows: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [i + 1, { level: i + 1, proficiencyBonus: 2 + Math.floor(i / 4), values: {} }]),
  ) };

  // features: heading-derived first, table fills in names (and levels) that headings did not cover
  const headingFeats = levelHeadingFeatures(root, exclude);
  const byName = new Map();
  for (const s of walk(root)) if (!exclude.has(s) && s !== root && !LEVEL_HEADING.test(s.heading)) {
    const k = norm(s.heading); if (!byName.has(k)) byName.set(k, s);
  }
  const sectionForFeature = (featureName) => {
    const direct = byName.get(norm(featureName));
    if (direct) return direct;
    return byName.get(norm(featureName.replace(/\([^)]*\)/g, '').replace(/\bfeature\b/ig, '')));
  };
  const headingForFeature = (level, featureName) => {
    const exact = headingKey.get(`${level}:${norm(featureName)}`);
    if (exact) return exact;
    const base = norm(featureName.replace(/\([^)]*\)/g, '').replace(/\bfeature\b/ig, ''));
    return headingFeats.find((f) => norm(f.name.replace(/\([^)]*\)/g, '').replace(/\bfeature\b/ig, '')) === base);
  };
  const featuresByLevel = emptyLevels();
  const seen = new Set();
  const add = (level, f) => {
    const key = `${level}:${norm(f.name)}`;
    if (!featuresByLevel[level]) return;
    if (seen.has(key)) {
      const existing = featuresByLevel[level].find((item) => norm(item.name) === norm(f.name));
      if (existing && !existing.description && f.description) {
        Object.assign(existing, normalizeFeature({
          id: `${slug(name)}-${level}-${slug(f.name)}`, name: f.name, description: f.description,
          ...(f.tables ? { tables: f.tables } : {}),
        }));
      }
      return;
    }
    seen.add(key);
    featuresByLevel[level].push(normalizeFeature({
      id: `${slug(name)}-${level}-${slug(f.name)}`, name: f.name, description: f.description ?? '',
      ...(f.tables ? { tables: f.tables } : {}),
    }));
  };
  const headingKey = new Map(headingFeats.map((f) => [`${f.level}:${norm(f.name)}`, f]));
  const unmatchedTableFeatures = new Set();
  if (progression) {
    for (const row of Object.values(progression.rows)) {
      for (const fname of row.featureNames) {
        const h = headingForFeature(row.level, fname);
        const sec = sectionForFeature(fname);
        const subclassFeature = /subclass|specialist/i.test(fname);
        if (h) add(row.level, h);
        else if (subclassFeature) add(row.level, {
          name: fname,
          description: 'Gain the feature granted by your chosen subclass at this class level; see the subclass record for its description.',
        });
        else if (sec) add(row.level, { name: fname, ...describe(sec) });
        else unmatchedTableFeatures.add(fname);
      }
    }
  }
  if (unmatchedTableFeatures.size) warnings.push(
    `progression chart feature labels not found in current page headings (possible stale chart): ${[...unmatchedTableFeatures].join(', ')}`,
  );
  headingFeats.forEach((f) => {
    add(f.level, f);
    repeatedFeatureLevels(f).forEach((level) => add(level, f));
  });

  const missingDesc = Object.values(featuresByLevel).flat().filter((f) => !f.description).map((f) => f.name);
  if (missingDesc.length) warnings.push(`features without a description: ${[...new Set(missingDesc)].join(', ')}`);
  // spellcasting
  const spellFeat = Object.values(featuresByLevel).flat().find((f) => ['spellcasting', 'pactmagic'].includes(norm(f.name)));
  const spellcasting = extractSpellcasting(progression, spellFeat?.description ?? '', name);
  if (spellcasting && !spellcasting.ability) warnings.push('spellcasting ability not found in the Spellcasting feature text');

  // core traits
  const proficiencies = {
    armor: parseArmor(fact(doc, 'armor')),
    weapons: parseWeapons(fact(doc, 'weapons')),
    tools: parseTools(fact(doc, 'tools')),
    skills: parseSkills(fact(doc, 'skills')),
  };

  // multiclass: dedicated Multiclassing page wins, then the class page's own section/facts
  const mcSec = findSection(root, (s) => /multiclass/i.test(s.heading));
  const mcFacts = mcSec ?? doc;
  const mcText = mcSec ? sectionText(mcSec) : '';
  const primaryAbility = parsePrimary(fact(doc, 'primary') ?? fact(doc, 'prereq'));
  let prereq = ctx.multiclass?.prerequisites ?? parsePrereq(fact(mcFacts, 'prereq') ?? mcText, primaryAbility.abilities);
  if (!prereq.abilities.length && primaryAbility.abilities.length) {
    prereq = {
      abilities: primaryAbility.abilities.map((ability) => ({ ability, min: 13 })),
      join: primaryAbility.join,
    };
  }
  const multiclass = {
    prerequisites: prereq,
    proficienciesGained: ctx.multiclass?.proficienciesGained ?? fact(mcFacts, 'mcProfs') ?? null,
  };
  if (!prereq.abilities.length) warnings.push('multiclass prerequisites not found');

  // subclasses
  const subclasses = [];
  for (const sec of inlineSecs) {
    subclasses.push(extractSubclass({ section: sec, className: name, name: cleanSubclassName(sec.heading, name), edition, source, classSpellcasting: spellcasting }));
  }
  for (const { doc: sdoc, source: ssource } of ctx.linkedSubclasses ?? []) {
    subclasses.push(extractSubclass({ section: sdoc.root, className: name, name: cleanSubclassName(sdoc.title, name), edition, source: ssource, classSpellcasting: spellcasting }));
  }
  const subclassLevels = new Set(subclasses.flatMap((sc) => Object.keys(sc.featuresByLevel).map(Number)));
  for (const level of subclassLevels) {
    if (featuresByLevel[level]?.some((f) => /subclass/i.test(f.name))) continue;
    add(level, {
      name: 'Subclass Feature',
      description: 'Gain the feature granted by your chosen subclass at this class level; see the subclass record for its description.',
    });
  }
  if (!subclasses.length) warnings.push('no subclasses found (inline "Subclasses" section or linked pages)');
  for (const sc of subclasses) if (!Object.keys(sc.featuresByLevel).length) warnings.push(`subclass "${sc.name}" has no "Level N:" features`);

  const record = {
    schemaVersion: SCHEMA_VERSION, kind: 'class',
    id: slug(name), name, edition, sources: [source],
    primaryAbility,
    hitDie: (() => { const m = /d\s?(\d+)/i.exec(fact(doc, 'hitDie') ?? ''); return m ? Number(m[1]) : null; })(),
    savingThrows: abilitiesIn(fact(doc, 'saves') ?? ''),
    proficiencies,
    startingEquipment: parseEquipment(fact(doc, 'equipment')),
    progression: Object.fromEntries(Object.values(resolvedProgression.rows).map((r) => [r.level, { proficiencyBonus: r.proficiencyBonus, values: r.values ?? {} }])),
    featuresByLevel,
    spellcasting,
    choices: [],
    subclasses: subclasses.map((s) => ({ id: s.id, name: s.name, path: `subclasses/${s.id}.json` })),
    multiclass,
  };
  record.choices = contractFeatureChoices(classChoices({
    id: record.id, featuresByLevel, proficiencies, startingEquipment: record.startingEquipment,
    subclasses: subclasses.map((s) => ({ id: s.id, name: s.name })), multiclass, spellcasting,
  }), featuresByLevel, { recordId: record.id, recordKind: 'class', classId: record.id, source });
  linkFeatureChoices(featuresByLevel, record.choices);
  return { record, subclasses, warnings };
}

/** Parse a stand-alone "Multiclassing" page: tables with a class column plus prerequisite / proficiency columns. */
export function extractMulticlassIndex(doc, classNames) {
  const index = {};
  for (const t of tablesIn(doc.root)) {
    const keys = headerKeys(t);
    const ci = keys.findIndex((k) => k === 'class');
    if (ci < 0) continue;
    const pi = keys.findIndex((k) => k.includes('abilityscore') || k.includes('prerequisite'));
    const gi = keys.findIndex((k) => k.includes('proficienc'));
    const body = t.headers.length ? t.rows : t.rows.slice(1);
    for (const r of body) {
      const cls = classNames.find((n) => norm(n) === norm(r[ci]));
      if (!cls) continue;
      const id = slug(cls); index[id] ??= {};
      if (pi >= 0) index[id].prerequisites = parsePrereq(r[pi]);
      if (gi >= 0) index[id].proficienciesGained = r[gi];
    }
  }
  return index;
}
