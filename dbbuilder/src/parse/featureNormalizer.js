import { clean, slug } from '../util.js';

const ABILITIES = {
  strength: 'str', dexterity: 'dex', constitution: 'con',
  intelligence: 'int', wisdom: 'wis', charisma: 'cha',
};
const DAMAGE_TYPES = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const CONDITIONS = 'blinded|charmed|deafened|frightened|grappled|incapacitated|invisible|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious';

function activationFrom(text) {
  const match = /\bas a (bonus action|reaction|free action|action)\b/i.exec(text);
  if (!match) return null;
  const phrase = match[1].toLowerCase();
  const type = phrase === 'bonus action' ? 'bonusAction' : phrase === 'free action' ? 'free' : phrase;
  const trigger = type === 'reaction' ? /\bin response to ([^.]+)/i.exec(text)?.[1]?.trim() ?? null : null;
  return { type, cost: 1, unit: 'action', trigger };
}

function rangeFrom(text) {
  const match = /\b(reach|range)\s+(\d+)\s*(feet|foot|ft\.?)(?:\s*\/\s*(\d+)\s*(?:feet|foot|ft\.?))?/i.exec(text);
  if (!match) return null;
  return { kind: match[1].toLowerCase(), distance: Number(match[2]), unit: 'feet' };
}

function areaFrom(text) {
  const match = /\b(\d+)\s*[- ]foot\s+(radius|diameter)\s+(sphere|cylinder)\b|\b(\d+)\s*[- ]foot\s+(cone|cube|line)\b/i.exec(text);
  if (!match) return null;
  if (match[3]) return {
    shape: match[3].toLowerCase(), size: Number(match[1]), unit: 'feet',
    origin: /centered on (?:a |that )?point/i.test(text) ? 'point' : 'special',
  };
  return { shape: match[5].toLowerCase(), size: Number(match[4]), unit: 'feet', origin: 'self' };
}

function saveFrom(text) {
  const fixed = /\bDC\s+(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw\b/i.exec(text);
  if (fixed) return {
    ability: ABILITIES[fixed[2].toLowerCase()], dcFormula: { kind: 'fixed', value: Number(fixed[1]) },
  };
  const abilityBased = /\bDC\s+(?:equals|=)\s*(\d+)\s*\+\s*(?:your\s+)?proficiency bonus\s*\+\s*(?:your\s+)?(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier/i.exec(text);
  if (abilityBased) return {
    ability: ABILITIES[abilityBased[2].toLowerCase()],
    dcFormula: { kind: 'ability-based', base: Number(abilityBased[1]), proficiencyBonus: true },
  };
  if (/\bspell save DC\b/i.test(text)) return { ability: null, dcFormula: { kind: 'spellcasting' } };
  const save = /\b(?:make|makes|must make)\s+(?:a\s+)?(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw\b/i.exec(text);
  return save ? { ability: ABILITIES[save[1].toLowerCase()], dcFormula: { kind: 'unknown' } } : null;
}

function usesFrom(text) {
  const rest = /\b(once|one|twice|two|three|four|five|six|\d+)\s+(?:(?:use|uses|time|times)\s+)?per (short|long) rest\b/i.exec(text);
  if (rest) {
    const words = { once: 1, one: 1, twice: 2, two: 2, three: 3, four: 4, five: 5, six: 6 };
    return { maximum: Number(rest[1]) || words[rest[1].toLowerCase()], period: `${rest[2].toLowerCase()}-rest` };
  }
  if (/\bproficiency bonus times per long rest\b/i.test(text)) {
    return { maximum: { formula: 'proficiency-bonus' }, period: 'long-rest' };
  }
  const daily = /\b(\d+)\s*\/\s*day\b/i.exec(text);
  if (daily) return { maximum: Number(daily[1]), period: 'day' };
  return null;
}

function durationFrom(text) {
  const match = /\bfor (\d+) (round|minute|hour|day)s?\b/i.exec(text);
  if (match) return { value: Number(match[1]), unit: `${match[2].toLowerCase()}${Number(match[1]) === 1 ? '' : 's'}` };
  if (/\buntil the end of (?:your|its|the target's) next turn\b/i.test(text)) return { value: 1, unit: 'turn' };
  return null;
}

/** Build a stable, source-text-preserving Feature with conservative combat extraction. */
export function normalizeFeature({ id, name, description = '', tables, mechanics = {} }) {
  const text = clean(description);
  const activation = activationFrom(text);
  const range = rangeFrom(text);
  const area = areaFrom(text);
  const attackMatch = /\b(Melee|Ranged) (?:(Weapon|Spell) )?Attack(?: Roll)?\b/i.exec(text);
  const explicitBonus = /\b(?:Melee|Ranged)(?: Weapon)? Attack Roll\s*:?\s*([+-]\d+)/i.exec(text)
    ?? /\b(?:Melee|Ranged) Weapon Attack\s*:?\s*([+-]\d+)\s+to hit/i.exec(text);
  const attackRoll = attackMatch ? {
    type: attackMatch[1].toLowerCase(), kind: attackMatch[2]?.toLowerCase() ?? 'unknown', ability: null,
    bonus: explicitBonus ? Number(explicitBonus[1]) : null,
  } : null;
  const save = saveFrom(text);
  const damagePattern = new RegExp(`(?:\\b\\d[\\d,]*\\s*\\(\\s*(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?)\\s*\\)|\\b(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?))\\s+(${DAMAGE_TYPES})\\s+damage\\b`, 'gi');
  const damage = [...text.matchAll(damagePattern)]
    .map((match) => ({ formula: (match[1] ?? match[2]).replace(/\s+/g, ''), damageType: match[3].toLowerCase(), onSave: null }));
  if (/(?:half as much damage|half damage) on a successful (?:saving throw|save|one)/i.test(text)) {
    for (const entry of damage) entry.onSave = 'half';
  }
  const wrappedHealing = [...text.matchAll(/\b(?:regains?|regain|heals?)\s+\d[\d,]*\s*\(\s*(\d+d\d+(?:\s*\+\s*\d+)?)\s*\)\s*(?:hit points|HP)\b/gi)];
  const plainHealing = [...text.matchAll(/\b(\d+d\d+(?:\s*\+\s*\d+)?)\s+(?:hit points|HP)\b/gi)];
  const healing = [...wrappedHealing.map((match) => match[1]), ...plainHealing.map((match) => match[1])]
    .map((formula) => ({ formula: formula.replace(/\s+/g, ''), onSave: null }));
  const conditionEffects = [...new Set([...text.matchAll(new RegExp(`\\b(?:becomes?|become|is|are)\\s+(${CONDITIONS})\\b`, 'gi'))]
    .map((match) => match[1].toLowerCase()))].map((condition) => ({ condition, duration: null }));
  const rechargeMatch = /\brecharge\s+(\d)(?:\s*[-–]\s*(\d))?\b/i.exec(text);
  const recharge = rechargeMatch ? { kind: 'roll', minimumRoll: Number(rechargeMatch[1]) } : null;
  const uses = usesFrom(text);
  const mechanicsFound = Boolean(activation || range || area || attackRoll || save || damage.length || healing.length || conditionEffects.length || recharge || uses);
  const combatProse = /\b(?:attack|damage|saving throw|hit points|condition|recharge)\b/i.test(text);
  const knownConditionMention = new RegExp(`\\b(?:${CONDITIONS})\\b`, 'i').test(text);
  const incompleteMechanic = ( /\b(?:saving throw|save DC)\b/i.test(text) && !save )
    || save?.dcFormula?.kind === 'unknown'
    || (/\bdamage\b/i.test(text) && !damage.length)
    || (/\b(?:regains?|heals?|restore)\b/i.test(text) && !healing.length)
    || (/\b(?:use|uses|per (?:short|long) rest|per day)\b/i.test(text) && /\b(?:use|uses)\b/i.test(text) && !uses)
    || (/\brecharge\b/i.test(text) && !recharge)
    || (/\b(?:for \d+ (?:round|minute|hour|day)s?|until the end of)\b/i.test(text) && !durationFrom(text))
    || (knownConditionMention && conditionEffects.length === 0)
    || (/\b(?:radius|diameter)\b/i.test(text) && !area);

  const feature = {
    id: id || slug(name), name: clean(name), description,
    activation, range, area,
    target: /\beach creature\b/i.test(text) ? { kind: 'each-creature', count: null } : null,
    attackRoll, save, damage, healing, conditionEffects,
    duration: durationFrom(text), concentration: /\bconcentration\b/i.test(text),
    recharge, uses, resourceCosts: [], choices: [], scaling: null,
    resolution: mechanicsFound ? (incompleteMechanic ? 'partial' : 'structured') : (combatProse ? 'partial' : (text ? 'manual' : 'unknown')),
  };
  for (const key of ['activation', 'range', 'area', 'target', 'attackRoll', 'save', 'damage', 'healing', 'conditionEffects',
    'duration', 'concentration', 'recharge', 'uses', 'resourceCosts', 'scaling', 'resolution']) {
    if (mechanics[key] !== undefined) feature[key] = mechanics[key];
  }
  if (tables) feature.tables = tables;
  return feature;
}
