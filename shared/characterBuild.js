const LEVEL_CAP = 20;

export function calculateAbilityModifier(score) {
  const value = Number(score);
  return Number.isFinite(value) ? Math.floor((value - 10) / 2) : null;
}

export function calculateProficiencyBonus(totalLevel) {
  const level = Number(totalLevel);
  return Number.isInteger(level) && level >= 1 && level <= LEVEL_CAP ? Math.floor((level - 1) / 4) + 2 : null;
}

/** Calculate a rules-based maximum HP estimate using max HP at level 1 and fixed averages afterward. */
export function calculateAverageMaximumHitPoints(classes, hitDice, constitutionScore) {
  const selections = Array.isArray(classes) ? classes : [];
  const conScore = Number(constitutionScore);
  if (!selections.length || !Number.isInteger(conScore) || conScore < 1 || conScore > 30) {
    return { status: 'unknown', maximum: null, breakdown: [] };
  }

  const conModifier = calculateAbilityModifier(conScore);
  const hitDieFor = (classId) => Number(hitDice instanceof Map ? hitDice.get(classId) : hitDice?.[classId]);
  const breakdown = [];
  let maximum = 0;
  let totalLevel = 0;

  for (const [index, selection] of selections.entries()) {
    const classId = String(selection?.classId || '').trim();
    const classLevel = Number(selection?.classLevel);
    const hitDie = hitDieFor(classId);
    if (!classId || !Number.isInteger(classLevel) || classLevel < 1 || classLevel > LEVEL_CAP
      || ![6, 8, 10, 12].includes(hitDie)) {
      return { status: 'unknown', maximum: null, breakdown: [] };
    }
    totalLevel += classLevel;
    if (totalLevel > LEVEL_CAP) return { status: 'unknown', maximum: null, breakdown: [] };

    if (index === 0) {
      const firstLevelGain = Math.max(1, hitDie + conModifier);
      maximum += firstLevelGain;
      breakdown.push({ classId, hitDie, levels: 1, hpPerLevel: firstLevelGain, subtotal: firstLevelGain, firstLevel: true });
      const laterLevels = classLevel - 1;
      if (laterLevels > 0) {
        const averageGain = Math.max(1, Math.floor(hitDie / 2) + 1 + conModifier);
        maximum += laterLevels * averageGain;
        breakdown.push({ classId, hitDie, levels: laterLevels, hpPerLevel: averageGain, subtotal: laterLevels * averageGain, firstLevel: false });
      }
    } else {
      const averageGain = Math.max(1, Math.floor(hitDie / 2) + 1 + conModifier);
      maximum += classLevel * averageGain;
      breakdown.push({ classId, hitDie, levels: classLevel, hpPerLevel: averageGain, subtotal: classLevel * averageGain, firstLevel: false });
    }
  }

  return { status: 'calculated', maximum, conModifier, breakdown };
}

function slotsAtLevel(table, level) {
  const row = table?.[String(level)];
  if (!row || typeof row !== 'object') return null;
  return Object.fromEntries(Object.entries(row)
    .map(([slotLevel, count]) => [String(Number(slotLevel)), Number(count)])
    .filter(([slotLevel, count]) => /^[1-9]$/.test(slotLevel) && Number.isInteger(count) && count > 0));
}

function subclassSpellSlotsByClassLevel(subclassRecord) {
  const slots = {};
  for (const features of Object.values(subclassRecord?.featuresByLevel || {})) {
    for (const feature of features || []) {
      for (const table of feature.tables || []) {
        const headers = table.headers || [];
        const levelColumn = headers.findIndex((header) => /\blevel\b/i.test(header));
        const slotColumns = headers.map((header, index) => {
          const match = /^(\d+)(?:st|nd|rd|th)(?: level)?$/i.exec(String(header).trim());
          return match ? [index, Number(match[1])] : null;
        }).filter(Boolean);
        if (levelColumn < 0 || !slotColumns.length) continue;
        for (const row of table.rows || []) {
          const classLevel = Number(row[levelColumn]);
          if (!Number.isInteger(classLevel) || classLevel < 1 || classLevel > LEVEL_CAP) continue;
          const bySlotLevel = Object.fromEntries(slotColumns.flatMap(([column, slotLevel]) => {
            const count = Number(row[column]);
            return Number.isInteger(count) && count > 0 ? [[String(slotLevel), count]] : [];
          }));
          if (Object.keys(bySlotLevel).length) slots[String(classLevel)] = bySlotLevel;
        }
      }
    }
  }
  return slots;
}

function recordContext(classRecords, classId) {
  const context = classRecords instanceof Map ? classRecords.get(classId) : classRecords?.[classId];
  if (!context) return null;
  return context.classRecord ? context : { classRecord: context, subclassRecord: null };
}

/**
 * Derive spell-slot maxima from the selected class records. Unknown or
 * incompatible progressions are explicitly withheld rather than guessed.
 */
export function calculateCharacterDerivedValues({ build = {}, classRecords = new Map(), multiclassSlotTable = null } = {}) {
  const selections = Array.isArray(build.classes) ? build.classes : [];
  if (!selections.length) return { spellSlots: { status: 'not-applicable', byLevel: {} } };

  const spellcasters = [];
  for (const selection of selections) {
    const classLevel = Number(selection.classLevel);
    const context = recordContext(classRecords, selection.classId);
    if (!Number.isInteger(classLevel) || classLevel < 1 || classLevel > LEVEL_CAP || !context?.classRecord) {
      return { spellSlots: { status: 'unknown', byLevel: {} } };
    }
    const progression = context.classRecord.spellcasting;
    if (progression?.type && progression.type !== 'pact') {
      spellcasters.push({ classLevel, progression, subclassSlots: null });
      continue;
    }
    if (progression?.type === 'pact') {
      spellcasters.push({ classLevel, progression, subclassSlots: null });
      continue;
    }
    const subclassSlots = subclassSpellSlotsByClassLevel(context.subclassRecord);
    if (Object.keys(subclassSlots).length) spellcasters.push({ classLevel, progression: { type: 'third' }, subclassSlots });
  }

  if (!spellcasters.length) return { spellSlots: { status: 'not-applicable', byLevel: {} } };

  const pactCasters = spellcasters.filter(({ progression }) => progression.type === 'pact');
  const standardCasters = spellcasters.filter(({ progression }) => progression.type !== 'pact');
  if (pactCasters.length && standardCasters.length) {
    return { spellSlots: { status: 'unsupported', byLevel: {} } };
  }
  if (pactCasters.length) {
    if (pactCasters.length !== 1) return { spellSlots: { status: 'unsupported', byLevel: {} } };
    const { progression, classLevel } = pactCasters[0];
    const pact = progression.pactSlotsByLevel?.[String(classLevel)];
    const count = Number(pact?.slots);
    const slotLevel = Number(pact?.slotLevel);
    return Number.isInteger(count) && count > 0 && Number.isInteger(slotLevel) && slotLevel >= 1 && slotLevel <= 9
      ? { spellSlots: { status: 'calculated', byLevel: { [slotLevel]: count } } }
      : { spellSlots: { status: 'unknown', byLevel: {} } };
  }

  if (standardCasters.length === 1) {
    const { classLevel, progression, subclassSlots } = standardCasters[0];
    const byLevel = slotsAtLevel(subclassSlots || progression.slotsByLevel, classLevel);
    return byLevel
      ? { spellSlots: { status: 'calculated', byLevel } }
      : { spellSlots: { status: 'unknown', byLevel: {} } };
  }

  if (!multiclassSlotTable?.slotsByLevel) return { spellSlots: { status: 'unknown', byLevel: {} } };
  let effectiveCasterLevel = 0;
  for (const { classLevel, progression } of standardCasters) {
    if (progression.type === 'full') effectiveCasterLevel += classLevel;
    else if (progression.type === 'half') effectiveCasterLevel += Math.ceil(classLevel / 2);
    else if (progression.type === 'third') effectiveCasterLevel += Math.floor(classLevel / 3);
    else return { spellSlots: { status: 'unsupported', byLevel: {} } };
  }
  const byLevel = slotsAtLevel(multiclassSlotTable.slotsByLevel, Math.min(LEVEL_CAP, effectiveCasterLevel));
  return byLevel
    ? { spellSlots: { status: 'calculated', byLevel } }
    : { spellSlots: { status: 'unknown', byLevel: {} } };
}

/** Derive a temporary attack card from canonical weapon data and a Character build. */
export function deriveWeaponAttack(character, weapon, classRecords = []) {
  if (weapon?.category !== 'weapon' || !weapon.damage?.dice) return null;
  const properties = weapon.weaponProperties || [];
  const isFinesse = properties.some(({ id }) => id === 'finesse');
  const ability = weapon.weaponType === 'ranged' ? 'dex'
    : isFinesse && calculateAbilityModifier(character.abilityScores?.dex) > calculateAbilityModifier(character.abilityScores?.str) ? 'dex' : 'str';
  const abilityModifier = calculateAbilityModifier(character.abilityScores?.[ability]);
  const totalLevel = (character.classes || []).reduce((sum, entry) => sum + Number(entry.classLevel || 0), 0);
  const proficiencyBonus = calculateProficiencyBonus(totalLevel);
  const category = String(weapon.subcategory || '').toLowerCase().includes('martial') ? 'martial' : 'simple';
  const proficient = classRecords.some((record) => record?.proficiencies?.weapons?.categories?.includes(category));
  const attackBonus = (abilityModifier ?? 0) + (proficient ? proficiencyBonus || 0 : 0);
  const damageModifier = (weapon.damage.flat || 0) + (abilityModifier ?? 0);
  const formula = `${weapon.damage.dice.count}d${weapon.damage.dice.sides}${damageModifier > 0 ? `+${damageModifier}` : damageModifier < 0 ? damageModifier : ''}`;
  return {
    name: weapon.name,
    equipmentId: weapon.id,
    toHit: `${attackBonus >= 0 ? '+' : ''}${attackBonus}`,
    damage: formula,
    damageType: weapon.damage.damageType || null,
    attackType: weapon.weaponType,
  };
}

/**
 * Replace the editable primary class while retaining all other chosen classes.
 * If the primary changes, its former selection becomes a secondary selection.
 */
export function composeClassSelections(primary, additional = [], original = []) {
  const previous = Array.isArray(original) ? original : [];
  const primaryId = primary?.classId || null;
  const formerPrimary = previous[0];
  const candidates = primaryId
    ? [{ ...primary }, ...additional, ...(formerPrimary?.classId && formerPrimary.classId !== primaryId ? [formerPrimary] : [])]
    : [...additional];
  const seen = new Set();
  const result = [];
  for (const entry of candidates) {
    const classId = String(entry?.classId || '').trim();
    if (!classId || seen.has(classId)) continue;
    const classLevel = Number(entry.classLevel);
    if (!Number.isInteger(classLevel) || classLevel < 1 || classLevel > LEVEL_CAP) continue;
    seen.add(classId);
    result.push({ classId, classLevel, subclassId: entry.subclassId || null });
  }
  return result.slice(0, LEVEL_CAP);
}
