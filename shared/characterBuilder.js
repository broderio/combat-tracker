const LEVEL_CAP = 20;
const RULE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_COSTS = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

function numericLevel(value) {
  const level = Number.parseInt(value, 10);
  return Number.isFinite(level) ? Math.max(1, Math.min(LEVEL_CAP, level)) : 1;
}

export function calculateAbilityModifier(score) {
  const value = Number(score);
  return Number.isFinite(value) ? Math.floor((value - 10) / 2) : null;
}

export function calculateProficiencyBonus(level) {
  const value = Number(level);
  if (!Number.isInteger(value) || value < 1 || value > LEVEL_CAP) return null;
  return Math.floor((value - 1) / 4) + 2;
}

export function calculatePointBuyCost(scores = {}) {
  const values = ABILITY_KEYS.map((key) => Number(scores[key]));
  if (values.some((value) => !Number.isInteger(value) || POINT_BUY_COSTS[value] === undefined)) return null;
  return values.reduce((total, value) => total + POINT_BUY_COSTS[value], 0);
}

/** Validate the selected ability-score method without changing user-entered scores. */
export function validateAbilityScores(method, scores = {}) {
  const values = ABILITY_KEYS.map((key) => Number(scores[key]));
  const errors = [];
  if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 30)) {
    errors.push('Enter a whole-number score from 1 to 30 for all six abilities.');
  }
  if (method === 'standard-array' && values.every(Number.isInteger)) {
    const assigned = [...values].sort((a, b) => b - a);
    if (assigned.some((value, index) => value !== STANDARD_ARRAY[index])) {
      errors.push('Assign each standard-array score once: 15, 14, 13, 12, 10, and 8.');
    }
  } else if (method === 'point-buy') {
    const cost = calculatePointBuyCost(scores);
    if (cost === null) errors.push('Point buy uses scores from 8 to 15.');
    else if (cost > 27) errors.push(`Point buy uses ${cost} points; the usual budget is 27.`);
  } else if (!['rolled', 'manual', 'standard-array', 'point-buy'].includes(method)) {
    errors.push('Choose standard array, point buy, rolled, or manual scores.');
  }
  return {
    valid: errors.length === 0,
    errors,
    pointBuyCost: method === 'point-buy' ? calculatePointBuyCost(scores) : null,
  };
}

/** Check explicit class-level allocation against the chosen total character level. */
export function validateBuildLevelAllocation(classes, targetLevel) {
  const target = Number(targetLevel);
  const entries = Array.isArray(classes) ? classes : [];
  const errors = [];
  let totalLevel = 0;
  const seen = new Set();
  if (!Number.isInteger(target) || target < 1 || target > LEVEL_CAP) {
    errors.push('Choose a target character level from 1 to 20.');
  }
  if (!entries.length) errors.push('Add at least one class to calculate class progression.');
  entries.forEach((entry, index) => {
    const classId = String(entry?.classId || '').trim();
    const classLevel = Number(entry?.classLevel);
    if (!classId) errors.push(`Class ${index + 1} needs a local class selection.`);
    if (classId && seen.has(classId)) errors.push(`${classId} is listed more than once.`);
    if (classId) seen.add(classId);
    if (!Number.isInteger(classLevel) || classLevel < 1 || classLevel > LEVEL_CAP) {
      errors.push(`${classId || `Class ${index + 1}`} needs a class level from 1 to 20.`);
    } else {
      totalLevel += classLevel;
    }
  });
  if (totalLevel > LEVEL_CAP) errors.push(`Allocated class levels total ${totalLevel}; the maximum is 20.`);
  if (Number.isInteger(target) && target >= 1 && target <= LEVEL_CAP && entries.length && totalLevel !== target) {
    errors.push(`Allocated class levels total ${totalLevel}; target character level is ${target}. Adjust the allocation explicitly.`);
  }
  return { valid: errors.length === 0, totalLevel, targetLevel: Number.isInteger(target) ? target : null, errors };
}

/** Returns class and subclass features gained by the requested level, in level order. */
export function getCharacterFeatures(classRecord, subclassRecord, requestedLevel) {
  const level = numericLevel(requestedLevel);
  const collect = (record, source) => Object.entries(record?.featuresByLevel || {})
    .filter(([featureLevel]) => Number(featureLevel) <= level)
    .flatMap(([featureLevel, features]) => (Array.isArray(features) ? features : []).map((feature) => ({
      source,
      level: Number(featureLevel),
      name: String(feature.name || 'Feature'),
      description: String(feature.description || ''),
      tables: Array.isArray(feature.tables) ? feature.tables : [],
    })));

  return [...collect(classRecord, 'class'), ...collect(subclassRecord, 'subclass')]
    .sort((a, b) => a.level - b.level || a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
}

/** Return only records explicitly gated at or below the supplied class level. */
export function getLevelGatedChoices(record, requestedClassLevel, { characterLevel = requestedClassLevel } = {}) {
  const level = Number(requestedClassLevel);
  if (!Number.isInteger(level) || level < 1 || level > LEVEL_CAP) return [];
  return (Array.isArray(record?.choices) ? record.choices : [])
    .filter((choice) => {
      if (!choice || choice.scope === 'runtime' || !Number.isInteger(Number(choice.level)) || Number(choice.level) < 1) return false;
      const usesCharacterLevel = ['character', 'character-level', 'total-character-level'].includes(choice.levelContext);
      const contextLevel = Number(usesCharacterLevel ? characterLevel : level);
      return Number.isInteger(contextLevel) && Number(choice.level) <= contextLevel;
    })
    .map((choice) => ({ ...choice, ownerId: record.id || null, ownerName: record.name || null }));
}

/** Stable level-first ordering for generated choices and UI-only manual adapters. */
export function sortChoiceEntriesByLevel(entries) {
  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftChoice = left.choice || left;
    const rightChoice = right.choice || right;
    const levelDifference = Number(leftChoice.level || 0) - Number(rightChoice.level || 0);
    if (levelDifference) return levelDifference;
    const classDifference = Number(left.classIndex || 0) - Number(right.classIndex || 0);
    if (classDifference) return classDifference;
    const recordDifference = Number(left.recordOrder || 0) - Number(right.recordOrder || 0);
    if (recordDifference) return recordDifference;
    const featureDifference = String(leftChoice.feature || '').localeCompare(String(rightChoice.feature || ''));
    if (featureDifference) return featureDifference;
    const promptDifference = String(leftChoice.prompt || '').localeCompare(String(rightChoice.prompt || ''));
    if (promptDifference) return promptDifference;
    return String(leftChoice.id || '').localeCompare(String(rightChoice.id || ''));
  });
}

/** Uses the class record's level-indexed subclass feature text; returns null when absent. */
export function getSubclassUnlockLevel(classRecord) {
  const direct = Number(classRecord?.subclassUnlockLevel ?? classRecord?.subclassLevel);
  if (Number.isInteger(direct) && direct >= 1 && direct <= LEVEL_CAP) return direct;
  const levels = Object.entries(classRecord?.featuresByLevel || {})
    .filter(([, features]) => (Array.isArray(features) ? features : []).some((feature) =>
      /subclass/i.test(`${feature?.name || ''} ${feature?.description || ''}`)
    ))
    .map(([level]) => Number(level))
    .filter((level) => Number.isInteger(level) && level >= 1 && level <= LEVEL_CAP);
  return levels.length ? Math.min(...levels) : null;
}

/** Adapt stable-ID prose choices from generated class/species/background fields without inventing counts. */
export function getManualRecordChoiceAdapters(record) {
  const recordId = String(record?.id || '').trim();
  const kind = String(record?.kind || '').toLocaleLowerCase();
  if (!RULE_ID_PATTERN.test(recordId)) return [];
  const adapters = [];
  const manual = (id, feature, prompt, description, options = []) => ({
    id,
    feature,
    level: 1,
    scope: 'build',
    prompt,
    description: description || '',
    selection: { count: null, countRule: null },
    options,
    optionSource: null,
    resolution: 'manual',
    unresolvedReason: 'The local record does not provide a complete validated choice contract; review the displayed source text and confirm manually.',
  });

  if (kind === 'class' && record.startingEquipment
      && !(record.choices || []).some((choice) => /starting equipment/i.test(choice?.feature || ''))) {
    const data = record.startingEquipment;
    const options = (Array.isArray(data.options) ? data.options : [])
      .filter((option) => RULE_ID_PATTERN.test(String(option?.id || '')))
      .map((option) => ({ id: String(option.id), name: String(option.label || option.id), description: String(option.raw || '') }));
    adapters.push(manual(
      `adapter:${recordId}:starting-equipment`,
      'Starting Equipment',
      data.raw || 'Record the starting equipment decision described by this class.',
      data.raw || '',
      options
    ));
  }

  if (kind === 'species') {
    const sizeText = typeof record.size === 'string' ? record.size : record.size?.raw || '';
    if (/\b(?:chosen|choose|select)\b/i.test(sizeText)) {
      adapters.push(manual(
        `adapter:${recordId}:size`,
        'Species Size',
        'Choose the size described by this species record and confirm the decision manually.',
        sizeText
      ));
    }
    (Array.isArray(record.traits) ? record.traits : []).forEach((trait) => {
      const traitId = String(trait?.id || '').trim();
      if (!RULE_ID_PATTERN.test(traitId) || !/\b(of your choice|choose|select|replace one)\b/i.test(trait.description || '')) return;
        if ((record.choices || []).some((choice) => choice.featureId === traitId || choice.featureId === trait.name
          || choice.feature === trait.name)) return;
      adapters.push(manual(
        `adapter:${recordId}:trait:${traitId}`,
        trait.name || traitId,
        'Record the decision or confirmation for this prose-only trait.',
        trait.description || ''
      ));
    });
  }

  if (kind === 'background' && Array.isArray(record.abilityScores) && record.abilityScores.length
      && !(record.choices || []).some((choice) => /ability score/i.test(choice?.feature || ''))) {
    const options = record.abilityScores
      .filter((ability) => RULE_ID_PATTERN.test(String(ability?.id || '')))
      .map((ability) => ({ id: String(ability.id), name: String(ability.name || ability.id), description: '' }));
    adapters.push(manual(
      `adapter:${recordId}:ability-scores`,
      'Background Ability Scores',
      'Record which listed ability-score candidates you used. The local record does not encode a validated count or allocation procedure.',
      '',
      options
    ));
  }
  if (kind === 'background' && record.equipment
      && !(record.choices || []).some((choice) => /starting equipment/i.test(choice?.feature || ''))) {
    const data = record.equipment;
    const options = (Array.isArray(data.options) ? data.options : [])
      .filter((option) => RULE_ID_PATTERN.test(String(option?.id || '')))
      .map((option) => ({ id: String(option.id), name: String(option.label || option.id), description: String(option.raw || '') }));
    adapters.push(manual(
      `adapter:${recordId}:starting-equipment`,
      'Background Starting Equipment',
      data.raw || 'Record the starting equipment decision described by this background.',
      data.raw || '',
      options
    ));
  }
  return adapters;
}

function spellLevelCap(spellcastingRecord, classLevel) {
  const spellcasting = spellcastingRecord?.spellcasting || spellcastingRecord || null;
  const level = Number(classLevel);
  if (!spellcasting || !Number.isInteger(level)) return null;
  const slotRow = spellcasting.slotsByLevel?.[String(level)];
  const slotLevels = slotRow && typeof slotRow === 'object'
    ? Object.keys(slotRow).map(Number).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  if (slotLevels.length) return Math.max(...slotLevels);
  const pact = spellcasting.pactSlotsByLevel?.[String(level)];
  return Number.isInteger(Number(pact?.slotLevel)) && Number(pact.slotLevel) > 0 ? Number(pact.slotLevel) : null;
}

function normalizedLabel(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function existingOptionDescription(option) {
  if (typeof option?.description === 'string') return option.description;
  if (typeof option?.details === 'string') return option.details;
  return '';
}

/** Add package detail text already present on the generated record to stable starting-equipment option IDs. */
export function enrichChoiceOptions(choice, record, options) {
  const sourceOptions = /starting equipment/i.test(choice?.feature || '')
    ? record?.startingEquipment?.options || record?.equipment?.options || []
    : [];
  return (Array.isArray(options) ? options : []).map((option) => {
    if (!option || typeof option !== 'object') return option;
    const source = sourceOptions.find((candidate) => normalizedLabel(candidate?.id) === normalizedLabel(option.id)
      || normalizedLabel(candidate?.label) === normalizedLabel(option.label));
    if (!source) return option;
    const details = [
      source.raw,
      Array.isArray(source.items) && source.items.length ? `Items: ${source.items.map((item) => typeof item === 'string' ? item : `${item.name || item.id || 'Item'}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`).join(', ')}` : null,
      source.gold !== undefined && source.gold !== null ? `${source.gold} GP` : null,
    ].filter(Boolean).join(' · ');
    return { ...option, description: existingOptionDescription(option) || details };
  });
}

/** Resolve only count expressions explicitly represented in the generated rules data. */
export function resolveChoiceSelectionCount(choice, {
  classRecord = null,
  progressionRecord = classRecord,
  classLevel = null,
  classId = classRecord?.id || null,
  abilityScores = {},
} = {}) {
  const count = choice?.selection?.count;
  if (Number.isInteger(count) && count >= 0) return { count, resolved: true, reason: null };
  const rule = choice?.selection?.countRule;
  if (!rule) return { count: null, resolved: false, reason: 'No structured selection count is present.' };
  const levelKey = String(Number(classLevel));
  let value;
  if (rule === 'progression.values.weapon-mastery.value') {
    value = classRecord?.progression?.[levelKey]?.values?.['weapon-mastery']?.value;
  } else if (rule === 'progression.cantripsKnownByLevel') {
    value = (progressionRecord?.spellcasting || classRecord?.spellcasting)?.cantripsKnownByLevel?.[levelKey];
  } else if (rule === 'progression.preparedSpellsByLevel') {
    value = (progressionRecord?.spellcasting || classRecord?.spellcasting)?.preparedSpellsByLevel?.[levelKey];
  } else {
    const expression = /^max\(1,\s*abilityModifier\((str|dex|con|int|wis|cha)\)\s*\+\s*classLevel\(([a-z0-9-]+)\)\)$/i.exec(rule);
    if (expression) {
      const [, ability, requiredClassId] = expression;
      if (requiredClassId !== classId) {
        return { count: null, resolved: false, reason: `This count uses ${requiredClassId} class level, which is not the current class context.` };
      }
      const modifier = calculateAbilityModifier(abilityScores[ability.toLocaleLowerCase()]);
      const level = Number(classLevel);
      if (modifier !== null && Number.isInteger(level) && level >= 1 && level <= LEVEL_CAP) {
        return { count: Math.max(1, modifier + level), resolved: true, reason: null };
      }
      return { count: null, resolved: false, reason: 'The ability score or class level needed by the generated count expression is unavailable.' };
    }
    return { count: null, resolved: false, reason: `Count rule “${rule}” is not supported by the builder.` };
  }
  return Number.isInteger(Number(value)) && Number(value) >= 0
    ? { count: Number(value), resolved: true, reason: null }
    : { count: null, resolved: false, reason: `The generated progression has no count for class level ${classLevel}.` };
}

function getClassContext(classRecords, classId) {
  const value = classRecords instanceof Map ? classRecords.get(classId) : classRecords?.[classId];
  if (value && Object.hasOwn(value, 'classRecord')) return value;
  return { classRecord: value || null, subclassRecord: null };
}

function normalizeSlotRow(row) {
  if (!row || typeof row !== 'object') return null;
  return Object.fromEntries(Object.entries(row)
    .map(([level, count]) => [String(level), Number(count)])
    .filter(([level, count]) => /^([1-9])$/.test(level) && Number.isInteger(count) && count >= 0));
}

function readSlotRow(table, level) {
  const rows = table?.slotsByLevel || table;
  if (!rows || typeof rows !== 'object') return null;
  return normalizeSlotRow(rows[String(level)]);
}

function getCasterInfo(entry, context) {
  const classSpellcasting = context.classRecord?.spellcasting;
  const subclassSpellcasting = context.subclassRecord?.spellcasting;
  const spellcasting = classSpellcasting || subclassSpellcasting || null;
  return { entry, context, spellcasting };
}

function getMulticlassContribution(info) {
  const { entry, context, spellcasting } = info;
  const classLevel = Number(entry.classLevel);
  if (!spellcasting || !Number.isInteger(classLevel) || classLevel < 1) return null;
  switch (spellcasting.type) {
    case 'full':
      return classLevel;
    case 'half':
      // The local 2024 class IDs distinguish the artificer round-up exception from
      // the paladin/ranger round-down rule. Other half-caster IDs stay unresolved.
      if (entry.classId === 'artificer') return Math.ceil(classLevel / 2);
      if (entry.classId === 'paladin' || entry.classId === 'ranger') return Math.floor(classLevel / 2);
      return null;
    case 'third':
      return Math.floor(classLevel / 3);
    default:
      return null;
  }
}

function deriveSpellSlots(build, contexts, multiclassSlotTable) {
  const entries = Array.isArray(build?.classes) ? build.classes : [];
  if (!entries.length) {
    return {
      spellSlots: { status: 'unresolved', byLevel: {}, reason: 'Choose a class to review spell-slot progressions.' },
      pactMagic: { status: 'unresolved', slots: null, slotLevel: null, reason: 'Choose a class to review Pact Magic.' },
    };
  }

  const casterInfos = entries.map((entry) => getCasterInfo(entry, getClassContext(contexts, entry.classId)));
  const missingClass = casterInfos.find((info) => !info.context.classRecord);
  const pactCasters = casterInfos.filter((info) => info.spellcasting?.type === 'pact');
  const regularCasters = casterInfos.filter((info) => info.spellcasting && info.spellcasting.type !== 'pact');
  let pactMagic = { status: 'none', slots: null, slotLevel: null, reason: 'No Pact Magic progression is present in the selected local rules records.' };
  if (pactCasters.length) {
    const pactRows = pactCasters.map((info) => {
      const row = info.spellcasting?.pactSlotsByLevel?.[String(info.entry.classLevel)];
      return row && Number.isInteger(Number(row.slots)) && Number.isInteger(Number(row.slotLevel))
        ? { slots: Number(row.slots), slotLevel: Number(row.slotLevel), classId: info.entry.classId }
        : null;
    });
    if (pactRows.every(Boolean)) {
      pactMagic = {
        status: 'calculated',
        slots: pactRows.reduce((total, row) => total + row.slots, 0),
        slotLevel: Math.max(...pactRows.map((row) => row.slotLevel)),
        byClass: pactRows,
        reason: null,
      };
    } else {
      pactMagic = { status: 'unresolved', slots: null, slotLevel: null, reason: 'A selected Pact Magic class has no matching local progression row.' };
    }
  }

  if (missingClass) {
    return {
      spellSlots: { status: 'unresolved', byLevel: {}, reason: `The local class record for “${missingClass.entry.classId || 'an unknown class'}” is unavailable.` },
      pactMagic,
    };
  }

  if (!regularCasters.length) {
    return {
      spellSlots: { status: 'none', byLevel: {}, reason: 'No non-Pact spell-slot progression is present in the selected local rules records.' },
      pactMagic,
    };
  }

  if (regularCasters.length === 1) {
    const info = regularCasters[0];
    if (info.entry.subclassId && !info.context.subclassRecord && !info.context.classRecord?.spellcasting) {
      return {
        spellSlots: { status: 'unresolved', byLevel: {}, reason: `The selected subclass record for ${info.entry.classId} is unavailable.` },
        pactMagic,
      };
    }
    const row = readSlotRow(info.spellcasting, info.entry.classLevel);
    return {
      spellSlots: row
        ? { status: 'calculated', byLevel: row, reason: null, classId: info.entry.classId }
        : { status: 'unresolved', byLevel: {}, reason: `No local spell-slot row is available for ${info.entry.classId} class level ${info.entry.classLevel}.` },
      pactMagic,
    };
  }

  const contributions = regularCasters.map(getMulticlassContribution);
  if (contributions.some((value) => value === null)) {
    return {
      spellSlots: { status: 'unresolved', byLevel: {}, reason: 'A selected caster has no unambiguous multiclass contribution in the local class data.' },
      pactMagic,
    };
  }
  const casterLevel = contributions.reduce((total, value) => total + value, 0);
  if (casterLevel === 0) {
    return {
      spellSlots: { status: 'calculated', byLevel: {}, casterLevel, reason: null },
      pactMagic,
    };
  }
  if (casterLevel > LEVEL_CAP) {
    return {
      spellSlots: { status: 'unresolved', byLevel: {}, casterLevel, reason: `The multiclass caster level ${casterLevel} exceeds the supported local progression.` },
      pactMagic,
    };
  }
  const selectedFullCaster = regularCasters.find((info) =>
    info.spellcasting.type === 'full' && info.spellcasting.slotsByLevel
  );
  const table = multiclassSlotTable
    || selectedFullCaster?.spellcasting
    || null;
  const row = readSlotRow(table, casterLevel);
  return {
    spellSlots: row
      ? { status: 'calculated', byLevel: row, casterLevel, reason: null }
      : { status: 'unresolved', byLevel: {}, casterLevel, reason: 'A full-caster slot progression from the local rules database is required to combine these class levels.' },
    pactMagic,
  };
}

/**
 * Calculate builder-only values. These are returned separately from legacy character fields;
 * callers must not copy them over editable HP, AC, attack, or spell-slot values.
 */
export function calculateCharacterDerivedValues({
  level,
  abilityScores = {},
  build = {},
  classRecords = {},
  multiclassSlotTable = null,
} = {}) {
  const proficiencyBonus = calculateProficiencyBonus(level);
  const abilityModifiers = Object.fromEntries(ABILITY_KEYS.map((key) => [
    key,
    calculateAbilityModifier(abilityScores[key]),
  ]));
  const allocation = validateBuildLevelAllocation(build.classes, level);
  const firstClass = build.classes?.[0];
  const firstContext = firstClass ? getClassContext(classRecords, firstClass.classId) : null;
  const saveAbilities = firstContext?.classRecord?.savingThrows;
  const savingThrows = Array.isArray(saveAbilities) && proficiencyBonus !== null
    ? {
      status: 'calculated',
      byAbility: Object.fromEntries(ABILITY_KEYS.map((ability) => {
        const proficient = saveAbilities.includes(ability);
        const modifier = abilityModifiers[ability];
        return [ability, modifier === null ? null : modifier + (proficient ? proficiencyBonus : 0)];
      })),
      proficientAbilities: saveAbilities.filter((ability) => ABILITY_KEYS.includes(ability)),
      reason: null,
    }
    : {
      status: 'unresolved',
      byAbility: {},
      proficientAbilities: [],
      reason: !firstClass ? 'Choose a starting class to establish saving-throw proficiencies.'
        : !Array.isArray(saveAbilities) ? 'The selected starting-class record does not provide structured saving-throw proficiencies.'
          : 'Choose a valid target level to calculate saving throws.',
    };

  const spellcasters = [];
  for (const entry of Array.isArray(build.classes) ? build.classes : []) {
    const context = getClassContext(classRecords, entry.classId);
    if (!context.classRecord) continue;
    const info = getCasterInfo(entry, context);
    if (!info.spellcasting) continue;
    const ability = info.spellcasting.ability;
    const modifier = ABILITY_KEYS.includes(ability) ? abilityModifiers[ability] : null;
    spellcasters.push({
      classId: entry.classId,
      subclassId: entry.subclassId || null,
      classLevel: Number(entry.classLevel),
      ability: ABILITY_KEYS.includes(ability) ? ability : null,
      spellAttackModifier: modifier === null || proficiencyBonus === null ? null : modifier + proficiencyBonus,
      spellSaveDC: modifier === null || proficiencyBonus === null ? null : 8 + modifier + proficiencyBonus,
      status: modifier === null || proficiencyBonus === null ? 'unresolved' : 'calculated',
      reason: modifier === null ? 'The spellcasting ability or its score is not present in the local build data.'
        : proficiencyBonus === null ? 'Choose a valid target level to calculate spellcasting modifiers.' : null,
    });
  }
  const spellSlots = deriveSpellSlots(build, classRecords, multiclassSlotTable);
  return { abilityModifiers, proficiencyBonus, allocation, savingThrows, spellcasters, ...spellSlots };
}

/**
 * Resolve the currently supported generated option-source types. An unsupported or
 * unresolved source is explicit so callers can show a manual-choice warning rather
 * than presenting an empty list as if the rule had no options.
 */
export function resolveChoiceOptions(choice, {
  catalogs = {},
  classId = null,
  classLevel = null,
  classRecord = null,
  spellcastingRecord = classRecord,
  maxSpellLevel = null,
  characterLevel = null,
  buildSelections = [],
} = {}) {
  const inlineOptions = Array.isArray(choice?.options) ? choice.options : [];
  const inlineOptionIds = inlineOptions.map((option) => typeof option === 'string' ? null : String(option?.id || '').trim());
  const inlineOptionProblem = inlineOptions.length && (
    inlineOptionIds.some((id) => !id || !RULE_ID_PATTERN.test(id))
    || new Set(inlineOptionIds).size !== inlineOptionIds.length
  );
  const resolution = String(choice?.resolution || '').toLocaleLowerCase();
  const featEligibilityUnresolved = choice?.optionSource?.type === 'feat-list'
    && Boolean(choice.optionSource.eligibility);
  let manual = resolution === 'manual' || resolution === 'partial' || Boolean(choice?.unresolvedReason) || featEligibilityUnresolved || inlineOptionProblem;
  let manualReason = choice?.unresolvedReason || (featEligibilityUnresolved
    ? 'Feat prerequisites are not fully validated by the local resolver; explicit minimum-level limits are filtered, but other requirements need manual review.'
    : inlineOptionProblem
      ? 'One or more inline options are missing unique stable local IDs; they cannot be safely saved as validated choices.'
      : 'The generated choice is marked partial/manual and needs review.');
  if (choice?.noOptions === true || resolution === 'none') {
    return { state: 'none', supported: true, reason: choice.unresolvedReason || 'The local rule record explicitly marks this choice as having no options.', items: [] };
  }

  if (!choice?.optionSource) {
    if (inlineOptions.length) {
      return {
        state: manual ? 'manual' : 'options',
        supported: true,
        reason: manual ? manualReason : null,
        items: inlineOptions,
      };
    }
    return {
      state: 'manual',
      supported: true,
      reason: choice?.unresolvedReason || (inlineOptionProblem ? manualReason : 'No structured option list is present; use the feature text and record the choice manually.'),
      items: [],
    };
  }

  const source = choice.optionSource;
  const spellEligibilityUnresolved = source.type === 'spell-list'
    && source.spellKind === 'spell'
    && source.spellLevel === undefined
    && source.eligibility !== 'spell-level-unlocked-at-class-level';
  if (spellEligibilityUnresolved && resolution !== 'manual' && resolution !== 'partial') {
    manual = true;
    manualReason = 'The choice does not encode its spell-level rule. Candidates are capped by the local class-level slot table; review the full feature text for any additional restriction.';
  }
  const catalogKey = ({ 'feat-list': 'feats', 'spell-list': 'spells', 'character-spellbook': 'spells', 'weapon-list': 'equipment', 'equipment-list': 'equipment', 'skill-list': 'skills', 'tool-list': 'tools', 'language-list': 'languages' })[source.type];
  if (!catalogKey) {
    return { state: 'unsupported', supported: false, reason: `Option source “${source.type}” is not supported by the builder yet.`, items: inlineOptions };
  }
  if (!Array.isArray(catalogs[catalogKey])) {
    return { state: 'unavailable', supported: true, reason: `The local ${catalogKey} catalog is not available to resolve this source.`, items: inlineOptions };
  }

  let items;
  switch (source.type) {
    case 'feat-list':
      items = catalogs.feats.filter((feat) => {
        const isFightingStyle = source.eligibility === 'fighting-style'
          || source.id === 'fighting-style-feats'
          || choice.feature?.toLocaleLowerCase() === 'fighting style';
        const level = Number(characterLevel);
        const knownLaterLevel = characterLevel !== null && characterLevel !== undefined && characterLevel !== ''
          && Number.isInteger(level)
          && feat.minimumCharacterLevel !== null && feat.minimumCharacterLevel !== undefined
          && Number.isInteger(Number(feat.minimumCharacterLevel))
          && Number(feat.minimumCharacterLevel) > level;
        return !knownLaterLevel && (!isFightingStyle || /fighting style/i.test(feat.category || ''));
      });
      break;
    case 'spell-list': {
      const classListId = source.id === 'class-spell-list' ? classId : source.id;
      if (!classListId) {
        return { state: 'unavailable', supported: true, reason: 'This spell list needs a selected class context.', items: inlineOptions };
      }
      items = catalogs.spells.filter((spell) =>
        (spell.classes || []).some((entry) => (typeof entry === 'string' ? entry : entry.id) === classListId)
      );
      if (source.spellKind === 'cantrip') items = items.filter((spell) => Number(spell.level) === 0);
      if (source.spellKind === 'spell') {
        if (source.spellLevel !== undefined && source.spellLevel !== null) {
          items = items.filter((spell) => Number(spell.level) === Number(source.spellLevel));
          break;
        }
        const cap = maxSpellLevel !== null && maxSpellLevel !== undefined && maxSpellLevel !== ''
          && Number.isInteger(Number(maxSpellLevel))
          ? Number(maxSpellLevel)
          : spellLevelCap(spellcastingRecord, classLevel);
        if (cap === null) {
          return { state: 'unavailable', supported: true, reason: 'The selected class-level record does not provide a spell-level limit; later-level spells are hidden.', items: [] };
        }
        items = items.filter((spell) => Number(spell.level) > 0 && Number(spell.level) <= cap);
      }
      break;
    }
    case 'character-spellbook': {
      if (!classId || !classRecord || classRecord.id !== classId) {
        return { state: 'unavailable', supported: true, reason: 'This spellbook choice needs the matching selected class record.', items: inlineOptions };
      }
      if (source.castingTime) {
        return { state: 'unsupported', supported: false, reason: `Spellbook filtering by “${source.castingTime}” casting time is not supported yet.`, items: inlineOptions };
      }
      const spellbookChoiceIds = (classRecord.choices || [])
        .filter((candidate) => candidate?.id !== choice.id
          && candidate.id?.startsWith(`${classId}-`)
          && candidate.id.includes('spellbook')
          && Number(candidate.level) <= Number(classLevel))
        .map((candidate) => candidate.id);
      const selectedIds = new Set((Array.isArray(buildSelections) ? buildSelections : [])
        .filter((selection) => spellbookChoiceIds.includes(selection?.choiceId))
        .flatMap((selection) => Array.isArray(selection.selectedOptionIds) ? selection.selectedOptionIds : []));
      if (!selectedIds.size) {
        return { state: 'unavailable', supported: true, reason: `Choose spells for the ${classRecord.name} spellbook first; this choice resolves only against those saved spell IDs.`, items: inlineOptions };
      }
      items = catalogs.spells.filter((spell) => selectedIds.has(spell.id));
      if (source.spellKind === 'cantrip') items = items.filter((spell) => Number(spell.level) === 0);
      if (source.spellKind === 'spell') items = items.filter((spell) => Number(spell.level) > 0);
      if (source.spellLevel !== undefined && source.spellLevel !== null) {
        items = items.filter((spell) => Number(spell.level) === Number(source.spellLevel));
      }
      break;
    }
    case 'weapon-list':
      items = catalogs.equipment.filter((item) =>
        item.category === 'weapon' || item.kind === 'weapon' || (item.weaponProperties || []).length > 0
      );
      break;
    case 'equipment-list':
      items = catalogs.equipment;
      break;
    case 'skill-list':
      items = catalogs.skills;
      break;
    case 'tool-list':
      items = catalogs.tools;
      break;
    case 'language-list':
      items = catalogs.languages;
      break;
    default:
      return { state: 'unsupported', supported: false, reason: `Option source “${source.type}” is not supported by the builder yet.`, items: inlineOptions };
  }

  const result = Array.isArray(items) ? items : [];
  const catalogIds = result.map((item) => String(item?.id || '').trim());
  const invalidCatalogIds = catalogIds.some((id) => !RULE_ID_PATTERN.test(id));
  const duplicateCatalogIds = new Set(catalogIds).size !== catalogIds.length;
  if ((invalidCatalogIds || duplicateCatalogIds) && !manual) {
    manual = true;
    manualReason = invalidCatalogIds
      ? 'One or more resolved catalog options have no valid stable local ID and cannot be safely persisted.'
      : 'Resolved catalog options contain duplicate stable IDs and cannot be safely distinguished.';
  }
  if (manual) {
    return {
      state: 'manual',
      supported: true,
      reason: manualReason,
      items: result,
    };
  }
  return {
    state: result.length ? 'options' : 'unavailable',
    supported: true,
    reason: result.length ? null : 'The local database resolved this source to an empty list; it does not confirm that the rule has no options.',
    items: result,
  };
}

/** Create or replace one persisted choice selection without disturbing other choices. */
export function setBuildSelection(build, choiceId, selectedOptionIds) {
  const existing = Array.isArray(build?.selections) ? build.selections : [];
  const previous = existing.find((selection) => selection?.choiceId === choiceId) || {};
  const normalizedIds = [...new Set((Array.isArray(selectedOptionIds) ? selectedOptionIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => RULE_ID_PATTERN.test(id)))];
  const selections = existing.filter((selection) => selection?.choiceId !== choiceId);
  if (normalizedIds.length || previous.manualValue || previous.manualConfirmed) {
    selections.push({ ...previous, choiceId, selectedOptionIds: normalizedIds });
  }
  return { ...(build || {}), selections };
}

/** Resolve selected catalog-backed options to the character collections they affect. */
export function collectChoiceBackedReferences(choiceEntries = [], selections = []) {
  const selectionById = new Map((Array.isArray(selections) ? selections : [])
    .filter((selection) => selection?.choiceId)
    .map((selection) => [selection.choiceId, selection]));
  const references = { spellIds: [], featIds: [], equipmentIds: [] };
  const appendUnique = (target, value) => {
    if (RULE_ID_PATTERN.test(String(value || '')) && !target.includes(value)) target.push(value);
  };

  for (const entry of Array.isArray(choiceEntries) ? choiceEntries : []) {
    const choice = entry?.choice || entry;
    const selection = selectionById.get(choice?.id);
    if (!selection) continue;
    const selectedIds = new Set(Array.isArray(selection.selectedOptionIds) ? selection.selectedOptionIds : []);
    const options = Array.isArray(entry?.resolvedOptions)
      ? entry.resolvedOptions
      : Array.isArray(choice?.options) ? choice.options : [];
    const validOptionIds = new Set(options.map((option) => option?.id).filter(Boolean));
    const validSelectedIds = [...selectedIds].filter((id) => validOptionIds.has(id));
    const sourceType = choice?.optionSource?.type;
    const target = sourceType === 'spell-list' || sourceType === 'character-spellbook' ? references.spellIds
      : sourceType === 'feat-list' ? references.featIds
        : sourceType === 'weapon-list' || sourceType === 'equipment-list' ? references.equipmentIds
          : null;
    if (target) for (const id of validSelectedIds) appendUnique(target, id);
  }

  return references;
}

/** Return explicit effects from selected options, excluding partial/manual contracts. */
export function collectSelectedChoiceEffects(choiceEntries = [], selections = []) {
  const selectionById = new Map((Array.isArray(selections) ? selections : [])
    .filter((selection) => selection?.choiceId)
    .map((selection) => [selection.choiceId, selection]));
  const effects = [];
  for (const entry of Array.isArray(choiceEntries) ? choiceEntries : []) {
    const choice = entry?.choice || entry;
    if (choice?.resolution !== 'structured' || entry?.resolved?.state === 'manual') continue;
    const selectedIds = new Set(selectionById.get(choice?.id)?.selectedOptionIds || []);
    const options = Array.isArray(entry?.resolvedOptions)
      ? entry.resolvedOptions
      : Array.isArray(choice?.options) ? choice.options : [];
    for (const option of options) {
      if (!selectedIds.has(option?.id)) continue;
      for (const effect of Array.isArray(option.effects) ? option.effects : []) {
        effects.push({ choiceId: choice.id, optionId: option.id, effect });
      }
    }
  }
  return effects;
}

/** Check whether the resolved selection count satisfies a generated choice contract. */
export function validateChoiceSelectionCount(choice, selectedOptionIds, resolvedCount = null) {
  const ids = Array.isArray(selectedOptionIds) ? selectedOptionIds : [];
  const selection = choice?.selection || {};
  const exactCount = Number.isInteger(resolvedCount) ? resolvedCount
    : Number.isInteger(selection.count) ? selection.count : null;
  const min = Number.isInteger(resolvedCount) ? exactCount : Number.isInteger(selection.min) ? selection.min : exactCount;
  const max = Number.isInteger(resolvedCount) ? exactCount : Number.isInteger(selection.max) ? selection.max : exactCount;
  const distinct = selection.distinct !== false;
  const errors = [];
  if (distinct && new Set(ids).size !== ids.length) errors.push('Choose distinct options only.');
  if (min !== null && ids.length < min) errors.push(`Choose at least ${min} option${min === 1 ? '' : 's'}.`);
  if (max !== null && ids.length > max) errors.push(`Choose no more than ${max} option${max === 1 ? '' : 's'}.`);
  return { valid: errors.length === 0, errors, min, max };
}

/** Keep the class progression field and generated subclass-choice selection aligned. */
export function setBuildSubclass(build, classId, subclassId) {
  const next = { ...(build || {}) };
  const classes = Array.isArray(next.classes) ? [...next.classes] : [];
  const classIndex = classes.findIndex((entry) => entry?.classId === classId);
  if (classIndex < 0) return next;
  const normalizedSubclassId = String(subclassId || '').trim();
  classes[classIndex] = {
    ...classes[classIndex],
    subclassId: RULE_ID_PATTERN.test(normalizedSubclassId) ? normalizedSubclassId : null,
  };
  next.classes = classes;
  return next;
}

/** Store a manual selection/confirmation without asserting that it passed rule validation. */
export function setBuildManualChoice(build, choiceId, { manualValue = '', manualConfirmed = false } = {}) {
  const existing = Array.isArray(build?.selections) ? build.selections : [];
  if (!RULE_ID_PATTERN.test(String(choiceId || ''))) return { ...(build || {}), selections: existing };
  const previous = existing.find((selection) => selection?.choiceId === choiceId) || {};
  const selections = existing.filter((selection) => selection?.choiceId !== choiceId);
  const next = {
    ...previous,
    choiceId,
    selectedOptionIds: Array.isArray(previous.selectedOptionIds) ? previous.selectedOptionIds : [],
    manualValue: String(manualValue || '').trim().slice(0, 2000),
    manualConfirmed: manualConfirmed === true,
  };
  if (next.selectedOptionIds.length || next.manualValue || next.manualConfirmed) selections.push(next);
  return { ...(build || {}), selections };
}

/** Adds or updates a spell's builder state without disturbing unrelated spells. */
export function setBuildSpell(build, spell, { status = 'known', sourceClassId = null } = {}) {
  const spells = Array.isArray(build?.spells) ? [...build.spells] : [];
  const id = String(spell?.id || '').trim();
  if (!RULE_ID_PATTERN.test(id)) return { ...(build || {}), spells };
  const next = {
    spellId: id,
    status: ['known', 'prepared', 'always-prepared'].includes(status) ? status : 'known',
    sourceClassId: sourceClassId ? String(sourceClassId) : null,
  };
  const index = spells.findIndex((entry) => entry.spellId === id && entry.sourceClassId === next.sourceClassId);
  if (index < 0) spells.push(next);
  else spells[index] = next;
  return { ...(build || {}), spells };
}
