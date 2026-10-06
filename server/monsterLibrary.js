import { MonsterInstance } from '../shared/schema.js';
import { localRules } from './localRules.js';

function toAbilityScores(record) {
  return Object.fromEntries(
    Object.entries(record.abilityScores || {}).flatMap(([key, value]) =>
      Number.isFinite(value?.score) ? [[key, value.score]] : []
    )
  );
}

function toAbilityModifiers(record) {
  return Object.fromEntries(
    Object.entries(record.abilityScores || {}).flatMap(([key, value]) =>
      Number.isFinite(value?.modifier) ? [[key, value.modifier >= 0 ? `+${value.modifier}` : `${value.modifier}`]] : []
    )
  );
}

function toAction(entry) {
  const damageParts = entry.damage || [];
  const reach = (entry.targeting || []).find((target) => target.kind === 'reach')?.distanceFeet;
  const attack = entry.attackRolls?.[0];
  return {
    name: entry.name,
    toHit: Number.isFinite(attack?.bonus) ? `${attack.bonus >= 0 ? '+' : ''}${attack.bonus}` : null,
    attackType: attack?.kind || null,
    reach: Number.isFinite(reach) ? `${reach} ft.` : null,
    targets: null,
    damage: damageParts.map((part) => `${part.formula}${part.damageType ? ` ${part.damageType}` : ''}`).join(' + ') || null,
    damageType: damageParts.map((part) => part.damageType).filter(Boolean).join(', ') || null,
    desc: entry.description || '',
  };
}

function toFeatures(entries = []) {
  return entries.map((entry) => ({ name: entry.name, desc: entry.description || '' }));
}

function toSpellcasting(abilities) {
  const groups = ['traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions'];
  const feature = groups.flatMap((key) => abilities[key] || []).find((entry) => entry.spellcasting);
  if (!feature?.spellcasting) return null;
  return {
    ability: feature.spellcasting.ability || null,
    innate: Object.fromEntries(
      (feature.spellcasting.spellsByFrequency || []).map((group) => [group.frequency, group.spellNames || []])
    ),
    spellsByLevel: null,
    spellList: null,
  };
}

function toTemplate(entry, summary = null) {
  const monster = MonsterInstance.default();
  const abilities = entry.abilities || {};
  const actions = (abilities.actions || []).map(toAction);
  const speedModes = entry.speed?.modes || [];
  monster.id = entry.id;
  monster.name = entry.name;
  monster.description = entry.description || '';
  monster.size = entry.size || '';
  monster.type = entry.creatureType || '';
  monster.alignment = entry.alignment || '';
  monster.cr = entry.challengeRating?.numeric ?? summary?.challengeRating?.numeric ?? null;
  monster.ac = entry.armorClass?.value ?? summary?.armorClass ?? null;
  monster.hpMax = entry.hitPoints?.average ?? summary?.hitPoints ?? null;
  monster.hitDice = entry.hitPoints?.hitDice || null;
  monster.speed = entry.speed?.raw || speedModes.map(({ mode, feet }) => `${mode} ${feet} ft.`).join(', ');
  monster.xp = entry.experiencePoints ?? null;
  monster.proficiencyBonus = entry.proficiencyBonus ?? null;
  monster.passivePerception = Number(/Passive Perception\s+(\d+)/i.exec(entry.senses || '')?.[1]) || null;
  monster.senses = entry.senses || null;
  monster.skills = (entry.skills || []).map((skill) => `${skill.name} ${skill.bonus >= 0 ? '+' : ''}${skill.bonus}`).join(', ') || null;
  monster.savingThrows = Object.entries(entry.abilityScores || {})
    .filter(([, value]) => Number.isFinite(value.savingThrow))
    .map(([key, value]) => `${key.toUpperCase()} ${value.savingThrow >= 0 ? '+' : ''}${value.savingThrow}`).join(', ') || null;
  monster.languages = entry.languages || null;
  monster.conditionImmunities = entry.conditionImmunities || null;
  monster.damageImmunities = entry.damageImmunities || null;
  monster.damageResistances = entry.damageResistances || null;
  monster.damageVulnerabilities = entry.damageVulnerabilities || null;
  monster.abilityScores = toAbilityScores(entry);
  monster.abilityModifiers = toAbilityModifiers(entry);
  monster.traits = toFeatures(abilities.traits);
  monster.actions = actions;
  monster.attacks = actions.filter((action) => action.toHit !== null || action.damage !== null);
  monster.bonusActions = toFeatures(abilities.bonusActions);
  monster.reactions = toFeatures(abilities.reactions);
  monster.legendaryActions = toFeatures(abilities.legendaryActions);
  monster.spellcasting = toSpellcasting(abilities);
  monster.tokenImageUrl = null;
  monster.source = (entry.publications || []).join(', ');

  const template = monster.toJSON();
  delete template.hp;
  delete template.statusEffects;
  delete template.templateId;
  return template;
}

export class MonsterLibrary {
  getTemplate(id) {
    const summary = localRules.getCatalog('monsters').find((item) => item.id === id);
    const entry = summary?.detailAvailable ? localRules.getRecord(summary.path) : null;
    if (!entry || !Number.isFinite(summary.armorClass) || !Number.isFinite(summary.hitPoints)) return null;
    return toTemplate(entry, summary);
  }

  search({ name, crMin, crMax, type, limit } = {}) {
    const nameNeedle = (name || '').trim().toLowerCase();
    const typeNeedle = (type || '').trim().toLowerCase();
    const min = crMin !== undefined && crMin !== '' ? Number(crMin) : null;
    const max = crMax !== undefined && crMax !== '' ? Number(crMax) : null;
    const cap = Math.max(1, Math.min(200, Number(limit) || 50));
    const results = [];

    for (const entry of localRules.getCatalog('monsters')) {
      const cr = entry.challengeRating?.numeric ?? null;
      if (nameNeedle && !entry.name.toLowerCase().includes(nameNeedle)) continue;
      if (typeNeedle && (entry.creatureType || '').toLowerCase() !== typeNeedle) continue;
      if (min !== null && !Number.isNaN(min) && (cr === null || cr < min)) continue;
      if (max !== null && !Number.isNaN(max) && (cr === null || cr > max)) continue;
      if (!Number.isFinite(entry.armorClass) || !Number.isFinite(entry.hitPoints)) continue;
      results.push({
        id: entry.id,
        name: entry.name,
        size: entry.size,
        type: entry.creatureType,
        cr,
        ac: entry.armorClass,
        hpMax: entry.hitPoints,
      });
      if (results.length >= cap) break;
    }
    return results;
  }
}

export const monsterLibrary = new MonsterLibrary();
