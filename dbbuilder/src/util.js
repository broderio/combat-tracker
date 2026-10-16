import { createHash } from 'node:crypto';

export const ABILITY_CODES = {
  strength: 'str', dexterity: 'dex', constitution: 'con',
  intelligence: 'int', wisdom: 'wis', charisma: 'cha',
};
export const ABILITIES = Object.values(ABILITY_CODES);

export const SKILLS = [
  'Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History',
  'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception',
  'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival',
];

export const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export const slug = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Key for label/heading comparisons: lowercase alphanumerics only. */
export const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

export const clean = (s) =>
  String(s).replace(/\u00a0/g, ' ').replace(/\[\s*edit\s*\]/gi, '').replace(/\s+/g, ' ').trim();

export const sha1 = (s) => createHash('sha1').update(s).digest('hex');

/** Ability codes mentioned in text, in order of first appearance, unique. */
export function abilitiesIn(text) {
  const found = [];
  for (const m of String(text).matchAll(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b/gi)) {
    const code = ABILITY_CODES[m[1].toLowerCase()];
    if (!found.includes(code)) found.push(code);
  }
  return found;
}

/** Split on a separator regex, ignoring separators inside parentheses. */
export function splitTop(text, sep = /,/) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of String(text)) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && sep.test(ch)) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** "+2" -> 2, "—" -> null, anything else stays a string. */
export function coerce(v) {
  const t = String(v ?? '').trim();
  if (t === '' || /^[—–-]+$/.test(t)) return null;
  return /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : t;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
